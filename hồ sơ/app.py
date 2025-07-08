import os
import re
import base64
import requests
import json
from flask import Flask, request, jsonify, render_template, url_for, redirect, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, current_user, login_required
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
import logging
import secrets
from datetime import datetime

load_dotenv()

app = Flask(__name__, template_folder='templates', static_folder='static')

# --- Configuration ---
app.config['SECRET_KEY'] = os.getenv("SECRET_KEY", secrets.token_hex(16))
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'studybuddy.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# --- Extensions ---
db = SQLAlchemy(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
login_manager.login_message_category = "info"
login_manager.login_message = "Vui lòng đăng nhập để truy cập trang này."

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent"

# --- User Model ---
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    quizzes = db.relationship('Quiz', backref='author', lazy=True, cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def __repr__(self):
        return f'<User {self.username}>'

# --- Quiz Model ---
class Quiz(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(150), nullable=False)
    quiz_data = db.Column(db.Text, nullable=False) 
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    last_score_percentage = db.Column(db.Float, nullable=True)
    last_attempt_date = db.Column(db.DateTime, nullable=True)

    def __repr__(self):
        return f'<Quiz {self.name}>'

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- Study Buddy Core Functions ---
def parse_questions_from_text(text):
    lines = text.split('\n')
    questions = []
    current_question_data = None
    last_added_was_choice = False
    last_choice_key = None
    question_start_regex = re.compile(r"^(?:(?:Câu|Cau)\s*(\d+)[.:\s)]*|(?:Câu hỏi|Question)\s*\d+[.:\s)]*|(\d+)\s*[.:\s)])\s*(.*)", re.IGNORECASE)
    choice_regex = re.compile(r"^\s*([A-F])\s*[.:\s)]\s*(.*)", re.IGNORECASE)
    detected_answer_regex = re.compile(r"^\s*Detected Answer:\s*([A-F]|None)\s*$", re.IGNORECASE)
    def finalize_current_question():
        nonlocal current_question_data, last_added_was_choice, last_choice_key
        if current_question_data:
            if current_question_data.get("question"): current_question_data["question"] = current_question_data["question"].strip()
            if current_question_data.get("choices"):
                for key, value in current_question_data["choices"].items(): current_question_data["choices"][key] = value.strip() if isinstance(value, str) else value
            if current_question_data.get("question") or current_question_data.get("choices"):
                 if "detectedAnswer" not in current_question_data or current_question_data["detectedAnswer"] is None: current_question_data["detectedAnswer"] = None
                 if "correctAnswer" not in current_question_data: current_question_data["correctAnswer"] = None
                 questions.append(current_question_data)
                 app.logger.debug(f"Finalized question: {current_question_data}")
            else: app.logger.warning(f"Discarding empty question block: {current_question_data}")
        current_question_data = None; last_added_was_choice = False; last_choice_key = None
    app.logger.info("Starting text parsing...")
    for line_num, line_content in enumerate(lines):
        line_stripped = line_content.strip(); app.logger.debug(f"Processing line {line_num+1}: '{line_content}'")
        q_match = question_start_regex.match(line_content); c_match = choice_regex.match(line_content); da_match = detected_answer_regex.match(line_stripped)
        if q_match:
            app.logger.debug("Matched question start"); finalize_current_question(); initial_question_text = q_match.group(3).strip()
            current_question_data = {"question": initial_question_text, "choices": {}, "detectedAnswer": None, "correctAnswer": None}
            last_added_was_choice = False; last_choice_key = None
            if not initial_question_text: app.logger.debug("Question prefix found, but no text on the same line. Expecting text on next lines.")
        elif c_match and current_question_data:
            app.logger.debug("Matched choice"); choice_letter = c_match.group(1).upper(); choice_text = c_match.group(2).strip()
            if choice_letter not in current_question_data["choices"]: current_question_data["choices"][choice_letter] = choice_text
            else: current_question_data["choices"][choice_letter] += "\n" + choice_text
            last_added_was_choice = True; last_choice_key = choice_letter
        elif da_match and current_question_data:
            app.logger.debug("Matched detected answer"); detected = da_match.group(1).upper()
            current_question_data["detectedAnswer"] = None if detected == "NONE" else detected
            last_added_was_choice = False; last_choice_key = None; finalize_current_question()
        elif current_question_data and line_stripped:
            app.logger.debug(f"Processing continuation line: '{line_stripped}'")
            if last_added_was_choice and last_choice_key and last_choice_key in current_question_data["choices"]: current_question_data["choices"][last_choice_key] += "\n" + line_stripped
            elif 'question' in current_question_data:
                if current_question_data["question"]: current_question_data["question"] += "\n" + line_stripped
                else: current_question_data["question"] = line_stripped
                last_added_was_choice = False; last_choice_key = None
            else: app.logger.warning(f"Orphan line ignored: '{line_content}'")
        elif not current_question_data and line_stripped: app.logger.warning(f"Ignoring line - no current question context: '{line_content}'")
    finalize_current_question()
    app.logger.info(f"Parsing finished. Found {len(questions)} questions.")
    return questions

# --- Auth Routes ---
@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated: return redirect(url_for('home_app'))
    if request.method == 'POST':
        username = request.form.get('username'); password = request.form.get('password'); password2 = request.form.get('password2')
        if not username or not password or not password2: flash('Vui lòng điền đầy đủ thông tin.', 'warning'); return redirect(url_for('register'))
        if password != password2: flash('Mật khẩu không khớp.', 'warning'); return redirect(url_for('register'))
        existing_user = User.query.filter_by(username=username).first()
        if existing_user: flash('Tên đăng nhập đã tồn tại.', 'warning'); return redirect(url_for('register'))
        new_user = User(username=username); new_user.set_password(password)
        db.session.add(new_user); db.session.commit()
        flash('Đăng ký thành công! Vui lòng đăng nhập.', 'success'); return redirect(url_for('login'))
    return render_template('auth/register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated: return redirect(url_for('home_app'))
    if request.method == 'POST':
        username = request.form.get('username'); password = request.form.get('password')
        remember = True if request.form.get('remember') else False
        if not username or not password: flash('Vui lòng điền tên đăng nhập và mật khẩu.', 'warning'); return redirect(url_for('login'))
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user, remember=remember); flash('Đăng nhập thành công!', 'success')
            next_page = request.args.get('next')
            if next_page and not (next_page.startswith('/') or next_page.startswith(request.host_url)):
                app.logger.warning(f"Unsafe next_page redirect attempt: {next_page}"); next_page = None
            return redirect(next_page or url_for('home_app'))
        else: flash('Tên đăng nhập hoặc mật khẩu không đúng.', 'danger'); return redirect(url_for('login'))
    return render_template('auth/login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user(); flash('Bạn đã đăng xuất.', 'info'); return redirect(url_for('welcome'))

# --- Main Application Entry and Study Buddy App Routes ---
@app.route('/')
def welcome():
    if current_user.is_authenticated: return redirect(url_for('home_app'))
    return render_template('welcome.html')

@app.route('/app')
def home_app():
    return render_template('index.html', current_year=datetime.utcnow().year)

# --- Quiz Management Routes ---
@app.route('/save-quiz-to-account', methods=['POST'])
@login_required
def save_quiz_to_account():
    data = request.get_json(); quiz_name = data.get('name'); quiz_content_list = data.get('quiz_data'); existing_quiz_id = data.get('quiz_id')
    if not quiz_name or not quiz_content_list: return jsonify({"error": "Tên bài kiểm tra và nội dung không được để trống."}), 400
    if not isinstance(quiz_content_list, list): return jsonify({"error": "Định dạng dữ liệu bài kiểm tra không hợp lệ."}), 400
    try:
        quiz_data_json = json.dumps(quiz_content_list); quiz_to_save = None
        if existing_quiz_id:
            quiz_to_save = Quiz.query.filter_by(id=existing_quiz_id, user_id=current_user.id).first()
            if quiz_to_save:
                quiz_to_save.name = quiz_name; quiz_to_save.quiz_data = quiz_data_json; quiz_to_save.updated_at = datetime.utcnow()
                app.logger.info(f"Updating quiz ID {existing_quiz_id} for user {current_user.username}")
            else: app.logger.warning(f"Quiz ID {existing_quiz_id} not found for update or not owned by user {current_user.username}. Creating new."); existing_quiz_id = None
        if not quiz_to_save:
            quiz_to_save = Quiz(name=quiz_name, quiz_data=quiz_data_json, author=current_user)
            db.session.add(quiz_to_save); app.logger.info(f"Creating new quiz '{quiz_name}' for user {current_user.username}")
        db.session.commit()
        return jsonify({"message": f"Bài kiểm tra '{quiz_to_save.name}' đã được lưu/cập nhật.", "quiz_id": quiz_to_save.id, "quiz_name": quiz_to_save.name}), 200 if existing_quiz_id and quiz_to_save else 201
    except Exception as e:
        db.session.rollback(); app.logger.error(f"Lỗi khi lưu/cập nhật bài kiểm tra: {e}", exc_info=True)
        return jsonify({"error": "Đã xảy ra lỗi khi lưu bài kiểm tra."}), 500

@app.route('/my-quizzes', methods=['GET'])
@login_required
def my_quizzes():
    try:
        quizzes = Quiz.query.filter_by(user_id=current_user.id).order_by(Quiz.updated_at.desc()).all()
        quiz_list = [{"id": quiz.id, "name": quiz.name, "created_at": quiz.created_at.strftime('%Y-%m-%d %H:%M:%S'), "updated_at": quiz.updated_at.strftime('%Y-%m-%d %H:%M:%S'), "last_score_percentage": quiz.last_score_percentage, "last_attempt_date": quiz.last_attempt_date.strftime('%Y-%m-%d %H:%M:%S') if quiz.last_attempt_date else None} for quiz in quizzes]
        return jsonify({"quizzes": quiz_list})
    except Exception as e: app.logger.error(f"Lỗi khi tải danh sách bài kiểm tra: {e}", exc_info=True); return jsonify({"error": "Không thể tải danh sách bài kiểm tra."}), 500

@app.route('/load-quiz-from-account/<int:quiz_id>', methods=['GET'])
@login_required
def load_quiz_from_account(quiz_id):
    quiz = Quiz.query.get_or_404(quiz_id)
    if quiz.user_id != current_user.id: return jsonify({"error": "Bạn không có quyền truy cập bài kiểm tra này."}), 403
    try:
        quiz_content_list = json.loads(quiz.quiz_data)
        return jsonify({"id": quiz.id, "name": quiz.name, "quiz_data": quiz_content_list, "last_score_percentage": quiz.last_score_percentage, "last_attempt_date": quiz.last_attempt_date.isoformat() if quiz.last_attempt_date else None})
    except json.JSONDecodeError: app.logger.error(f"Lỗi giải mã JSON cho quiz ID {quiz_id}"); return jsonify({"error": "Dữ liệu bài kiểm tra bị lỗi định dạng."}), 500
    except Exception as e: app.logger.error(f"Lỗi khi tải bài kiểm tra {quiz_id}: {e}", exc_info=True); return jsonify({"error": "Không thể tải bài kiểm tra."}), 500

@app.route('/delete-quiz-from-account/<int:quiz_id>', methods=['DELETE'])
@login_required
def delete_quiz_from_account(quiz_id):
    quiz = Quiz.query.get_or_404(quiz_id)
    if quiz.user_id != current_user.id: return jsonify({"error": "Bạn không có quyền xóa bài kiểm tra này."}), 403
    try: db.session.delete(quiz); db.session.commit(); return jsonify({"message": f"Bài kiểm tra '{quiz.name}' đã được xóa."})
    except Exception as e: db.session.rollback(); app.logger.error(f"Lỗi khi xóa bài kiểm tra {quiz_id}: {e}", exc_info=True); return jsonify({"error": "Không thể xóa bài kiểm tra."}), 500

@app.route('/record-quiz-attempt/<int:quiz_id>', methods=['POST'])
@login_required
def record_quiz_attempt(quiz_id):
    quiz = Quiz.query.get_or_404(quiz_id)
    if quiz.user_id != current_user.id: return jsonify({"error": "Không thể ghi nhận kết quả cho bài kiểm tra này."}), 403
    data = request.get_json(); score_percentage = data.get('score_percentage')
    if score_percentage is None: return jsonify({"error": "Thiếu thông tin điểm số."}), 400
    try:
        quiz.last_score_percentage = float(score_percentage); quiz.last_attempt_date = datetime.utcnow()
        db.session.commit(); return jsonify({"message": "Kết quả bài làm đã được ghi nhận."}), 200
    except ValueError: return jsonify({"error": "Điểm số không hợp lệ."}), 400
    except Exception as e: db.session.rollback(); app.logger.error(f"Lỗi ghi nhận kết quả bài làm cho quiz {quiz_id}: {e}", exc_info=True); return jsonify({"error": "Không thể ghi nhận kết quả."}), 500

# --- Existing Gemini API Routes ---
@app.route('/process-image', methods=['POST'])
def process_image_route():
    if not GEMINI_API_KEY: app.logger.error("GEMINI_API_KEY not configured."); return jsonify({"error": "Lỗi cấu hình từ máy chủ: Khóa API chưa được thiết lập."}), 500
    if 'image' not in request.files: return jsonify({"error": "Không tìm thấy tệp ảnh trong yêu cầu."}), 400
    file = request.files['image']
    if file.filename == '': return jsonify({"error": "Chưa chọn tệp ảnh nào."}), 400
    try:
        image_bytes = file.read(); base64_image = base64.b64encode(image_bytes).decode('utf-8'); mime_type = file.mimetype
        prompt_text = """Analyze the provided image containing multiple-choice questions (likely in Vietnamese, possibly starting with 'Câu' or numbered). Perform the following steps precisely for EACH question found:
1.  **Extract Question:** Identify and extract the full text of the question itself. Include any original numbering or prefix (e.g., "Câu 1:", "2.", "IIIa) ") as part of the extracted question text. Preserve line breaks within the question text if they exist.
2.  **Extract Choices:** Identify and extract the full text for each corresponding option (typically labeled A, B, C, D, sometimes E, F). Start each choice on a new line, prefixed ONLY with its letter and a period (e.g., "A. Choice text here", "B. More choice text"). Preserve line breaks within the text of each individual choice if they exist. List all choices consecutively under their question.
3.  **Detect Answer:** Carefully examine the image to see which option letter (A, B, C, D, etc.) appears to be circled, underlined, checked, highlighted, or otherwise marked as the intended answer for that specific question.
4.  **Output Detected Answer:** On a new line, immediately following the *last* choice for that question, output the detected answer identification using the exact format: 'Detected Answer: LETTER' (e.g., 'Detected Answer: B'). If no answer is clearly marked or identifiable for a question, output exactly: 'Detected Answer: None'.

**Formatting Requirements:**
*   Ensure each complete question block (Question Text, followed by all its Choices, followed by its Detected Answer line) is clearly separated from the next question block by at least one blank line.
*   Output *only* the extracted text content and the 'Detected Answer:' lines as specified. Do not add any introductory text, summaries, or explanations before, between, or after the question blocks.
--- Example of ONE complete question block output:
Câu 1: Nội dung câu hỏi có thể có nhiều dòng.
Dòng thứ hai của câu hỏi.
A. Nội dung lựa chọn A.
B. Lựa chọn B cũng có thể
trải dài trên nhiều dòng.
C. Lựa chọn C.
D. Lựa chọn D.
Detected Answer: C

(Blank line here before the next question block starts)
"""
        request_payload = {"contents": [{"parts": [{"text": prompt_text}, {"inline_data": {"mime_type": mime_type, "data": base64_image}}]}], "generationConfig": {"temperature": 0.1, "maxOutputTokens": 8192}, "safetySettings": [{"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}, {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}, {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}, {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}]}
        headers = {'Content-Type': 'application/json'}
        response = requests.post(f"{GEMINI_API_ENDPOINT}?key={GEMINI_API_KEY}", headers=headers, json=request_payload, timeout=120)
        response.raise_for_status(); response_data = response.json(); extracted_text = ''
        try:
            candidate = response_data.get("candidates")
            if not candidate:
                prompt_feedback = response_data.get("promptFeedback")
                if prompt_feedback and prompt_feedback.get("blockReason"): return jsonify({"error": f"Yêu cầu bị chặn bởi dịch vụ xử lý: {prompt_feedback['blockReason']}."}), 500
                return jsonify({"error": "Phản hồi từ dịch vụ xử lý không hợp lệ."}), 500
            candidate = candidate[0]; content = candidate.get("content")
            if content and content.get("parts"): extracted_text = "\n".join(part.get("text", "") for part in content.get("parts", []) if "text" in part).strip()
            finish_reason = candidate.get("finishReason", "UNKNOWN")
            if finish_reason not in ["STOP", "MAX_TOKENS"]: details = "Lý do an toàn." if finish_reason == "SAFETY" else f"Lý do: {finish_reason}."; return jsonify({"error": f"Dịch vụ xử lý ngừng phản hồi. {details}"}), 500
            elif finish_reason == "MAX_TOKENS" and not extracted_text: app.logger.warning("Gemini response finished due to MAX_TOKENS with no text."); return jsonify({"error": "Dịch vụ xử lý đạt giới hạn token và không có nội dung trả về."}), 500
        except (IndexError, KeyError, TypeError) as e: app.logger.error(f"Error parsing Gemini response structure: {e}"); return jsonify({"error": "Không thể phân tích phản hồi từ dịch vụ xử lý."}), 500
        if not extracted_text: app.logger.error("Gemini API returned successful but no extracted text."); return jsonify({"error": "Dịch vụ xử lý phản hồi thành công nhưng không trích xuất được nội dung."}), 500
        app.logger.info(f"\n--- Raw Extracted Text from API ---\n{extracted_text}\n-----------------------------------")
        parsed_questions = parse_questions_from_text(extracted_text)
        return jsonify({"questions": parsed_questions})
    except requests.exceptions.Timeout: return jsonify({"error": "Yêu cầu đến dịch vụ xử lý bị quá thời gian. Vui lòng thử lại."}), 504
    except requests.exceptions.RequestException as req_err:
        status_code = req_err.response.status_code if req_err.response is not None else 503; user_error_msg = f"Lỗi giao tiếp với dịch vụ xử lý (mã {status_code})."
        if req_err.response is not None:
            try:
                error_details = req_err.response.json().get('error', {}); gemini_err_msg = error_details.get('message', '')
                if "API key not valid" in gemini_err_msg: user_error_msg = "Lỗi: Khóa API không hợp lệ. Vui lòng kiểm tra cấu hình máy chủ."
                elif status_code == 429: user_error_msg = "Lỗi: Đã vượt quá hạn ngạch sử dụng dịch vụ. Vui lòng thử lại sau."
                elif status_code >= 500: user_error_msg = "Lỗi từ máy chủ của dịch vụ xử lý. Vui lòng thử lại sau."
            except ValueError: user_error_msg = f"Lỗi giao tiếp với dịch vụ xử lý (mã {status_code}), phản hồi không đúng định dạng."
        else: user_error_msg = "Không thể kết nối đến dịch vụ xử lý. Vui lòng kiểm tra kết nối mạng."
        app.logger.error(f"Gemini API request error: {req_err} - User Msg: {user_error_msg}"); return jsonify({"error": user_error_msg}), status_code
    except Exception as e: app.logger.error(f"Unexpected error processing image: {e}", exc_info=True); return jsonify({"error": f"Đã xảy ra lỗi không mong muốn trên máy chủ."}), 500

# --- NEW ROUTE: Generate Questions from Study Guide Image ---
@app.route('/generate-questions-from-guide-image', methods=['POST'])
@login_required # Decide if guests can use this; for now, login required for auto-save benefits
def generate_questions_from_guide_image_route():
    if not GEMINI_API_KEY:
        app.logger.error("GEMINI_API_KEY not configured.")
        return jsonify({"error": "Lỗi cấu hình từ máy chủ: Khóa API chưa được thiết lập."}), 500
    if 'guide_image' not in request.files:
        return jsonify({"error": "Không tìm thấy tệp ảnh hướng dẫn trong yêu cầu."}), 400
    file = request.files['guide_image']
    if file.filename == '':
        return jsonify({"error": "Chưa chọn tệp ảnh hướng dẫn nào."}), 400

    try:
        image_bytes = file.read()
        base64_image = base64.b64encode(image_bytes).decode('utf-8')
        mime_type = file.mimetype
        num_questions_to_generate = int(request.form.get('num_questions', 5))

        prompt_text = f"""
        You are an AI assistant tasked with creating educational multiple-choice questions from an image of a study guide.
        The provided image contains textual information from a study guide (NOT a pre-existing quiz).
        Your goal is to generate {num_questions_to_generate} distinct multiple-choice questions based *solely* on the content visible in the image.

        For EACH of the {num_questions_to_generate} questions you generate, please follow this precise format:
        1.  **Question Text:** Start with "Câu [QuestionNumber]:" followed by the question. The question should test understanding of a key piece of information.
        2.  **Choices:** Provide exactly four answer choices labeled A, B, C, and D.
            - Each choice should start on a new line, like "A. [Choice text]".
            - One choice must be the correct answer derived directly from the study guide content.
            - The other three choices should be plausible distractors: incorrect but related to the topic or sounding reasonable. Avoid choices that are obviously wrong or nonsensical.
        3.  **Indicate Correct Answer:** After the D choice, on a new line, write "Detected Answer: [CorrectLetter]" (e.g., "Detected Answer: B"). This indicates which of your generated choices (A, B, C, or D) is the correct one.

        Example of ONE generated question block:
        Câu 1: Ở cây, mục đích chính của quang hợp là gì?
        A. Hấp thụ nước từ đất.
        B. Tạo ra oxy cho động vật.
        C. Chuyển đổi năng lượng ánh sáng thành năng lượng hóa học (glucose).
        D. Phân giải chất hữu cơ.
        Detected Answer: C

        (Ensure a blank line separates each complete question block from the next if you generate more than one)

        Constraints:
        - Generate exactly {num_questions_to_generate} questions.
        - Base questions *only* on the provided image content. Do not use external knowledge.
        - Ensure questions are clear, concise, and test different aspects of the material if possible.
        - Ensure distractors are well-crafted.
        - Adhere strictly to the output format for easy parsing.
        - The user does not have the study guide with them when doing the test. So you should not say things like: according to the study guide, part 2b of. blah blah blah.
        """
        request_payload = {"contents": [{"parts": [{"text": prompt_text}, {"inline_data": {"mime_type": mime_type, "data": base64_image}}]}], "generationConfig": {"temperature": 0.5, "maxOutputTokens": 8192}, "safetySettings": [{"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}, {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}, {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}, {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}]}
        headers = {'Content-Type': 'application/json'}
        response = requests.post(f"{GEMINI_API_ENDPOINT}?key={GEMINI_API_KEY}", headers=headers, json=request_payload, timeout=180)
        response.raise_for_status(); response_data = response.json(); generated_text = ''
        try:
            candidate = response_data.get("candidates")
            if not candidate:
                prompt_feedback = response_data.get("promptFeedback")
                if prompt_feedback and prompt_feedback.get("blockReason"): return jsonify({"error": f"Yêu cầu bị chặn bởi dịch vụ AI: {prompt_feedback['blockReason']}."}), 500
                app.logger.error(f"Invalid response from AI for guide-to-questions: {response_data}"); return jsonify({"error": "Phản hồi từ dịch vụ AI không hợp lệ."}), 500
            candidate = candidate[0]; content = candidate.get("content")
            if content and content.get("parts"): generated_text = "\n".join(part.get("text", "") for part in content.get("parts", []) if "text" in part).strip()
            finish_reason = candidate.get("finishReason", "UNKNOWN")
            if finish_reason not in ["STOP", "MAX_TOKENS"]: details = f"Lý do: {finish_reason}.";
            if finish_reason == "SAFETY": details = "Nội dung có thể không an toàn."; return jsonify({"error": f"Dịch vụ AI ngừng phản hồi. {details}"}), 500
            elif finish_reason == "MAX_TOKENS" and not generated_text: app.logger.warning("AI response finished due to MAX_TOKENS with no text for guide-to-questions."); return jsonify({"error": "Dịch vụ AI đạt giới hạn token và không có nội dung trả về."}), 500
        except (IndexError, KeyError, TypeError) as e: app.logger.error(f"Lỗi phân tích phản hồi AI (guide-to-questions): {e}\nResponse data: {response_data}"); return jsonify({"error": "Không thể phân tích phản hồi từ dịch vụ AI."}), 500
        if not generated_text: app.logger.error("AI trả về thành công nhưng không có nội dung câu hỏi được tạo."); return jsonify({"error": "Dịch vụ AI phản hồi thành công nhưng không tạo được câu hỏi."}), 500
        app.logger.info(f"\n--- Raw Generated Questions Text from AI ---\n{generated_text}\n-----------------------------------")
        parsed_questions = parse_questions_from_text(generated_text)
        for q in parsed_questions:
            if q.get("detectedAnswer"): q["correctAnswer"] = q["detectedAnswer"]
        return jsonify({"questions": parsed_questions})
    except requests.exceptions.Timeout: return jsonify({"error": "Yêu cầu đến dịch vụ AI bị quá thời gian. Vui lòng thử lại."}), 504
    except requests.exceptions.RequestException as req_err:
        status_code = req_err.response.status_code if req_err.response is not None else 503; user_error_msg = f"Lỗi giao tiếp với dịch vụ AI (mã {status_code})."
        # ... (more detailed error messages)
        app.logger.error(f"AI API request error (guide-to-questions): {req_err} - User Msg: {user_error_msg}"); return jsonify({"error": user_error_msg}), status_code
    except Exception as e: app.logger.error(f"Lỗi không mong muốn khi tạo câu hỏi từ hướng dẫn: {e}", exc_info=True); return jsonify({"error": f"Đã xảy ra lỗi không mong muốn trên máy chủ."}), 500

@app.route('/generate-study-guide', methods=['POST'])
def generate_study_guide_route():
    # ... (This function remains unchanged from the previous full version) ...
    if not GEMINI_API_KEY: return jsonify({"error": "Lỗi cấu hình từ máy chủ: Khóa API chưa được thiết lập."}), 500
    data = request.get_json()
    if not data or 'quiz_data' not in data: return jsonify({"error": "Không nhận được dữ liệu bài kiểm tra."}), 400
    quiz_data_list = data['quiz_data']
    if not isinstance(quiz_data_list, list) or not quiz_data_list: return jsonify({"error": "Dữ liệu bài kiểm tra không hợp lệ hoặc rỗng."}), 400
    formatted_quiz_text_parts = []
    for i, q_data in enumerate(quiz_data_list):
        try:
            if not isinstance(q_data, dict): continue
            question_text = q_data.get("question", f"Câu hỏi {i+1} (thiếu nội dung)").strip(); choices = q_data.get("choices", {}); correct_answer_key = str(q_data.get("correctAnswer","")).upper().strip() if q_data.get("correctAnswer") else ""
            part = f"Câu hỏi {i+1}:\n{question_text}\n\nLựa chọn:\n"; valid_choices = {}
            if isinstance(choices, dict):
                for choice_key, choice_text in sorted(choices.items()):
                    if choice_text is not None: letter = str(choice_key).upper().strip(); valid_choices[letter] = str(choice_text).strip(); part += f"{letter}. {valid_choices[letter]}\n"
            else: part += "(Lỗi: Định dạng lựa chọn không đúng)\n"
            part += "\n"
            if correct_answer_key and correct_answer_key in valid_choices: part += f"Đáp án đúng: {correct_answer_key}. {valid_choices[correct_answer_key]}\n"
            elif correct_answer_key: part += f"Đáp án đúng: {correct_answer_key} (Nội dung lựa chọn này có thể bị thiếu hoặc sai định dạng)\n"
            else: part += "Đáp án đúng: (Chưa được cung cấp hoặc không hợp lệ)\n"
            formatted_quiz_text_parts.append(part.strip())
        except Exception as e: app.logger.error(f"Error formatting question {i+1} for study guide: {e}", exc_info=True); continue
    if not formatted_quiz_text_parts: return jsonify({"error": "Không thể định dạng câu hỏi nào để tạo hướng dẫn."}), 400
    full_quiz_content = "\n\n---\n\n".join(formatted_quiz_text_parts)
    study_guide_prompt = f"""Dựa trên các câu hỏi ... {full_quiz_content} ... Hãy tạo đề cương ôn tập.""" # Shortened
    request_payload = {"contents": [{"parts": [{"text": study_guide_prompt}]}], "generationConfig": {"temperature": 0.6, "maxOutputTokens": 8192}, "safetySettings": [{"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}, {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}, {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}, {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"}]}
    try:
        headers = {'Content-Type': 'application/json'}
        response = requests.post(f"{GEMINI_API_ENDPOINT}?key={GEMINI_API_KEY}", headers=headers, json=request_payload, timeout=180)
        response.raise_for_status(); response_data = response.json(); study_guide_text = ''
        try:
            candidate = response_data.get("candidates")
            if not candidate:
                prompt_feedback = response_data.get("promptFeedback")
                if prompt_feedback and prompt_feedback.get("blockReason"): return jsonify({"error": f"Yêu cầu tạo hướng dẫn bị chặn: {prompt_feedback['blockReason']}."}), 500
                return jsonify({"error": "Phản hồi tạo hướng dẫn từ dịch vụ không hợp lệ."}), 500
            candidate = candidate[0]; content = candidate.get("content")
            if content and content.get("parts"): study_guide_text = "\n".join(part.get("text", "") for part in content.get("parts", []) if "text" in part).strip()
            finish_reason = candidate.get("finishReason", "UNKNOWN")
            if finish_reason not in ["STOP", "MAX_TOKENS"]: details = "Lý do an toàn." if finish_reason == "SAFETY" else f"Lý do: {finish_reason}."; return jsonify({"error": f"Dịch vụ tạo hướng dẫn ngừng phản hồi. {details}"}), 500
            elif finish_reason == "MAX_TOKENS" and not study_guide_text: return jsonify({"error": "Dịch vụ tạo hướng dẫn đạt giới hạn token và không có nội dung."}), 500
        except (IndexError, KeyError, TypeError) as e: app.logger.error(f"Error parsing Gemini study guide response: {e}"); return jsonify({"error": "Không thể phân tích phản hồi tạo hướng dẫn từ dịch vụ."}), 500
        if not study_guide_text: return jsonify({"error": "Dịch vụ phản hồi thành công nhưng không tạo ra nội dung hướng dẫn."}), 500
        return jsonify({"study_guide_text": study_guide_text.strip()})
    except requests.exceptions.Timeout: return jsonify({"error": "Yêu cầu tạo hướng dẫn bị quá thời gian. Vui lòng thử lại."}), 504
    except requests.exceptions.RequestException as req_err:
        status_code = req_err.response.status_code if req_err.response is not None else 503; user_error_msg = f"Lỗi giao tiếp với dịch vụ tạo hướng dẫn (mã {status_code})."
        # ... (more detailed error messages)
        app.logger.error(f"Gemini API study guide error: {req_err} - User Msg: {user_error_msg}"); return jsonify({"error": user_error_msg}), status_code
    except Exception as e: app.logger.error(f"Error generating study guide: {e}", exc_info=True); return jsonify({"error": f"Đã xảy ra lỗi không mong muốn khi tạo hướng dẫn."}), 500

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
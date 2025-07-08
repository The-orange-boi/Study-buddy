// In APP/static/script.js

document.addEventListener('DOMContentLoaded', function() {
    // IS_USER_AUTHENTICATED is globally available from the inline script in index.html

    // --- Global State ---
    let currentQuizData = null;
    let currentQuizMetaData = { id: null, name: null, source: null };
    let displayedShuffledQuestions = [];
    let quizTimerInterval = null;
    let quizStartTime = 0;
    let quizTimeElapsed = 0;

    // --- DOM Elements ---
    const statusDiv = document.getElementById('status');
    const startPageSection = document.getElementById('startPageSection');
    const myQuizzesPageSection = document.getElementById('myQuizzesPageSection');
    const editQuizPageSection = document.getElementById('editQuizPageSection');
    const studyGuidePageSection = document.getElementById('studyGuidePageSection');
    const takeQuizPageSection = document.getElementById('takeQuizPageSection');
    const finalJsonOutputSection = document.getElementById('finalJsonOutputSection');
    const allPageSections = [startPageSection, editQuizPageSection, studyGuidePageSection, takeQuizPageSection, finalJsonOutputSection];
    if (myQuizzesPageSection && !allPageSections.includes(myQuizzesPageSection)) {
         allPageSections.push(myQuizzesPageSection);
    }

    const brandLink = document.getElementById('brandLink');
    const startPageLink = document.getElementById('startPageLink');
    const myQuizzesPageLink = document.getElementById('myQuizzesPageLink');
    const editQuizPageLink = document.getElementById('editQuizPageLink');
    const takeQuizPageLink = document.getElementById('takeQuizPageLink');
    const studyGuidePageLink = document.getElementById('studyGuidePageLink');
    const saveQuizLink = document.getElementById('saveQuizLink');

    const imageInput = document.getElementById('imageInput');
    const processButton = document.getElementById('processButton');
    const loadJsonInput = document.getElementById('loadJsonInput');
    const loadJsonInputLoggedIn = document.getElementById('loadJsonInputLoggedIn');
    const guideImageInput = document.getElementById('guideImageInput');
    const generateQuestionsFromGuideButton = document.getElementById('generateQuestionsFromGuideButton');
    const numQuestionsToGenerateInput = document.getElementById('numQuestionsToGenerate');


    const editQuizContent = document.getElementById('editQuizContent');
    const editControlsContainer = document.getElementById('editControlsContainer');

    const studyGuideOutput = document.getElementById('studyGuideOutput');
    const generateStudyGuideAction = document.getElementById('generateStudyGuideAction');

    const quizContainer = document.getElementById('quizContainer');
    const controlsContainer = document.getElementById('controlsContainer');
    const gradeButton = document.getElementById('gradeButton');
    const resultsContainer = document.getElementById('resultsContainer');
    const quizStatsSummary = document.getElementById('quizStatsSummary');
    const detailedResultsDiv = document.getElementById('detailedResults');
    const resultsActionsContainer = document.getElementById('resultsActionsContainer');
    const quizTimerDisplay = document.getElementById('quizTimerDisplay');

    const myQuizzesListContainer = document.getElementById('myQuizzesListContainer');
    const refreshMyQuizzesButton = document.getElementById('refreshMyQuizzesButton');

    // --- Utility Functions ---
    function updateStatus(message, type = 'info') {
        if(statusDiv) {
            statusDiv.textContent = `Trạng thái: ${message}`;
            statusDiv.className = `status-bar status-${type}`;
        }
    }

    function showPageSection(sectionToShow) {
        allPageSections.forEach(section => {
            if (section) section.classList.add('hidden');
        });
        if (sectionToShow) sectionToShow.classList.remove('hidden');
        window.scrollTo(0,0);

        if (quizTimerDisplay) {
            if (sectionToShow === takeQuizPageSection && currentQuizData && currentQuizData.length > 0 && displayedShuffledQuestions.length > 0) {
                // Timer will be made active by startQuizTimer
            } else {
                quizTimerDisplay.classList.remove('timer-active');
                quizTimerDisplay.classList.add('timer-inactive');
                if (quizTimerInterval) {
                    stopQuizTimer();
                }
            }
        }
    }

    function enableToolbarLink(linkElement) { if(linkElement) linkElement.classList.remove('toolbar-link-disabled');}
    function disableToolbarLink(linkElement) { if(linkElement) linkElement.classList.add('toolbar-link-disabled');}

    function updateToolbarActiveState(activeLink) {
        const allNavLinks = [startPageLink, myQuizzesPageLink, editQuizPageLink, takeQuizPageLink, studyGuidePageLink, saveQuizLink];
        allNavLinks.forEach(link => {
            if(link) link.classList.remove('active');
        });
        if(activeLink) activeLink.classList.add('active');
    }

    function disableAllQuizActionLinks() {
        disableToolbarLink(editQuizPageLink);
        disableToolbarLink(takeQuizPageLink);
        disableToolbarLink(studyGuidePageLink);
        disableToolbarLink(saveQuizLink);
    }
    function enableAllQuizActionLinks() {
        enableToolbarLink(editQuizPageLink);
        enableToolbarLink(takeQuizPageLink);
        enableToolbarLink(studyGuidePageLink);
        enableToolbarLink(saveQuizLink);
    }

    // === TIMER FUNCTIONS ===
    function formatTime(totalSeconds) {
        const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    function startQuizTimer() {
        console.log("startQuizTimer called");
        quizStartTime = Date.now();
        quizTimeElapsed = 0;

        if(quizTimerDisplay) {
            quizTimerDisplay.classList.remove('timer-inactive');
            quizTimerDisplay.classList.add('timer-active');
            const spanElement = quizTimerDisplay.querySelector('span');
            if (spanElement) {
                spanElement.textContent = 'Thời gian: 00:00:00';
            } else { console.error("Timer span element not found"); }
        } else { console.error("quizTimerDisplay DOM element not found!"); return; }

        if (quizTimerInterval) clearInterval(quizTimerInterval);

        quizTimerInterval = setInterval(() => {
            quizTimeElapsed = Math.floor((Date.now() - quizStartTime) / 1000);
            if(quizTimerDisplay) {
                const spanElement = quizTimerDisplay.querySelector('span');
                if (spanElement) spanElement.textContent = `Thời gian: ${formatTime(quizTimeElapsed)}`;
            }
        }, 1000);
    }

    function stopQuizTimer() {
        console.log("stopQuizTimer called");
        if (quizTimerInterval) clearInterval(quizTimerInterval);
        quizTimerInterval = null;
    }
    // === END TIMER FUNCTIONS ===

    // --- Navigation and Core Functionality ---
    async function processAndAutoSave(dataSourceFunction, sourceName, sourceIdentifier = null, eventForInputClear = null) {
        updateStatus(`Đang xử lý ${sourceName}...`, 'info');
        let processingButton = null;
        if (sourceName === "Ảnh Đề Thi" && processButton) processingButton = processButton;
        else if (sourceName === "Ảnh Hướng Dẫn" && generateQuestionsFromGuideButton) processingButton = generateQuestionsFromGuideButton;

        if (processingButton) processingButton.disabled = true;

        try {
            const questions = await dataSourceFunction();
            if (questions && questions.length > 0) {
                currentQuizData = questions;
                currentQuizMetaData = {
                    id: null,
                    name: null,
                    source: sourceName.toLowerCase().replace(/\s+/g, '').replace(/[()]/g, '')
                };
                displayedShuffledQuestions = [];

                updateStatus(`Trích xuất/tải thành công ${questions.length} câu hỏi từ ${sourceName}.`, 'success');
                displayEditableQuiz(currentQuizData);
                showPageSection(editQuizPageSection);
                updateToolbarActiveState(editQuizPageLink);
                enableAllQuizActionLinks();

                if (IS_USER_AUTHENTICATED) {
                    let defaultName = `Bài từ ${sourceName}`;
                    if (sourceIdentifier && sourceIdentifier.trim() !== "") defaultName += ` (${sourceIdentifier.trim()})`;
                    defaultName += ` lúc ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
                    await autoSaveOrUpdateQuiz(defaultName, true);
                }
            } else {
                currentQuizData = null; currentQuizMetaData = { id: null, name: null, source: null};
                displayedShuffledQuestions = [];
                updateStatus(`Không tìm thấy câu hỏi nào trong ${sourceName} hoặc dữ liệu rỗng.`, 'warning');
                disableAllQuizActionLinks();
            }
        } catch (error) {
            updateStatus(`Lỗi xử lý ${sourceName}: ${error.message}`, 'error');
            disableAllQuizActionLinks();
        } finally {
            if (processingButton) processingButton.disabled = false;
            if (eventForInputClear && eventForInputClear.target) {
                 eventForInputClear.target.value = '';
            }
        }
    }

    async function handleProcessImage() {
        if (!imageInput || !imageInput.files || imageInput.files.length === 0) {
            updateStatus('Vui lòng chọn một tệp ảnh đề thi.', 'warning'); return;
        }
        const file = imageInput.files[0];
        await processAndAutoSave(async () => {
            const formData = new FormData();
            formData.append('image', file);
            const response = await fetch('/process-image', { method: 'POST', body: formData });
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.error || `Lỗi máy chủ: ${response.status}`);
            return data.questions;
        }, "Ảnh Đề Thi", file.name.split('.')[0], {target: imageInput});
    }

    async function handleGenerateQuestionsFromGuide() {
        if (!guideImageInput || !guideImageInput.files || !guideImageInput.files.length === 0) {
            updateStatus('Vui lòng chọn một tệp ảnh hướng dẫn.', 'warning');
            return;
        }
        const file = guideImageInput.files[0];
        const numQuestions = numQuestionsToGenerateInput ? numQuestionsToGenerateInput.value : 5;

        await processAndAutoSave(async () => {
            const formData = new FormData();
            formData.append('guide_image', file);
            formData.append('num_questions', numQuestions);
            const response = await fetch('/generate-questions-from-guide-image', { method: 'POST', body: formData });
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.error || `Lỗi máy chủ: ${response.status}`);
            return data.questions;
        }, "Ảnh Hướng Dẫn", file.name.split('.')[0], {target: guideImageInput});
    }


    async function handleLoadJsonFromFile(event, inputSourceName) {
        const file = event.target.files[0];
        if (!file) return;
        await processAndAutoSave(async () => {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = function(e_reader) {
                    try {
                        const loadedData = JSON.parse(e_reader.target.result);
                        if (Array.isArray(loadedData) && loadedData.every(q => q.question && q.choices)) {
                            resolve(loadedData);
                        } else { throw new Error("Định dạng tệp không hợp lệ."); }
                    } catch (err) { reject(err); }
                };
                reader.onerror = () => reject(new Error("Lỗi đọc tệp."));
                reader.readAsText(file);
            });
        }, inputSourceName, file.name.split('.')[0], event);
    }

    function displayEditableQuiz(questions) {
        if (!editQuizContent || !editControlsContainer) return;
        editQuizContent.innerHTML = '';
        editControlsContainer.innerHTML = '';

        let quizTitleInfo = '(Bài mới)';
        if (currentQuizMetaData.name) {
            quizTitleInfo = `(Bài: ${currentQuizMetaData.name})`;
        } else if (currentQuizMetaData.source === 'ảnhđềthi') {
            quizTitleInfo = '(Từ ảnh đề thi)';
        } else if (currentQuizMetaData.source === 'ảnhhướngdẫn') {
            quizTitleInfo = '(AI tạo từ ảnh hướng dẫn)';
        } else if (currentQuizMetaData.source === 'tệpkhách' || currentQuizMetaData.source === 'tệpcụcbộ') {
            quizTitleInfo = '(Từ tệp)';
        }


        questions.forEach((q, index) => {
            const questionDiv = document.createElement('div');
            questionDiv.className = 'question-editor';
            const choices = (typeof q.choices === 'object' && q.choices !== null) ? q.choices : {};
            questionDiv.innerHTML = `
                <h4>Câu ${index + 1} ${index === 0 ? quizTitleInfo : ''}</h4>
                <label for="qtext_${index}">Nội dung câu hỏi:</label>
                <textarea id="qtext_${index}" data-idx="${index}" class="question-text-input">${q.question || ''}</textarea>
                <div class="choices-editor">
                    <p style="margin-bottom: 5px; font-weight:normal;">Các lựa chọn và đáp án đúng:</p>
                    ${Object.entries(choices).map(([key, value]) => `
                        <div class="choice-item">
                            <input type="radio" name="correctAnswer_${index}" id="correct_${index}_${key}" value="${key}" data-idx="${index}" class="correct-answer-radio" ${q.correctAnswer === key ? 'checked' : (q.detectedAnswer === key && !q.correctAnswer && q.correctAnswer !== '' ? 'checked' : '')}>
                            <label for="choice_${index}_${key}">${key}.</label>
                            <textarea id="choice_${index}_${key}" data-idx="${index}" data-choice="${key}" class="choice-text-input">${value || ''}</textarea>
                        </div>
                    `).join('')}
                </div>
                <p style="font-size:0.85em; margin-top:5px;">AI phát hiện/Đáp án gốc: ${q.detectedAnswer || 'Không có'}</p>
            `;
            editQuizContent.appendChild(questionDiv);
        });
        editControlsContainer.innerHTML = `
            <button id="confirmEditsAndStartButton" class="btn btn-primary"><i class="fas fa-play"></i> Xác nhận & Bắt đầu làm bài</button>
            ${IS_USER_AUTHENTICATED ? '<button id="confirmEditsAndSaveButton" class="btn btn-info"><i class="fas fa-save"></i> Xác nhận & Lưu vào tài khoản</button>' : ''}
        `;
        document.querySelectorAll('.question-text-input, .choice-text-input, .correct-answer-radio').forEach(input => {
            input.addEventListener('change', updateQuizDataFromEditor);
        });
        document.getElementById('confirmEditsAndStartButton').addEventListener('click', async () => {
            updateQuizDataFromEditor();
            if (IS_USER_AUTHENTICATED) {
                await autoSaveOrUpdateQuiz(currentQuizMetaData.name || "Bài đã sửa");
            }
            if (currentQuizData && currentQuizData.length > 0) {
                prepareAndStartQuiz(currentQuizData);
                showPageSection(takeQuizPageSection);
                updateToolbarActiveState(takeQuizPageLink);
            }
        });
        const confirmEditsSaveBtn = document.getElementById('confirmEditsAndSaveButton');
        if(confirmEditsSaveBtn) {
            confirmEditsSaveBtn.addEventListener('click', async () => {
                updateQuizDataFromEditor();
                if (IS_USER_AUTHENTICATED) {
                    await autoSaveOrUpdateQuiz(currentQuizMetaData.name || "Bài đã sửa");
                }
            });
        }
    }

    function updateQuizDataFromEditor() {
        if (!currentQuizData) return;
        currentQuizData.forEach((q, index) => {
            const qTextInput = document.getElementById(`qtext_${index}`);
            if (qTextInput) q.question = qTextInput.value.trim();
            if (!q.choices || typeof q.choices !== 'object') q.choices = {};
            Object.keys(q.choices).forEach(choiceKey => {
                const choiceTextInput = document.getElementById(`choice_${index}_${choiceKey}`);
                if (choiceTextInput) q.choices[choiceKey] = choiceTextInput.value.trim();
            });
            const correctAnswerRadio = document.querySelector(`input[name="correctAnswer_${index}"]:checked`);
            q.correctAnswer = correctAnswerRadio ? correctAnswerRadio.value : null;
        });
    }

    function prepareAndStartQuiz(originalQuestions) {
        if (!quizContainer || !controlsContainer) { console.error("Quiz container or controls container not found!"); return; }
        quizContainer.innerHTML = '';
        if(resultsContainer) resultsContainer.classList.add('hidden');
        if(detailedResultsDiv) detailedResultsDiv.innerHTML = '';
        if(resultsActionsContainer) resultsActionsContainer.innerHTML = '';

        if (!Array.isArray(originalQuestions) || originalQuestions.length === 0) {
            quizContainer.innerHTML = '<p><em>Không có câu hỏi nào để hiển thị. Dữ liệu bài kiểm tra có thể bị lỗi hoặc rỗng.</em></p>';
            if(controlsContainer) controlsContainer.classList.add('hidden');
            stopQuizTimer();
            if(quizTimerDisplay) quizTimerDisplay.classList.add('timer-inactive');
            return;
        }

        displayedShuffledQuestions = originalQuestions.map((q, index) => ({ originalQuestion: q, originalIndex: index }));
        for (let i = displayedShuffledQuestions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [displayedShuffledQuestions[i], displayedShuffledQuestions[j]] = [displayedShuffledQuestions[j], displayedShuffledQuestions[i]];
        }

        displayedShuffledQuestions.forEach((shuffledItem, displayedIndex) => {
            const q = shuffledItem.originalQuestion;
            const questionItem = document.createElement('div');
            questionItem.className = 'question-item';
            questionItem.setAttribute('data-displayed-index', displayedIndex);
            let choicesHTML = '<div class="choices">';
            const originalChoicesData = (typeof q.choices === 'object' && q.choices !== null) ? q.choices : {};
            if (Object.keys(originalChoicesData).length > 0) {
                let choiceEntries = Object.entries(originalChoicesData);
                for (let i = choiceEntries.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [choiceEntries[i], choiceEntries[j]] = [choiceEntries[j], choiceEntries[i]];
                }
                choiceEntries.forEach(([originalChoiceKey, choiceValue], choiceDisplayOrderIndex) => {
                    const displayLetter = String.fromCharCode(65 + choiceDisplayOrderIndex);
                    choicesHTML += `
                        <div class="choice-wrapper">
                            <input type="radio" name="q_disp_${displayedIndex}" id="q_disp_${displayedIndex}_val_${originalChoiceKey}" value="${originalChoiceKey}">
                            <label for="q_disp_${displayedIndex}_val_${originalChoiceKey}">${displayLetter}. ${choiceValue || ''}</label>
                        </div>
                    `;
                });
            } else { choicesHTML += '<p><em>(Không có lựa chọn nào cho câu hỏi này)</em></p>'; }
            choicesHTML += '</div>';
            const questionText = q.question || '(Nội dung câu hỏi bị thiếu)';
            questionItem.innerHTML = `<p class="question-text"><strong>Câu ${displayedIndex + 1}:</strong> ${questionText}</p>${choicesHTML}`;
            quizContainer.appendChild(questionItem);
        });

        if(controlsContainer) controlsContainer.classList.remove('hidden');
        startQuizTimer();
    }

    async function gradeQuiz() {
        stopQuizTimer();
        if (!displayedShuffledQuestions || displayedShuffledQuestions.length === 0 || !quizContainer) {
            updateStatus("Không có dữ liệu bài làm để chấm.", "warning"); return;
        }
        let correctAnswersCount = 0;
        let totalQuestions = displayedShuffledQuestions.length;

        displayedShuffledQuestions.forEach((shuffledItem, displayedIndex) => {
            const originalQuestion = shuffledItem.originalQuestion;
            const originalIndexInCurrentData = shuffledItem.originalIndex;
            const questionItemDivInQuiz = quizContainer.querySelector(`.question-item[data-displayed-index="${displayedIndex}"]`);
            const userAnswerRadio = quizContainer.querySelector(`input[name="q_disp_${displayedIndex}"]:checked`);
            const userAnswerOriginalKey = userAnswerRadio ? userAnswerRadio.value : null;

            if (currentQuizData && currentQuizData[originalIndexInCurrentData]) {
                currentQuizData[originalIndexInCurrentData].userAnswer = userAnswerOriginalKey;
            }

            if (questionItemDivInQuiz) {
                questionItemDivInQuiz.classList.remove('correct', 'incorrect', 'no-answer');
                const oldFeedback = questionItemDivInQuiz.querySelector('.item-feedback');
                if (oldFeedback) oldFeedback.remove();
                const feedbackDiv = document.createElement('div');
                feedbackDiv.className = 'item-feedback';
                if (userAnswerOriginalKey === originalQuestion.correctAnswer) {
                    correctAnswersCount++;
                    questionItemDivInQuiz.classList.add('correct');
                    feedbackDiv.innerHTML = `Bạn đã trả lời đúng!`;
                } else if (userAnswerOriginalKey) {
                    questionItemDivInQuiz.classList.add('incorrect');
                    feedbackDiv.innerHTML = `Sai. Đáp án đúng là: <span class="correct-answer-highlight">${originalQuestion.correctAnswer}. ${originalQuestion.choices[originalQuestion.correctAnswer] || ''}</span>`;
                    const incorrectLabel = questionItemDivInQuiz.querySelector(`label[for="q_disp_${displayedIndex}_val_${userAnswerOriginalKey}"]`);
                    if(incorrectLabel) incorrectLabel.classList.add('user-answer-incorrect');
                } else {
                    questionItemDivInQuiz.classList.add('no-answer');
                    feedbackDiv.innerHTML = `Chưa trả lời. Đáp án đúng là: <span class="correct-answer-highlight">${originalQuestion.correctAnswer}. ${originalQuestion.choices[originalQuestion.correctAnswer] || ''}</span>`;
                }
                questionItemDivInQuiz.appendChild(feedbackDiv);
            }
        });
        const accuracy = totalQuestions > 0 ? parseFloat((correctAnswersCount / totalQuestions * 100).toFixed(2)) : 0;

        if (IS_USER_AUTHENTICATED && currentQuizMetaData.id) {
            try {
                const response = await fetch(`/record-quiz-attempt/${currentQuizMetaData.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ score_percentage: accuracy })
                });
                if(response.ok) { const result = await response.json(); updateStatus(result.message || "Kết quả đã được ghi nhận.", "info"); }
                else { const errorResult = await response.json(); updateStatus(`Lỗi ghi nhận kết quả: ${errorResult.error || response.statusText}`, "error"); }
            } catch (error) { console.error("Lỗi mạng khi ghi nhận kết quả:", error); updateStatus("Lỗi mạng khi ghi nhận kết quả.", "error"); }
        }

        if(document.getElementById('statsTotal')) document.getElementById('statsTotal').textContent = totalQuestions;
        if(document.getElementById('statsCorrect')) document.getElementById('statsCorrect').textContent = correctAnswersCount;
        if(document.getElementById('statsIncorrect')) document.getElementById('statsIncorrect').textContent = totalQuestions - correctAnswersCount;
        if(document.getElementById('statsAccuracy')) document.getElementById('statsAccuracy').textContent = accuracy;
        if(document.getElementById('statsTimeTaken')) document.getElementById('statsTimeTaken').textContent = formatTime(quizTimeElapsed);

        if(detailedResultsDiv) detailedResultsDiv.innerHTML = '';
        if(quizContainer) {
            quizContainer.querySelectorAll('.question-item').forEach(item => {
                if(detailedResultsDiv) detailedResultsDiv.appendChild(item.cloneNode(true));
            });
        }
        if(quizContainer) quizContainer.innerHTML = '<p><em>Bài kiểm tra đã được chấm. Xem kết quả bên dưới.</em></p>';
        if(resultsContainer) resultsContainer.classList.remove('hidden');
        if(controlsContainer) controlsContainer.classList.add('hidden');

        if(resultsActionsContainer) {
            resultsActionsContainer.innerHTML = `
                <button id="retakeQuizButton" class="btn btn-primary"><i class="fas fa-redo"></i> Làm lại bài này</button>
                <button id="newQuizButton" class="btn btn-secondary"><i class="fas fa-plus-circle"></i> Làm bài kiểm tra mới</button>
            `;
            const retakeBtn = document.getElementById('retakeQuizButton');
            if(retakeBtn) retakeBtn.addEventListener('click', () => { resetQuizInterface(); if (currentQuizData) prepareAndStartQuiz(currentQuizData); });
            const newQuizBtn = document.getElementById('newQuizButton');
            if(newQuizBtn) newQuizBtn.addEventListener('click', () => {
                currentQuizData = null; currentQuizMetaData = { id: null, name: null, source: null};
                displayedShuffledQuestions = [];
                resetQuizInterface(); disableAllQuizActionLinks();
                showPageSection(startPageSection); updateToolbarActiveState(startPageLink);
                updateStatus('Sẵn sàng cho bài kiểm tra mới.', 'info');
            });
        }
        if(resultsContainer) window.scrollTo(0, resultsContainer.offsetTop - 80);
    }

    function resetQuizInterface() {
        if(quizContainer) quizContainer.innerHTML = '<p><em>Vui lòng chuẩn bị hoặc tải dữ liệu bài kiểm tra để bắt đầu.</em></p>';
        if(detailedResultsDiv) detailedResultsDiv.innerHTML = '';
        if(resultsContainer) resultsContainer.classList.add('hidden');
        if(controlsContainer) controlsContainer.classList.add('hidden');
        stopQuizTimer();
        if(quizTimerDisplay) {
            quizTimerDisplay.classList.remove('timer-active');
            quizTimerDisplay.classList.add('timer-inactive');
            const spanElement = quizTimerDisplay.querySelector('span');
            if(spanElement) spanElement.textContent = 'Thời gian: 00:00:00';
        }
    }

    async function handleGenerateStudyGuide() {
        updateQuizDataFromEditor();
        if (!currentQuizData || currentQuizData.filter(q => q.correctAnswer).length === 0) {
            updateStatus('Vui lòng chọn đáp án đúng cho các câu hỏi trước khi tạo hướng dẫn.', 'warning');
            if(studyGuideOutput) studyGuideOutput.innerHTML = `<p><em>Lỗi: Cần có đáp án đúng để tạo hướng dẫn.</em></p>`;
            return;
        }
        if(studyGuideOutput) studyGuideOutput.innerHTML = `<p><em>Đang tạo hướng dẫn ôn tập, vui lòng đợi...</em></p>`;
        if(generateStudyGuideAction) generateStudyGuideAction.disabled = true;
        try {
            const response = await fetch('/generate-study-guide', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ quiz_data: currentQuizData }),
            });
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.error || `Lỗi máy chủ: ${response.status}`);
            if (data.study_guide_text) {
                let htmlContent = data.study_guide_text
                    .replace(/^### (.*$)/gim, '<h3>$1</h3>').replace(/^## (.*$)/gim, '<h2>$1</h2>')
                    .replace(/^# (.*$)/gim, '<h1>$1</h1>').replace(/^\* (.*$)/gim, '<li>$1</li>')
                    .replace(/^\s*-\s(.*$)/gim, '<li>$1</li>').replace(/^\d+\.\s(.*$)/gim, '<li>$1</li>')
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>')
                    .replace(/\n/g, '<br>');
                htmlContent = htmlContent.replace(/(<li>.*?<\/li>(<br>)*)+/gs, match => `<ul>${match.replace(/<br>/g, '')}</ul>`).replace(/<ul>\s*<ul>/g, '<ul><ul>');
                if(studyGuideOutput) studyGuideOutput.innerHTML = htmlContent;
                updateStatus('Tạo hướng dẫn ôn tập thành công.', 'success');
            } else { if(studyGuideOutput) studyGuideOutput.innerHTML = `<p><em>Không nhận được nội dung hướng dẫn.</em></p>`; }
        } catch (error) {
            console.error('Lỗi tạo hướng dẫn:', error);
            if(studyGuideOutput) studyGuideOutput.innerHTML = `<p><em>Lỗi: ${error.message}</em></p>`;
        } finally { if(generateStudyGuideAction) generateStudyGuideAction.disabled = false; }
    }

    function saveQuizToFile(quizData, filename = 'quiz_data.quizdata') {
        if (!quizData || quizData.length === 0) {
            updateStatus('Không có dữ liệu bài kiểm tra để lưu.', 'warning'); return;
        }
        try {
            const jsonData = JSON.stringify(quizData, null, 2);
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a); URL.revokeObjectURL(url);
            updateStatus(`Đã lưu bài kiểm tra vào tệp "${filename}".`, 'success');
        } catch (error) { updateStatus(`Lỗi khi lưu tệp: ${error.message}`, 'error'); }
    }

    async function autoSaveOrUpdateQuiz(defaultName = "Bài kiểm tra tự động lưu", isNewFromLoadOrImage = false) {
        if (!IS_USER_AUTHENTICATED || !currentQuizData || currentQuizData.length === 0) return null;
        let quizIdToUpdate = currentQuizMetaData.id;
        let nameForSave = currentQuizMetaData.name || defaultName;

        if (isNewFromLoadOrImage || !quizIdToUpdate) {
            quizIdToUpdate = null; // Ensure it's treated as new if isNewFromLoadOrImage is true
            const userProvidedName = prompt(`Nhập tên cho bài kiểm tra${isNewFromLoadOrImage ? ' mới' : ''} này (mặc định: "${nameForSave}"):`, nameForSave);
            if (userProvidedName === null) { updateStatus("Hủy lưu.", "info"); return null; }
            nameForSave = userProvidedName.trim() || nameForSave;
        }
        updateStatus(`Đang ${quizIdToUpdate ? 'cập nhật' : 'lưu'} bài '${nameForSave}'...`, 'info');
        try {
            const payload = { name: nameForSave, quiz_data: currentQuizData };
            if (quizIdToUpdate) payload.quiz_id = quizIdToUpdate;
            const response = await fetch('/save-quiz-to-account', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!response.ok || result.error) throw new Error(result.error || `Lỗi máy chủ: ${response.status}`);
            updateStatus(result.message, 'success');
            currentQuizMetaData.id = result.quiz_id;
            currentQuizMetaData.name = result.quiz_name;
            currentQuizMetaData.source = 'account'; // Source becomes account after saving
            if (myQuizzesPageSection && !myQuizzesPageSection.classList.contains('hidden')) await loadAndDisplayMyQuizzes();
            return result;
        } catch (error) {
            updateStatus(`Lỗi ${quizIdToUpdate ? 'cập nhật' : 'lưu'} bài: ${error.message}`, 'error');
            return null;
        }
    }

    async function loadAndDisplayMyQuizzes() {
        if (!IS_USER_AUTHENTICATED || !myQuizzesListContainer) return;
        myQuizzesListContainer.innerHTML = '<p><em>Đang tải danh sách bài kiểm tra...</em></p>';
        updateStatus('Đang tải bài kiểm tra của bạn...', 'info');
        try {
            const response = await fetch('/my-quizzes');
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.error || `Lỗi máy chủ: ${response.status}`);
            if (data.quizzes && data.quizzes.length > 0) {
                myQuizzesListContainer.innerHTML = '';
                const ul = document.createElement('ul');
                ul.className = 'quiz-list';
                data.quizzes.forEach(quiz => {
                    const li = document.createElement('li');
                    let progressHTML = '<span class="quiz-progress no-attempt">Chưa làm</span>';
                    if (quiz.last_score_percentage !== null && quiz.last_score_percentage !== undefined) {
                        let scoreClass = 'bad';
                        if (quiz.last_score_percentage >= 70) scoreClass = 'good';
                        else if (quiz.last_score_percentage >= 50) scoreClass = 'average';
                        progressHTML = `<span class="quiz-progress ${scoreClass}">Điểm: ${quiz.last_score_percentage}%</span>`;
                        if(quiz.last_attempt_date) progressHTML += ` <small>(${new Date(quiz.last_attempt_date).toLocaleDateString()})</small>`;
                    }
                    const updatedDate = new Date(quiz.updated_at);
                    li.innerHTML = `
                        <div class="quiz-info"> <span class="quiz-name">${quiz.name}</span> ${progressHTML} </div>
                        <span class="quiz-meta">Cập nhật: ${updatedDate.toLocaleString()}</span>
                        <div class="quiz-actions">
                            <button class="take-quiz-from-list-btn btn btn-sm btn-outline-success" data-quiz-id="${quiz.id}" data-quiz-name="${quiz.name}"><i class="fas fa-play-circle"></i> Làm bài</button>
                            <button class="load-quiz-btn btn btn-sm btn-outline-primary" data-quiz-id="${quiz.id}"><i class="fas fa-edit"></i> Tải & Sửa</button>
                            <button class="delete-quiz-btn btn btn-sm btn-outline-danger" data-quiz-id="${quiz.id}" data-quiz-name="${quiz.name}"><i class="fas fa-trash-alt"></i> Xóa</button>
                        </div>
                    `;
                    ul.appendChild(li);
                });
                myQuizzesListContainer.appendChild(ul);
                updateStatus(`Đã tải ${data.quizzes.length} bài kiểm tra.`, 'success');
                document.querySelectorAll('.take-quiz-from-list-btn').forEach(b => b.addEventListener('click', handleTakeQuizFromAccount));
                document.querySelectorAll('.load-quiz-btn').forEach(b => b.addEventListener('click', handleLoadQuizFromAccount));
                document.querySelectorAll('.delete-quiz-btn').forEach(b => b.addEventListener('click', handleDeleteQuizFromAccount));
            } else {
                myQuizzesListContainer.innerHTML = '<p><em>Bạn chưa có bài kiểm tra nào được lưu.</em></p>';
                updateStatus('Không tìm thấy bài kiểm tra nào.', 'info');
            }
        } catch (error) {
            if(myQuizzesListContainer) myQuizzesListContainer.innerHTML = `<p><em>Lỗi tải danh sách: ${error.message}</em></p>`;
            updateStatus(`Lỗi: ${error.message}`, 'error');
        }
    }

    async function fetchQuizDataById(quizId) { // Helper function to fetch quiz data
        const response = await fetch(`/load-quiz-from-account/${quizId}`);
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || `Lỗi máy chủ: ${response.status}`);
        return data;
    }

    async function handleTakeQuizFromAccount(event) {
        const quizId = event.target.closest('button').dataset.quizId; // Ensure we get dataset from button
        const quizName = event.target.closest('button').dataset.quizName;
        if (!quizId) return;
        updateStatus(`Đang chuẩn bị bài kiểm tra "${quizName}"...`, 'info');
        try {
            const data = await fetchQuizDataById(quizId);
            if (data.quiz_data) {
                currentQuizData = data.quiz_data;
                currentQuizMetaData = { id: data.id, name: data.name, source: 'account' };
                displayedShuffledQuestions = [];
                updateStatus(`Đã tải bài "${data.name}". Sẵn sàng làm bài.`, 'success');
                prepareAndStartQuiz(currentQuizData);
                showPageSection(takeQuizPageSection);
                updateToolbarActiveState(takeQuizPageLink);
                enableAllQuizActionLinks(); // Make sure take quiz link and others are enabled
            } else {
                updateStatus('Không thể tải dữ liệu bài kiểm tra để làm bài.', 'warning');
            }
        } catch (error) {
            updateStatus(`Lỗi khi chuẩn bị bài kiểm tra: ${error.message}`, 'error');
        }
    }


    async function handleLoadQuizFromAccount(event) {
        const quizId = event.target.closest('button').dataset.quizId; // Ensure we get dataset from button
        if (!quizId) return;
        updateStatus(`Đang tải bài kiểm tra ID: ${quizId}...`, 'info');
        try {
            const data = await fetchQuizDataById(quizId); // Use helper
            if (data.quiz_data) {
                currentQuizData = data.quiz_data;
                currentQuizMetaData = { id: data.id, name: data.name, source: 'account' };
                displayedShuffledQuestions = [];
                updateStatus(`Đã tải thành công bài kiểm tra "${data.name}".`, 'success');
                displayEditableQuiz(currentQuizData);
                showPageSection(editQuizPageSection);
                updateToolbarActiveState(editQuizPageLink);
                enableAllQuizActionLinks();
            } else { updateStatus('Không thể tải dữ liệu bài kiểm tra.', 'warning'); }
        } catch (error) { updateStatus(`Lỗi tải bài: ${error.message}`, 'error'); }
    }

    async function handleDeleteQuizFromAccount(event) {
        const quizId = event.target.closest('button').dataset.quizId; // Ensure we get dataset from button
        const quizName = event.target.closest('button').dataset.quizName;
        if (!quizId || !confirm(`Bạn có chắc chắn muốn xóa bài kiểm tra "${quizName}" không?`)) return;
        updateStatus(`Đang xóa bài kiểm tra "${quizName}"...`, 'info');
        try {
            const response = await fetch(`/delete-quiz-from-account/${quizId}`, { method: 'DELETE' });
            const result = await response.json();
            if (!response.ok || result.error) throw new Error(result.error || `Lỗi máy chủ: ${response.status}`);
            updateStatus(result.message || `Đã xóa "${quizName}" thành công.`, 'success');
            await loadAndDisplayMyQuizzes();
        } catch (error) { updateStatus(`Lỗi xóa bài: ${error.message}`, 'error'); }
    }

    // --- Toolbar "Lưu Bài" Button ---
    if (saveQuizLink) {
        saveQuizLink.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!currentQuizData || currentQuizData.length === 0) {
                updateStatus('Không có dữ liệu bài kiểm tra để lưu.', 'warning'); return;
            }
            updateQuizDataFromEditor(); // Ensure latest edits are captured if user is on edit page
            if (IS_USER_AUTHENTICATED) {
                await autoSaveOrUpdateQuiz(currentQuizMetaData.name || "Bài đã lưu thủ công");
            } else { saveQuizToFile(currentQuizData); }
        });
    }

    // --- Event Listeners Setup ---
    if (processButton) processButton.addEventListener('click', handleProcessImage);
    if (generateQuestionsFromGuideButton) generateQuestionsFromGuideButton.addEventListener('click', handleGenerateQuestionsFromGuide);
    if (loadJsonInput && !IS_USER_AUTHENTICATED) {
        loadJsonInput.addEventListener('change', (e) => handleLoadJsonFromFile(e, "Tệp (Khách)"));
    }
    if (loadJsonInputLoggedIn && IS_USER_AUTHENTICATED) {
         loadJsonInputLoggedIn.addEventListener('change', (e) => handleLoadJsonFromFile(e, "Tệp (Cục bộ)"));
    }
    if (gradeButton) gradeButton.addEventListener('click', gradeQuiz);
    if (generateStudyGuideAction) generateStudyGuideAction.addEventListener('click', handleGenerateStudyGuide);

    if (startPageLink) startPageLink.addEventListener('click', (e) => { e.preventDefault(); showPageSection(startPageSection); updateToolbarActiveState(startPageLink); if (resultsContainer && !resultsContainer.classList.contains('hidden')) resetQuizInterface(); });
    if (brandLink && window.location.pathname.startsWith('/app')) brandLink.addEventListener('click', (e) => { e.preventDefault(); showPageSection(startPageSection); updateToolbarActiveState(startPageLink); if (resultsContainer && !resultsContainer.classList.contains('hidden')) resetQuizInterface(); });
    if (myQuizzesPageLink) myQuizzesPageLink.addEventListener('click', async (e) => { e.preventDefault(); if (IS_USER_AUTHENTICATED) { showPageSection(myQuizzesPageSection); updateToolbarActiveState(myQuizzesPageLink); await loadAndDisplayMyQuizzes(); } else { updateStatus('Vui lòng đăng nhập.', 'warning');}});
    if (editQuizPageLink) editQuizPageLink.addEventListener('click', (e) => { e.preventDefault(); if (currentQuizData && currentQuizData.length > 0) { displayEditableQuiz(currentQuizData); showPageSection(editQuizPageSection); updateToolbarActiveState(editQuizPageLink); } else { updateStatus('Không có dữ liệu để sửa.', 'warning'); }});
    if (takeQuizPageLink) takeQuizPageLink.addEventListener('click', (e) => { e.preventDefault(); if (currentQuizData && currentQuizData.length > 0) { updateQuizDataFromEditor(); prepareAndStartQuiz(currentQuizData); showPageSection(takeQuizPageSection); updateToolbarActiveState(takeQuizPageLink); } else { updateStatus('Không có dữ liệu để làm bài.', 'warning'); }});
    if (studyGuidePageLink) studyGuidePageLink.addEventListener('click', (e) => { e.preventDefault(); showPageSection(studyGuidePageSection); updateToolbarActiveState(studyGuidePageLink); updateQuizDataFromEditor(); if (currentQuizData && currentQuizData.filter(q => q.correctAnswer).length > 0) { if(generateStudyGuideAction) generateStudyGuideAction.classList.remove('hidden'); if(studyGuideOutput) studyGuideOutput.innerHTML = `<p><em>Sẵn sàng tạo hướng dẫn.</em></p>`; } else { if(generateStudyGuideAction) generateStudyGuideAction.classList.add('hidden'); if(studyGuideOutput) studyGuideOutput.innerHTML = `<p><em>Cần đáp án đúng để tạo hướng dẫn.</em></p>`; }});
    if (refreshMyQuizzesButton) refreshMyQuizzesButton.addEventListener('click', loadAndDisplayMyQuizzes);

    // --- Initial Page Setup ---
    showPageSection(startPageSection);
    updateToolbarActiveState(startPageLink);
    disableAllQuizActionLinks();
    const flashedMessages = document.querySelector('#flashedMessagesContainer ul.flashes');
    if (!flashedMessages || flashedMessages.children.length === 0) {
        updateStatus('Sẵn sàng.', 'info');
    }
});
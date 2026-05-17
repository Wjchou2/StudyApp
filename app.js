import { firebaseConfig } from "./firebase-config.js";

const configured = Boolean(firebaseConfig?.projectId && firebaseConfig?.apiKey);
const firebase = {
    db: null,
    get: null,
    onDisconnect: null,
    onValue: null,
    ref: null,
    remove: null,
    set: null,
    update: null,
};

function makeId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
        globalThis.crypto.getRandomValues(bytes);
    } else {
        bytes.forEach((_, index) => {
            bytes[index] = Math.floor(Math.random() * 256);
        });
    }

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex
        .slice(8, 10)
        .join("")}-${hex.slice(10, 16).join("")}`;
}

const state = {
    role: "host",
    room: null,
    roomRef: null,
    playerRef: null,
    unsubscribe: null,
    disconnectTask: null,
    selfId: sessionStorage.getItem("quizforge-player-id") || makeId(),
    clock: null,
    answerRenderKey: "",
    previewQuestions: [],
    lastLessonInput: null,
};

sessionStorage.setItem("quizforge-player-id", state.selfId);

const els = {
    roomChip: document.querySelector("#roomChip"),
    cloudStatus: document.querySelector("#cloudStatus"),
    hostTab: document.querySelector("#hostTab"),
    joinTab: document.querySelector("#joinTab"),
    hostForm: document.querySelector("#hostForm"),
    joinForm: document.querySelector("#joinForm"),
    lessonFile: document.querySelector("#lessonFile"),
    lessonText: document.querySelector("#lessonText"),
    questionCount: document.querySelector("#questionCount"),
    timerSeconds: document.querySelector("#timerSeconds"),
    questionType: document.querySelector("#questionType"),
    joinCode: document.querySelector("#joinCode"),
    playerName: document.querySelector("#playerName"),
    emptyState: document.querySelector("#emptyState"),
    hostLobby: document.querySelector("#hostLobby"),
    previewView: document.querySelector("#previewView"),
    questionPreview: document.querySelector("#questionPreview"),
    regeneratePreview: document.querySelector("#regeneratePreview"),
    createRoomFromPreview: document.querySelector("#createRoomFromPreview"),
    studentLobby: document.querySelector("#studentLobby"),
    studentLobbyText: document.querySelector("#studentLobbyText"),
    hostCode: document.querySelector("#hostCode"),
    startGame: document.querySelector("#startGame"),
    questionView: document.querySelector("#questionView"),
    questionProgress: document.querySelector("#questionProgress"),
    timerBadge: document.querySelector("#timerBadge"),
    questionText: document.querySelector("#questionText"),
    answers: document.querySelector("#answers"),
    answerNote: document.querySelector("#answerNote"),
    resultsView: document.querySelector("#resultsView"),
    leaderboard: document.querySelector("#leaderboard"),
    resetGame: document.querySelector("#resetGame"),
    players: document.querySelector("#players"),
    playerCount: document.querySelector("#playerCount"),
};

const fallbackLesson = `Photosynthesis converts light energy into chemical energy.
Chloroplasts contain chlorophyll, which absorbs sunlight.
Reactants are carbon dioxide and water. Products are glucose and oxygen.
Cellular respiration releases energy from glucose in mitochondria.`;

function setMode(mode) {
    state.role = mode;
    els.hostTab.classList.toggle("is-active", mode === "host");
    els.joinTab.classList.toggle("is-active", mode === "join");
    els.hostForm.classList.toggle("is-hidden", mode !== "host");
    els.joinForm.classList.toggle("is-hidden", mode !== "join");
}

function makeCode() {
    const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from(
        { length: 6 },
        () => letters[Math.floor(Math.random() * letters.length)],
    ).join("");
}

function extractTerms(text) {
    const stopWords = new Set([
        "about",
        "after",
        "again",
        "also",
        "because",
        "before",
        "between",
        "could",
        "every",
        "from",
        "have",
        "into",
        "lesson",
        "their",
        "there",
        "these",
        "this",
        "through",
        "unit",
        "which",
        "with",
        "would",
    ]);

    return [...new Set(text.toLowerCase().match(/\b[a-z][a-z-]{4,}\b/g) || [])]
        .filter((word) => !stopWords.has(word))
        .slice(0, 40);
}

function sentencesFrom(text) {
    return text
        .replace(/\s+/g, " ")
        .split(/[.!?]/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 35);
}

function titleCase(text) {
    return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

function createFallbackQuestions(
    lessonText,
    count,
    questionType = "multiple-choice",
) {
    const text = lessonText.trim() || fallbackLesson;
    const sentences = sentencesFrom(text);
    const terms = extractTerms(text);
    const pool = sentences.length ? sentences : sentencesFrom(fallbackLesson);
    const fallbackTerms = extractTerms(fallbackLesson);
    const allTerms = terms.length >= 4 ? terms : [...terms, ...fallbackTerms];

    return Array.from({ length: count }, (_, index) => {
        const source = pool[index % pool.length];
        const answer = allTerms[index % allTerms.length] || "concept";
        const distractors = allTerms
            .filter((term) => term !== answer)
            .slice(index + 1)
            .concat(allTerms)
            .slice(0, 3);

        if (questionType === "open-ended") {
            return {
                type: "open-ended",
                text: source.toLowerCase().includes(answer)
                    ? `What term completes this lesson idea: "${source.replace(new RegExp(answer, "i"), "_____")}"?`
                    : `Name the lesson term most connected to this idea: "${source}".`,
                answer: titleCase(answer),
            };
        }

        const options = shuffle([answer, ...distractors]).map(titleCase);

        return {
            type: "multiple-choice",
            text: source.toLowerCase().includes(answer)
                ? `Which term best completes this lesson idea: "${source.replace(new RegExp(answer, "i"), "_____")}"?`
                : `Which lesson term is most connected to this idea: "${source}"?`,
            answer: titleCase(answer),
            options,
        };
    });
}

function shuffle(items) {
    return [...items].sort(() => Math.random() - 0.5);
}

function showGeminiDebug(details) {
    console.error("[Gemini generation debug]", details);
}

function cleanJsonText(text) {
    return text
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();
}

function validateQuestions(value, count, questionType) {
    if (!Array.isArray(value)) return null;
    const questions = value
        .map((item) => ({
            type: item.type === "open-ended" ? "open-ended" : "multiple-choice",
            text: String(item.text || item.question || "").trim(),
            answer: String(item.answer || "").trim(),
            options: Array.isArray(item.options)
                ? item.options.map((option) => String(option).trim())
                : [],
        }))
        .filter((item) => {
            if (questionType === "open-ended") {
                return item.text && item.answer;
            }
            return (
                item.text &&
                item.answer &&
                item.options.length >= 4 &&
                item.options.includes(item.answer)
            );
        })
        .map((item) =>
            questionType === "open-ended"
                ? { type: "open-ended", text: item.text, answer: item.answer }
                : {
                      type: "multiple-choice",
                      text: item.text,
                      answer: item.answer,
                      options: item.options.slice(0, 4),
                  },
        )
        .slice(0, count);

    return questions.length ? questions : null;
}

async function fileToInlinePart(file) {
    if (!file || file.type === "text/plain" || file.name.endsWith(".md"))
        return null;
    const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () =>
            resolve(String(reader.result).split(",")[1] || ""),
        );
        reader.addEventListener("error", () => reject(reader.error));
        reader.readAsDataURL(file);
    });

    return {
        inline_data: {
            mime_type: file.type || "application/pdf",
            data: base64,
        },
    };
}

async function generateGeminiQuestions({
    lessonText,
    filePart,
    count,
    questionType,
}) {
    // Frontend code is public. It must never contain Gemini API keys or other secrets.
    // The browser calls the Vercel serverless function, which reads GEMINI_API_KEY with process.env.
    const endpoint = "/api/gemini";
    const shape =
        questionType === "open-ended"
            ? `The JSON must be an array of objects with exactly these keys:
type: "open-ended"
text: string question
answer: concise string answer used for exact-match grading`
            : `The JSON must be an array of objects with exactly these keys:
type: "multiple-choice"
text: string question
options: array of exactly 4 short answer choices
answer: string that exactly matches one option`;

    const prompt = `Create ${count} ${questionType} classroom quiz questions from the provided lesson material.
Return only JSON, with no Markdown.
${shape}

Rules:
- Questions must be answerable from the lesson material.
- Avoid trick questions.
- Make distractors plausible but clearly wrong.
- Keep wording suitable for students.
- For open-ended questions, use answers short enough to grade by exact normalized text match.

Lesson text:
${lessonText || "Use the attached lesson file."}`;

    const parts = [{ text: prompt }];
    if (filePart) parts.push(filePart);

    const requestSummary = {
        stage: "request",
        endpoint,
        model: "gemini-2.5-flash",
        secretLocation: "Server-side only: Vercel process.env.GEMINI_API_KEY",
        lessonTextChars: lessonText?.length || 0,
        includesFile: Boolean(filePart),
        requestedQuestionCount: count,
        questionType,
    };
    showGeminiDebug(requestSummary);

    let response;
    try {
        response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts,
                    },
                ],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.35,
                },
            }),
        });
    } catch (error) {
        const details = {
            ...requestSummary,
            stage: "network",
            message: error.message,
            name: error.name,
            likelyCauses: [
                "The app is not running on Vercel or another server that provides /api/gemini",
                "The local static server cannot serve Vercel serverless functions",
                "Network or browser extension blocked the request",
            ],
        };
        showGeminiDebug(details);
        throw new Error(`Gemini network error: ${error.message}`);
    }

    const responseText = await response.text();
    if (!response.ok) {
        const details = {
            ...requestSummary,
            stage: "http",
            status: response.status,
            statusText: response.statusText,
            responseText,
            likelyCauses: [
                "GEMINI_API_KEY is missing from Vercel environment variables",
                "The serverless function returned a Gemini error",
                "Invalid key, quota, billing, or model access issue in the Gemini project",
            ],
        };
        showGeminiDebug(details);
        throw new Error(
            `Gemini request failed with HTTP ${response.status}: ${response.statusText}`,
        );
    }

    let data;
    try {
        data = JSON.parse(responseText);
    } catch (error) {
        const details = {
            ...requestSummary,
            stage: "response-json",
            message: error.message,
            responseText,
        };
        showGeminiDebug(details);
        throw new Error(`Gemini returned non-JSON response: ${error.message}`);
    }

    const text =
        data.candidates?.[0]?.content?.parts
            ?.map((part) => part.text || "")
            .join("") || "";
    let parsed;
    try {
        parsed = JSON.parse(cleanJsonText(text));
    } catch (error) {
        const details = {
            ...requestSummary,
            stage: "generated-json",
            message: error.message,
            rawCandidateText: text,
            fullResponse: data,
        };
        showGeminiDebug(details);
        throw new Error(`Gemini generated invalid JSON: ${error.message}`);
    }

    const questions = validateQuestions(parsed, count, questionType);
    if (!questions) {
        const details = {
            ...requestSummary,
            stage: "validation",
            message: "Generated JSON did not contain usable questions.",
            parsed,
            requiredShape: [
                {
                    text: "string",
                    options: ["A", "B", "C", "D"],
                    answer: "one exact option",
                },
            ],
        };
        showGeminiDebug(details);
        throw new Error("Gemini returned questions in an invalid format.");
    }

    showGeminiDebug({
        ...requestSummary,
        stage: "success",
        generatedQuestionCount: questions.length,
    });
    return questions;
}

async function createQuestionsFromLesson(input, count, questionType) {
    try {
        const questions = await generateGeminiQuestions({
            ...input,
            count,
            questionType,
        });
        els.cloudStatus.textContent = "Gemini generated the quiz.";
        els.cloudStatus.classList.remove("is-error");
        return questions;
    } catch (error) {
        console.error("[Gemini fallback reason]", error);
        els.cloudStatus.textContent =
            "Gemini unavailable. Using local fallback questions.";
        els.cloudStatus.classList.add("is-error");
        return createFallbackQuestions(input.lessonText, count, questionType);
    }
}

async function assertFirebaseReady() {
    if (firebase.db) return true;
    if (!configured || !firebaseConfig.databaseURL) {
        els.cloudStatus.textContent =
            "Add Firebase Realtime Database config in firebase-config.js.";
        els.cloudStatus.classList.add("is-error");
        return false;
    }

    try {
        const [{ initializeApp }, database] = await Promise.all([
            import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js"),
            import("https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js"),
        ]);
        const app = initializeApp(firebaseConfig);
        firebase.db = database.getDatabase(app);
        firebase.get = database.get;
        firebase.onDisconnect = database.onDisconnect;
        firebase.onValue = database.onValue;
        firebase.ref = database.ref;
        firebase.remove = database.remove;
        firebase.set = database.set;
        firebase.update = database.update;
        els.cloudStatus.textContent = "Realtime Database ready";
        els.cloudStatus.classList.remove("is-error");
        return true;
    } catch (error) {
        els.cloudStatus.textContent = `Could not load Realtime Database: ${error.message}`;
        els.cloudStatus.classList.add("is-error");
        return false;
    }
}

function roomDoc(code) {
    return firebase.ref(firebase.db, `rooms/${code}`);
}

function playersFrom(room) {
    return Object.values(room?.players || {});
}

function setRoomRef(code) {
    if (state.unsubscribe) state.unsubscribe();
    state.roomRef = roomDoc(code);
    state.unsubscribe = firebase.onValue(
        state.roomRef,
        (snapshot) => {
            if (!snapshot.exists()) {
                state.room = null;
                render();
                return;
            }
            state.room = snapshot.val();
            render();
        },
        (error) => {
            els.cloudStatus.textContent = `Cloud sync error: ${error.message}`;
            els.cloudStatus.classList.add("is-error");
        },
    );
}

async function createUniqueRoom(room) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = makeCode();
        const ref = roomDoc(code);
        const existing = await firebase.get(ref);
        if (!existing.exists()) {
            await firebase.set(ref, { ...room, code });
            setRoomRef(code);
            await setupPresence(code, true);
            return code;
        }
    }
    throw new Error("Could not create a unique room code. Try again.");
}

async function joinRoom(code, player) {
    const ref = roomDoc(code);
    const snapshot = await firebase.get(ref);
    if (!snapshot.exists()) return false;
    await firebase.update(ref, {
        [`players/${player.id}`]: player,
    });
    setRoomRef(code);
    await setupPresence(code, false);
    return true;
}

async function updateRoom(patch) {
    if (!state.roomRef) return;
    await firebase.update(state.roomRef, patch);
}

async function setupPresence(code, isHost) {
    if (state.disconnectTask?.cancel) {
        await state.disconnectTask.cancel();
    }

    state.playerRef = firebase.ref(
        firebase.db,
        `rooms/${code}/players/${state.selfId}`,
    );
    if (isHost) {
        state.disconnectTask = firebase.onDisconnect(roomDoc(code));
        await state.disconnectTask.remove();
    } else {
        state.disconnectTask = firebase.onDisconnect(state.playerRef);
        await state.disconnectTask.remove();
    }
}

async function leaveRoom() {
    clearInterval(state.clock);
    if (state.disconnectTask?.cancel) {
        await state.disconnectTask.cancel();
    }

    if (state.role === "host" && state.roomRef) {
        await firebase.remove(state.roomRef);
    } else if (state.playerRef) {
        await firebase.remove(state.playerRef);
    }

    if (state.unsubscribe) state.unsubscribe();
    state.room = null;
    state.roomRef = null;
    state.playerRef = null;
    state.disconnectTask = null;
    render();
}

function currentQuestion() {
    if (!state.room || state.room.currentQuestion < 0) return null;
    return state.room.questions[state.room.currentQuestion];
}

function remainingSeconds(room = state.room) {
    if (!room || room.status !== "question") return room?.timerSeconds || 0;
    const elapsed = Math.floor((Date.now() - room.questionStartedAt) / 1000);
    return Math.max(0, room.timerSeconds - elapsed);
}

function normalizeAnswer(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

async function gradeOpenEndedAnswer(question, studentAnswer) {
    const prompt = `Grade this student's open-ended answer.
Return only JSON with this exact shape:
{"correct": boolean, "reason": "short reason"}

Question: ${question.text}
Expected answer: ${question.answer}
Student answer: ${studentAnswer}

Mark correct if the student answer is semantically equivalent, even if wording differs.
Mark wrong if it is missing the key idea, too vague, or contradicts the expected answer.`;

    try {
        const response = await fetch("/api/gemini", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: prompt }],
                    },
                ],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0,
                },
            }),
        });

        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(
                `Gemini grading failed with HTTP ${response.status}: ${responseText}`,
            );
        }

        const data = JSON.parse(responseText);
        const text =
            data.candidates?.[0]?.content?.parts
                ?.map((part) => part.text || "")
                .join("") || "";
        const parsed = JSON.parse(cleanJsonText(text));
        if (typeof parsed.correct !== "boolean") {
            throw new Error("Gemini grading returned invalid JSON.");
        }
        return {
            correct: parsed.correct,
            reason: String(parsed.reason || "").trim(),
        };
    } catch (error) {
        console.error("[Gemini grading fallback reason]", error);
        return {
            correct:
                normalizeAnswer(studentAnswer) ===
                normalizeAnswer(question.answer),
            reason: "Fallback exact-match grading used.",
        };
    }
}

async function answerQuestion(option) {
    if (!state.room || state.room.status !== "question") return;
    const question = currentQuestion();
    const player = state.room.players?.[state.selfId];
    if (!question || !player || player.answers?.[state.room.currentQuestion])
        return;

    const grade =
        question.type === "open-ended"
            ? await gradeOpenEndedAnswer(question, option)
            : {
                  correct:
                      normalizeAnswer(option) ===
                      normalizeAnswer(question.answer),
                  reason: "",
              };
    const correct = grade.correct;
    const answers = {
        ...(player.answers || {}),
        [state.room.currentQuestion]: {
            option,
            correct,
            reason: grade.reason || "",
        },
    };

    await updateRoom({
        [`players/${state.selfId}/answers`]: answers,
    });
}

async function startQuestion(index) {
    clearInterval(state.clock);
    state.answerRenderKey = "";
    await updateRoom({
        currentQuestion: index,
        questionStartedAt: Date.now(),
        status: "question",
    });
    startQuestionClock();
}

async function revealQuestion() {
    if (!state.room || state.room.status !== "question") return;
    const questionIndex = state.room.currentQuestion;
    const alreadyScored = state.room.scoredQuestions?.[questionIndex];
    const patch = { status: "reveal" };

    if (!alreadyScored) {
        playersFrom(state.room).forEach((player) => {
            if (player.answers?.[questionIndex]?.correct) {
                patch[`players/${player.id}/score`] = (player.score || 0) + 1;
            }
        });
        patch[`scoredQuestions/${questionIndex}`] = true;
    }

    await updateRoom(patch);
}

function startQuestionClock() {
    clearInterval(state.clock);
    state.clock = setInterval(async () => {
        if (!state.room || state.room.status !== "question") return;
        renderQuestion();
        if (
            state.role === "host" &&
            (remainingSeconds() <= 0 || everyoneAnswered())
        ) {
            clearInterval(state.clock);
            await revealQuestion();
        }
    }, 500);
}

function everyoneAnswered() {
    const questionIndex = state.room.currentQuestion;
    const players = playersFrom(state.room);
    const contestants = players.filter(
        (player) => player.id !== state.room.hostId,
    );
    const requiredPlayers = contestants.length ? contestants : players;
    return (
        requiredPlayers.length > 0 &&
        requiredPlayers.every((player) => player.answers?.[questionIndex])
    );
}

async function nextQuestion() {
    const next = state.room.currentQuestion + 1;
    if (next >= state.room.questions.length) {
        await updateRoom({ status: "results" });
        return;
    }
    await startQuestion(next);
}

function showOnly(view) {
    [
        els.emptyState,
        els.hostLobby,
        els.previewView,
        els.studentLobby,
        els.questionView,
        els.resultsView,
    ].forEach((element) => {
        element.classList.add("is-hidden");
    });
    view.classList.remove("is-hidden");
}

function render() {
    const room = state.room;
    els.roomChip.textContent = room ? `Room ${room.code}` : "No room";
    els.cloudStatus.textContent =
        configured && firebaseConfig.databaseURL
            ? firebase.db
                ? "Realtime Database ready"
                : "Realtime Database configured"
            : "Firebase not configured";
    els.cloudStatus.classList.toggle(
        "is-error",
        !configured || !firebaseConfig.databaseURL,
    );

    if (!room) {
        showOnly(els.emptyState);
        renderPlayers([]);
        return;
    }

    if (room.status === "lobby") {
        clearInterval(state.clock);
        if (state.role === "host") {
            showOnly(els.hostLobby);
        } else {
            els.studentLobbyText.textContent = `You are in room ${room.code}.`;
            showOnly(els.studentLobby);
        }
    }
    if (room.status === "question") {
        renderQuestion();
        startQuestionClock();
    }
    if (room.status === "reveal") {
        clearInterval(state.clock);
        renderReveal();
    }
    if (room.status === "results") {
        clearInterval(state.clock);
        renderResults();
    }

    els.hostCode.textContent = room.code;
    renderPlayers(playersFrom(room));
}

function renderQuestion() {
    const room = state.room;
    const question = currentQuestion();
    if (!question) return;
    const ownAnswer =
        room.players?.[state.selfId]?.answers?.[room.currentQuestion];
    showOnly(els.questionView);

    els.questionProgress.textContent = `Question ${room.currentQuestion + 1} / ${room.questions.length}`;
    els.timerBadge.textContent = remainingSeconds(room);
    els.questionText.textContent = question.text;

    const answerKey = `${room.code}:${room.currentQuestion}:${ownAnswer?.option || "open"}`;
    if (state.answerRenderKey !== answerKey) {
        state.answerRenderKey = answerKey;
        els.answers.innerHTML = "";

        if (question.type === "open-ended") {
            const form = document.createElement("form");
            form.className = "open-answer";
            form.innerHTML = `
        <label>
          Answer
          <input class="open-answer-input" type="text" autocomplete="off" />
        </label>
        <button class="primary-btn" type="submit">Submit answer</button>
      `;
            const input = form.querySelector(".open-answer-input");
            if (ownAnswer) {
                input.value = ownAnswer.option;
                input.disabled = true;
                form.querySelector("button").disabled = true;
            }
            form.addEventListener("submit", (event) => {
                event.preventDefault();
                if (input.value.trim()) answerQuestion(input.value.trim());
            });
            els.answers.append(form);
        } else {
            question.options.forEach((option) => {
                const button = document.createElement("button");
                button.className = "answer-btn";
                button.type = "button";
                button.textContent = option;
                if (ownAnswer) {
                    button.disabled = true;
                    button.classList.toggle(
                        "selected",
                        ownAnswer.option === option,
                    );
                }
                button.addEventListener("click", () => answerQuestion(option));
                els.answers.append(button);
            });
        }
    }

    els.answerNote.textContent = ownAnswer
        ? "Answer submitted. Waiting for the reveal."
        : state.role === "host"
          ? "Waiting for responses. Results reveal after everyone answers or time runs out."
          : "Choose an answer before the timer ends.";
}

function renderReveal() {
    const room = state.room;
    const question = currentQuestion();
    if (!question) return;
    const players = playersFrom(room);
    const answeredCount = players.filter(
        (player) => player.answers?.[room.currentQuestion],
    ).length;

    showOnly(els.questionView);
    els.questionProgress.textContent = `Question ${room.currentQuestion + 1} / ${room.questions.length}`;
    els.timerBadge.textContent = "Done";
    els.questionText.textContent = question.text;
    els.answers.innerHTML = "";
    state.answerRenderKey = `reveal:${room.code}:${room.currentQuestion}:${answeredCount}`;

    const panel = document.createElement("div");
    panel.className = "reveal-panel";
    panel.innerHTML = `
    <div class="correct-answer">
      <span>Correct answer</span>
      <strong></strong>
    </div>
    <div class="response-grid"></div>
  `;
    panel.querySelector("strong").textContent = question.answer;
    const grid = panel.querySelector(".response-grid");

    players
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((player) => {
            const answer = player.answers?.[room.currentQuestion];
            const row = document.createElement("div");
            row.className = `response-row ${answer?.correct ? "is-correct" : "is-wrong"}`;
            row.innerHTML = `
        <div>
          <strong class="player-name"></strong>
          <p class="response-answer"></p>
        </div>
        <span class="result-pill"></span>
      `;
            row.querySelector(".player-name").textContent = player.name;
            row.querySelector(".response-answer").textContent = answer
                ? answer.option
                : "No answer";
            row.querySelector(".result-pill").textContent = answer?.correct
                ? "Right"
                : "Wrong";
            grid.append(row);
        });

    if (state.role === "host") {
        const button = document.createElement("button");
        button.className = "primary-btn";
        button.type = "button";
        button.textContent =
            room.currentQuestion + 1 >= room.questions.length
                ? "Show final results"
                : "Next question";
        button.addEventListener("click", nextQuestion);
        panel.append(button);
    }

    els.answers.append(panel);
    els.answerNote.textContent = `${answeredCount} of ${players.length} players answered.`;
}

function renderPlayers(players) {
    els.playerCount.textContent = players.length;
    els.players.innerHTML = "";

    if (!players.length) {
        els.players.innerHTML = `<p class="answer-note">No players yet.</p>`;
        return;
    }

    [...players]
        .sort((a, b) => b.score - a.score)
        .forEach((player) => {
            const row = document.createElement("div");
            row.className = "player-row";
            row.innerHTML = `<span class="player-name"></span><span class="score"></span>`;
            row.querySelector(".player-name").textContent = player.name;
            row.querySelector(".score").textContent = `${player.score}`;
            els.players.append(row);
        });
}

function renderResults() {
    showOnly(els.resultsView);
    els.leaderboard.innerHTML = "";

    [...playersFrom(state.room)]
        .sort((a, b) => b.score - a.score)
        .forEach((player, index) => {
            const row = document.createElement("div");
            row.className = "leader-row";
            row.innerHTML = `<strong></strong><span class="score"></span>`;
            row.querySelector("strong").textContent =
                `${index + 1}. ${player.name}`;
            row.querySelector(".score").textContent = `${player.score} pts`;
            els.leaderboard.append(row);
        });
}

function previewQuestionsFromForm() {
    return [...els.questionPreview.querySelectorAll(".preview-card")]
        .map((card) => {
            const type = card.dataset.questionType || "multiple-choice";
            const text = card.querySelector(".preview-question").value.trim();
            const answer = card.querySelector(".preview-answer").value.trim();
            if (type === "open-ended") {
                return { type, text, answer };
            }
            const options = [...card.querySelectorAll(".preview-option")]
                .map((input) => input.value.trim())
                .filter(Boolean);
            return { type, text, options, answer };
        })
        .filter((question) => {
            if (question.type === "open-ended")
                return question.text && question.answer;
            return (
                question.text &&
                question.options.length >= 4 &&
                question.options.includes(question.answer)
            );
        });
}

function syncAnswerSelect(card, selectedAnswer) {
    const select = card.querySelector(".preview-answer");
    const options = [...card.querySelectorAll(".preview-option")]
        .map((input) => input.value.trim())
        .filter(Boolean);
    select.innerHTML = "";
    options.forEach((option) => {
        const item = document.createElement("option");
        item.value = option;
        item.textContent = option;
        select.append(item);
    });
    select.value = options.includes(selectedAnswer)
        ? selectedAnswer
        : options[0] || "";
}

function renderQuestionPreview(questions) {
    state.previewQuestions = questions;
    els.questionPreview.innerHTML = "";

    questions.forEach((question, index) => {
        const card = document.createElement("article");
        card.className = "preview-card";
        card.dataset.questionType = question.type || "multiple-choice";
        const isOpenEnded = question.type === "open-ended";
        card.innerHTML = `
      <h3>Question ${index + 1}</h3>
      <label>
        Question
        <textarea class="preview-question" rows="3"></textarea>
      </label>
      <label>
        Correct answer
        ${isOpenEnded ? '<input class="preview-answer" type="text" />' : '<select class="preview-answer"></select>'}
      </label>
    `;

        card.querySelector(".preview-question").value = question.text;
        if (isOpenEnded) {
            card.querySelector(".preview-answer").value = question.answer;
            els.questionPreview.append(card);
            return;
        }

        const optionsWrap = document.createElement("div");
        optionsWrap.className = "preview-options";
        card.querySelector("label:last-child").before(optionsWrap);
        question.options.slice(0, 4).forEach((option, optionIndex) => {
            const label = document.createElement("label");
            label.textContent = `Option ${optionIndex + 1}`;
            const input = document.createElement("input");
            input.className = "preview-option";
            input.value = option;
            input.addEventListener("input", () =>
                syncAnswerSelect(
                    card,
                    card.querySelector(".preview-answer").value,
                ),
            );
            label.append(input);
            optionsWrap.append(label);
        });
        syncAnswerSelect(card, question.answer);
        els.questionPreview.append(card);
    });

    showOnly(els.previewView);
}

async function generatePreview() {
    els.cloudStatus.textContent = "Generating question preview...";
    els.cloudStatus.classList.remove("is-error");
    state.lastLessonInput = await readLessonInput();
    const questionCount = Number(els.questionCount.value);
    const questions = await createQuestionsFromLesson(
        state.lastLessonInput,
        questionCount,
        els.questionType.value,
    );
    renderQuestionPreview(questions);
}

async function createRoomFromPreview() {
    if (!(await assertFirebaseReady())) return;
    const questions = previewQuestionsFromForm();
    if (!questions.length) {
        els.cloudStatus.textContent =
            "Preview needs valid questions, four options, and a matching correct answer.";
        els.cloudStatus.classList.add("is-error");
        return;
    }

    const host = {
        id: state.selfId,
        name: "Host",
        score: 0,
        answers: {},
    };

    const code = await createUniqueRoom({
        hostId: state.selfId,
        status: "lobby",
        questions,
        timerSeconds: Math.max(1, Number(els.timerSeconds.value) || 30),
        questionStartedAt: 0,
        currentQuestion: -1,
        players: {
            [host.id]: host,
        },
        createdAt: Date.now(),
    });
    els.cloudStatus.textContent = `Room ${code} is live in Firebase.`;
    els.cloudStatus.classList.remove("is-error");
}

async function readLessonInput() {
    const typed = els.lessonText.value.trim();
    const file = els.lessonFile.files[0];
    if (!file) {
        return { lessonText: typed, filePart: null };
    }

    if (file.type === "text/plain" || file.name.endsWith(".md")) {
        return { lessonText: `${typed}\n${await file.text()}`, filePart: null };
    }

    return {
        lessonText: `${typed}\nUploaded file: ${file.name}.`,
        filePart: await fileToInlinePart(file),
    };
}

els.hostTab.addEventListener("click", () => setMode("host"));
els.joinTab.addEventListener("click", () => setMode("join"));

els.hostForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        await generatePreview();
    } catch (error) {
        els.cloudStatus.textContent = error.message;
        els.cloudStatus.classList.add("is-error");
    }
});

els.regeneratePreview.addEventListener("click", async () => {
    try {
        await generatePreview();
    } catch (error) {
        els.cloudStatus.textContent = error.message;
        els.cloudStatus.classList.add("is-error");
    }
});

els.createRoomFromPreview.addEventListener("click", async () => {
    try {
        await createRoomFromPreview();
    } catch (error) {
        els.cloudStatus.textContent = error.message;
        els.cloudStatus.classList.add("is-error");
    }
});

els.joinForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await assertFirebaseReady())) return;
    const code = els.joinCode.value.trim().toUpperCase();
    const player = {
        id: state.selfId,
        name: els.playerName.value.trim() || "Student",
        score: 0,
        answers: {},
    };

    const joined = await joinRoom(code, player);
    if (!joined) {
        els.joinCode.setCustomValidity("Room not found in Firebase.");
        els.joinCode.reportValidity();
        return;
    }

    els.joinCode.setCustomValidity("");
    els.cloudStatus.textContent = `Joined room ${code}.`;
    els.cloudStatus.classList.remove("is-error");
});

els.startGame.addEventListener("click", () => {
    if (!state.room || state.room.hostId !== state.selfId) return;
    startQuestion(0);
});

els.resetGame.addEventListener("click", async () => {
    await leaveRoom();
});

window.addEventListener("pagehide", () => {
    if (state.role === "host" && state.roomRef) {
        void firebase.remove(state.roomRef);
    } else if (state.playerRef) {
        void firebase.remove(state.playerRef);
    }
});

setMode("host");
render();

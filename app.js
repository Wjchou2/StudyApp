import { firebaseConfig } from "./firebase-config.js";

const configured = Boolean(firebaseConfig?.projectId && firebaseConfig?.apiKey);
const firebase = {
  db: null,
  get: null,
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
  unsubscribe: null,
  selfId: sessionStorage.getItem("quizforge-player-id") || makeId(),
  timer: null,
  answerRenderKey: "",
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
  joinCode: document.querySelector("#joinCode"),
  playerName: document.querySelector("#playerName"),
  emptyState: document.querySelector("#emptyState"),
  hostLobby: document.querySelector("#hostLobby"),
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
  return Array.from({ length: 6 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
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

function createQuestions(lessonText, count) {
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
    const options = shuffle([answer, ...distractors]).map(titleCase);

    return {
      text:
        source.toLowerCase().includes(answer)
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

async function assertFirebaseReady() {
  if (firebase.db) return true;
  if (!configured || !firebaseConfig.databaseURL) {
    els.cloudStatus.textContent = "Add Firebase Realtime Database config in firebase-config.js.";
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
  return true;
}

async function updateRoom(patch) {
  if (!state.roomRef) return;
  await firebase.update(state.roomRef, patch);
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

async function answerQuestion(option) {
  if (!state.room || state.room.status !== "question") return;
  const question = currentQuestion();
  const player = state.room.players?.[state.selfId];
  if (!question || !player || player.answers?.[state.room.currentQuestion]) return;

  const correct = option === question.answer;
  const answers = {
    ...(player.answers || {}),
    [state.room.currentQuestion]: { option, correct },
  };
  const score = correct ? player.score + 500 + remainingSeconds() * 5 : player.score;

  await updateRoom({
    [`players/${state.selfId}/answers`]: answers,
    [`players/${state.selfId}/score`]: score,
  });
}

async function startQuestion(index) {
  clearInterval(state.timer);
  await updateRoom({
    currentQuestion: index,
    questionStartedAt: Date.now(),
    status: "question",
  });
  startHostClock();
}

function startHostClock() {
  if (state.role !== "host") return;
  clearInterval(state.timer);
  state.timer = setInterval(async () => {
    if (!state.room || state.room.status !== "question") return;
    renderQuestion();
    if (remainingSeconds() <= 0 || everyoneAnswered()) {
      clearInterval(state.timer);
      await nextQuestion();
    }
  }, 500);
}

function everyoneAnswered() {
  const questionIndex = state.room.currentQuestion;
  const players = playersFrom(state.room);
  return players.length > 0 && players.every((player) => player.answers?.[questionIndex]);
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
  [els.emptyState, els.hostLobby, els.studentLobby, els.questionView, els.resultsView].forEach((element) => {
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
  els.cloudStatus.classList.toggle("is-error", !configured || !firebaseConfig.databaseURL);

  if (!room) {
    showOnly(els.emptyState);
    renderPlayers([]);
    return;
  }

  if (room.status === "lobby") {
    clearInterval(state.timer);
    if (state.role === "host") {
      showOnly(els.hostLobby);
    } else {
      els.studentLobbyText.textContent = `You are in room ${room.code}.`;
      showOnly(els.studentLobby);
    }
  }
  if (room.status === "question") {
    renderQuestion();
    startHostClock();
  }
  if (room.status === "results") {
    clearInterval(state.timer);
    renderResults();
  }

  els.hostCode.textContent = room.code;
  renderPlayers(playersFrom(room));
}

function renderQuestion() {
  const room = state.room;
  const question = currentQuestion();
  if (!question) return;
  const ownAnswer = room.players?.[state.selfId]?.answers?.[room.currentQuestion];
  showOnly(els.questionView);

  els.questionProgress.textContent = `Question ${room.currentQuestion + 1} / ${room.questions.length}`;
  els.timerBadge.textContent = remainingSeconds(room);
  els.questionText.textContent = question.text;

  const answerKey = `${room.code}:${room.currentQuestion}:${ownAnswer?.option || "open"}`;
  if (state.answerRenderKey !== answerKey) {
    state.answerRenderKey = answerKey;
    els.answers.innerHTML = "";

    question.options.forEach((option) => {
      const button = document.createElement("button");
      button.className = "answer-btn";
      button.type = "button";
      button.textContent = option;
      if (ownAnswer) {
        button.disabled = true;
        button.classList.toggle("selected", ownAnswer.option === option);
        button.classList.toggle("correct", option === question.answer);
        button.classList.toggle("wrong", ownAnswer.option === option && !ownAnswer.correct);
      }
      button.addEventListener("click", () => answerQuestion(option));
      els.answers.append(button);
    });
  }

  els.answerNote.textContent = ownAnswer
    ? ownAnswer.correct
      ? "Correct. Waiting for the next question."
      : `Not quite. Correct answer: ${question.answer}.`
    : state.role === "host"
      ? "Host view: responses sync from Realtime Database."
      : "Choose an answer before the timer ends.";
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
      row.querySelector("strong").textContent = `${index + 1}. ${player.name}`;
      row.querySelector(".score").textContent = `${player.score} pts`;
      els.leaderboard.append(row);
    });
}

async function readLessonInput() {
  const typed = els.lessonText.value.trim();
  const file = els.lessonFile.files[0];
  if (!file) return typed;

  if (file.type === "text/plain" || file.name.endsWith(".md")) {
    return `${typed}\n${await file.text()}`;
  }

  return `${typed}\nUploaded file: ${file.name}. Add extracted PDF text here when connected to a server-side parser or AI API.`;
}

els.hostTab.addEventListener("click", () => setMode("host"));
els.joinTab.addEventListener("click", () => setMode("join"));

els.hostForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!(await assertFirebaseReady())) return;
  const lesson = await readLessonInput();
  const host = {
    id: state.selfId,
    name: "Host",
    score: 0,
    answers: {},
  };

  try {
    const code = await createUniqueRoom({
      hostId: state.selfId,
      status: "lobby",
      questions: createQuestions(lesson, Number(els.questionCount.value)),
      timerSeconds: Number(els.timerSeconds.value),
      questionStartedAt: 0,
      currentQuestion: -1,
      players: {
        [host.id]: host,
      },
      createdAt: Date.now(),
    });
    els.cloudStatus.textContent = `Room ${code} is live in Firebase.`;
    els.cloudStatus.classList.remove("is-error");
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
  clearInterval(state.timer);
  if (state.role === "host" && state.roomRef) {
    await firebase.remove(state.roomRef);
  }
  if (state.unsubscribe) state.unsubscribe();
  state.room = null;
  state.roomRef = null;
  render();
});

setMode("host");
render();

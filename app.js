const ACCESS_CODE = "CCFPEM9000";

const BLOCK_SECONDS = 4 * 60 * 60; // 4-hour SAMP practice block, matching the real written exam
const ORAL_READING_SECONDS = 2 * 60; // 2-minute candidate reading time per station
const ORAL_STATION_SECONDS = 12 * 60; // 12-minute station time per station

let CASES = [];
let STATIONS = [];
let currentCase = null;
let currentStationIdx = 0;

function $(id) { return document.getElementById(id); }

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function formatTopic(k) {
  return (k || "").replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
}

function showScreen(id) {
  ["gate-screen", "mode-screen", "samp-list-screen", "samp-case-screen", "oral-screen"].forEach(s => {
    $(s).style.display = s === id ? "" : "none";
  });
}

// ---------- Access gate ----------
function checkAccessCode() {
  const val = $("access-code-input").value.trim().toUpperCase();
  if (val === ACCESS_CODE) {
    localStorage.setItem("ccfpem_access", "1");
    init();
  } else {
    $("gate-error").textContent = "Incorrect access code. Please check your book or listing for the code.";
  }
}

$("gate-submit").addEventListener("click", checkAccessCode);
$("access-code-input").addEventListener("keydown", e => {
  if (e.key === "Enter") checkAccessCode();
});

// ---------- Mode select ----------
async function init() {
  try {
    const [casesRes, stationsRes] = await Promise.all([
      fetch("cases.json"),
      fetch("oral_stations.json"),
    ]);
    CASES = await casesRes.json();
    STATIONS = await stationsRes.json();
    STATIONS.sort((a, b) => a.id - b.id);
    showScreen("mode-screen");
  } catch (e) {
    $("gate-error").textContent = "Could not load practice content. Please refresh and try again.";
    showScreen("gate-screen");
  }
}

$("mode-samp").addEventListener("click", () => {
  buildSampFilters();
  renderSampList();
  resetBlockTimer();
  showScreen("samp-list-screen");
});

$("mode-oral").addEventListener("click", () => {
  currentStationIdx = 0;
  openStation(currentStationIdx);
  showScreen("oral-screen");
});

$("samp-back-to-mode").addEventListener("click", () => {
  stopBlockTimer();
  showScreen("mode-screen");
});
$("oral-back-to-mode").addEventListener("click", () => {
  stopOralTimer();
  showScreen("mode-screen");
});

// ===================== SAMP PRACTICE BLOCK =====================

function getPracticedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem("ccfpem_practiced_cases") || "[]"));
  } catch (e) {
    return new Set();
  }
}

function markPracticed(id) {
  const set = getPracticedSet();
  set.add(id);
  localStorage.setItem("ccfpem_practiced_cases", JSON.stringify([...set]));
}

function buildSampFilters() {
  const chSel = $("filter-chapter");
  const topicSel = $("filter-topic");
  if (chSel.dataset.built) return;
  chSel.dataset.built = "1";
  const chapters = [...new Set(CASES.map(c => c.chapter))].sort((a, b) => a - b);
  chapters.forEach(ch => {
    const opt = document.createElement("option");
    opt.value = ch;
    opt.textContent = "Chapter " + ch;
    chSel.appendChild(opt);
  });
  const topics = [...new Set(CASES.map(c => c.topic).filter(Boolean))].sort();
  topics.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = formatTopic(t);
    topicSel.appendChild(opt);
  });
}

function renderSampList() {
  const chFilter = $("filter-chapter").value;
  const topicFilter = $("filter-topic").value;
  const practiced = getPracticedSet();

  const filtered = CASES.filter(c =>
    (!chFilter || String(c.chapter) === chFilter) &&
    (!topicFilter || c.topic === topicFilter)
  );

  $("samp-case-count").textContent = `${filtered.length} case${filtered.length === 1 ? "" : "s"}`;

  const container = $("samp-case-list");
  container.innerHTML = "";
  filtered.forEach(c => {
    const card = document.createElement("div");
    card.className = "case-card" + (practiced.has(c.id) ? " done" : "");
    card.innerHTML = `
      <div class="num">Case ${c.id}${practiced.has(c.id) ? ' <span class="done-check">&#10003; Practiced</span>' : ""}</div>
      <div class="title">${escapeHtml(c.title)}</div>
      <div class="tags">
        <span class="tag">Chapter ${c.chapter}</span>
        <span class="tag tag-alt">${escapeHtml(formatTopic(c.topic))}</span>
      </div>`;
    card.addEventListener("click", () => openSampCase(c));
    container.appendChild(card);
  });
}

$("filter-chapter").addEventListener("change", renderSampList);
$("filter-topic").addEventListener("change", renderSampList);
$("samp-back-to-list").addEventListener("click", () => {
  renderSampList();
  showScreen("samp-list-screen");
});

function openSampCase(c) {
  currentCase = c;
  $("samp-case-title-header").textContent = `Case ${c.id}: ${c.title}`;
  $("samp-case-chapter-badge").textContent = `Chapter ${c.chapter}`;
  $("samp-case-topic-badge").textContent = formatTopic(c.topic);
  $("samp-case-stem").textContent = c.stem;

  const list = $("samp-case-subquestions");
  list.innerHTML = "";
  (c.sub_questions || []).forEach(sq => {
    const li = document.createElement("li");
    li.textContent = sq.prompt;
    list.appendChild(li);
  });

  $("samp-mark-practiced-btn").textContent = "Mark as Practiced";
  $("samp-mark-practiced-btn").disabled = false;

  showScreen("samp-case-screen");
  window.scrollTo(0, 0);
}

$("samp-mark-practiced-btn").addEventListener("click", () => {
  if (!currentCase) return;
  markPracticed(currentCase.id);
  $("samp-mark-practiced-btn").textContent = "Practiced ✓";
  $("samp-mark-practiced-btn").disabled = true;
});

// ---------- Block timer (4 hours) ----------
let blockInterval = null;
let blockRemaining = BLOCK_SECONDS;
let blockRunning = false;

function formatHMS(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function resetBlockTimer() {
  stopBlockTimer();
  blockRemaining = BLOCK_SECONDS;
  $("block-timer-display").textContent = formatHMS(blockRemaining);
  $("block-timer-display").className = "";
  $("block-timer-label").textContent = "Not Started";
  $("block-timer-start").textContent = "Start Timer";
  $("block-timer-start").disabled = false;
  $("block-timer-pause").disabled = true;
  $("block-timer-pause").textContent = "Pause";
}

function stopBlockTimer() {
  if (blockInterval) {
    clearInterval(blockInterval);
    blockInterval = null;
  }
  blockRunning = false;
}

function blockTick() {
  blockRemaining--;
  if (blockRemaining <= 0) {
    blockRemaining = 0;
    stopBlockTimer();
    $("block-timer-display").textContent = "0:00:00";
    $("block-timer-display").className = "done";
    $("block-timer-label").textContent = "Time Complete";
    $("block-timer-start").disabled = true;
    $("block-timer-pause").disabled = true;
    return;
  }
  $("block-timer-display").textContent = formatHMS(blockRemaining);
  $("block-timer-label").textContent = "Practice Block Time Remaining";
  if (blockRemaining === BLOCK_SECONDS / 2) {
    $("block-timer-label").textContent = "Halfway point: optional 15-minute break";
  }
  if (blockRemaining <= 15 * 60) {
    $("block-timer-display").className = "warning";
  }
}

$("block-timer-start").addEventListener("click", () => {
  if (blockRunning) return;
  blockRunning = true;
  $("block-timer-start").disabled = true;
  $("block-timer-pause").disabled = false;
  $("block-timer-label").textContent = "Practice Block Time Remaining";
  blockInterval = setInterval(blockTick, 1000);
});

$("block-timer-pause").addEventListener("click", () => {
  if (!blockRunning) return;
  stopBlockTimer();
  $("block-timer-start").disabled = false;
  $("block-timer-start").textContent = "Resume Timer";
  $("block-timer-pause").disabled = true;
  $("block-timer-label").textContent = "Paused";
});

$("block-timer-reset").addEventListener("click", resetBlockTimer);

// ===================== ORAL STATION REHEARSAL =====================

let oralInterval = null;
let oralPhase = "reading"; // "reading" | "station"
let oralRemaining = ORAL_READING_SECONDS;
let oralRunning = false;

function openStation(idx) {
  if (idx < 0) idx = 0;
  if (idx >= STATIONS.length) idx = STATIONS.length - 1;
  currentStationIdx = idx;
  const s = STATIONS[idx];

  $("oral-station-header").textContent = `Station ${s.id}: ${s.title}`;
  $("oral-station-badge").textContent = `Station ${s.id} of ${STATIONS.length}`;
  $("oral-topic-badge").textContent = formatTopic(s.topic);
  $("oral-reading-stem").textContent = s.reading_stem;
  $("oral-examiner-scenario").textContent = s.examiner_scenario;
  $("oral-scenario-panel").hidden = true;
  $("oral-station-progress").textContent = `${idx + 1} / ${STATIONS.length}`;
  $("oral-prev-station").disabled = idx === 0;

  resetOralTimer();
  window.scrollTo(0, 0);
}

$("oral-prev-station").addEventListener("click", () => {
  stopOralTimer();
  openStation(currentStationIdx - 1);
});
$("oral-next-station").addEventListener("click", () => {
  stopOralTimer();
  const nextIdx = currentStationIdx + 1 >= STATIONS.length ? 0 : currentStationIdx + 1;
  openStation(nextIdx);
});

function resetOralTimer() {
  stopOralTimer();
  oralPhase = "reading";
  oralRemaining = ORAL_READING_SECONDS;
  $("oral-phase-title").textContent = "Reading Time";
  $("oral-timer-display").textContent = formatTime(oralRemaining);
  $("oral-timer-display").className = "reading";
  $("oral-timer-label").textContent = "Not Started";
  $("oral-timer-start").textContent = "Start Station";
  $("oral-timer-start").disabled = false;
  $("oral-timer-pause").disabled = true;
  $("oral-timer-pause").textContent = "Pause";
  $("oral-howto").textContent =
    "Read the stem below for up to 2 minutes, just like the real exam. When reading time ends the 12-minute station timer starts automatically and the examiner scenario becomes visible.";
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function stopOralTimer() {
  if (oralInterval) {
    clearInterval(oralInterval);
    oralInterval = null;
  }
  oralRunning = false;
}

function oralTick() {
  oralRemaining--;
  if (oralRemaining <= 0) {
    if (oralPhase === "reading") {
      // Move into the 12-minute station phase automatically.
      oralPhase = "station";
      oralRemaining = ORAL_STATION_SECONDS;
      $("oral-phase-title").textContent = "Station Time";
      $("oral-timer-display").className = "";
      $("oral-scenario-panel").hidden = false;
      $("oral-howto").textContent =
        "Verbalize your clinical reasoning out loud to a study partner or examiner-style prompt sheet, just like the real oral exam. The examiner scenario is now visible below.";
      $("oral-timer-display").textContent = formatTime(oralRemaining);
      $("oral-timer-label").textContent = "Station Time Remaining";
      return;
    }
    // Station phase finished.
    oralRemaining = 0;
    stopOralTimer();
    $("oral-timer-display").textContent = "0:00";
    $("oral-timer-display").className = "done";
    $("oral-timer-label").textContent = "Station Complete";
    $("oral-timer-start").disabled = true;
    $("oral-timer-pause").disabled = true;
    return;
  }
  $("oral-timer-display").textContent = formatTime(oralRemaining);
  if (oralPhase === "reading") {
    $("oral-timer-label").textContent = "Reading Time Remaining";
  } else {
    $("oral-timer-label").textContent = "Station Time Remaining";
    if (oralRemaining <= 2 * 60) {
      $("oral-timer-display").className = "warning";
    }
  }
}

$("oral-timer-start").addEventListener("click", () => {
  if (oralRunning) return;
  oralRunning = true;
  $("oral-timer-start").disabled = true;
  $("oral-timer-pause").disabled = false;
  if (oralPhase === "reading") {
    $("oral-timer-label").textContent = "Reading Time Remaining";
  } else {
    $("oral-timer-label").textContent = "Station Time Remaining";
  }
  oralInterval = setInterval(oralTick, 1000);
});

$("oral-timer-pause").addEventListener("click", () => {
  if (!oralRunning) return;
  stopOralTimer();
  $("oral-timer-start").disabled = false;
  $("oral-timer-start").textContent = "Resume";
  $("oral-timer-pause").disabled = true;
  $("oral-timer-label").textContent = "Paused";
});

$("oral-timer-reset").addEventListener("click", resetOralTimer);

// ---------- Init ----------
if (localStorage.getItem("ccfpem_access") === "1") {
  init();
}

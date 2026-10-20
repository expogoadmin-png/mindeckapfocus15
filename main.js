import { defaults, isDifficulty, loadData, makeId, parseImport, saveData } from './store.js';
const root = document.querySelector('#app');
let { data, notice } = loadData();
let section = 'focus';
let taskName = '';
let durationDraft = data.settings.focusMinutes;
let timerMode = 'idle';
let remainingMs = durationDraft * 60000;
let endAt = 0;
let timerHandle = 0;
let gameHandle = 0;
let memoryTimers = [];
let completionGuard = false;
let toastHandle = 0;
let memory = { phase: 'idle', sequence: [], index: 0, rounds: 0, score: 0, difficulty: data.settings.games.memory.difficulty };
let attention = { running: false, score: 0, endsAt: 0, target: '', targetIndex: 0, count: 12, board: [], difficulty: data.settings.games.attention.difficulty, feedback: '' };
let adminOpen = false;
let audio = null;
let gesture = 0, gestureTimer = 0, gesturePhase = 'idle';
const USAGE_KEY = 'mindscape.usage.v1';
const VISIT_KEY = 'mindscape.visit.v1';
const IDLE_AFTER_MS = 60_000;
let usage;
let visit;
let usageTimer = 0;
let usageLastTick = Date.now();
const esc = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (sec) => `${Math.floor(sec / 60).toString().padStart(2, '0')}:${Math.floor(sec % 60).toString().padStart(2, '0')}`;
const todayText = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
const gameResults = (game) => data.results.filter(r => r.game === game).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
const latestBest = (game) => {
    const rows = gameResults(game);
    return { latest: rows[0]?.score ?? null, best: rows.reduce((a, r) => a === null ? r.score : Math.max(a, r.score), null), count: rows.length };
};
const save = () => {
    if (!saveData(data))
        toast('Could not save to this browser. Storage may be unavailable or full.');
};
function toast(message) {
    const el = document.querySelector('.toast');
    if (!el)
        return;
    el.textContent = message;
    el.classList.add('show');
    window.clearTimeout(toastHandle);
    toastHandle = window.setTimeout(() => el.classList.remove('show'), 3600);
}
function saveResult(game, score, difficulty) {
    const result = { id: makeId(), game, score, difficulty, completedAt: new Date().toISOString() };
    data.results.unshift(result);
    if (data.results.length > 10000)
        data.results.length = 10000;
    save();
}
function setTheme() { document.documentElement.dataset.theme = data.settings.theme; }
function loadUsageStats() {
    try {
        const raw = localStorage.getItem(USAGE_KEY);
        if (raw) {
            const value = JSON.parse(raw);
            if (value && typeof value === 'object') {
                const v = value;
                if (typeof v.visitorId === 'string' && typeof v.firstSeenAt === 'string' &&
                    typeof v.lastSeenAt === 'string' && Number.isFinite(v.visits) &&
                    Number.isFinite(v.totalVisibleMs) && Number.isFinite(v.totalActiveMs) &&
                    Number(v.visits) >= 0 && Number(v.totalVisibleMs) >= 0 && Number(v.totalActiveMs) >= 0) {
                    return { visitorId: v.visitorId, firstSeenAt: v.firstSeenAt, lastSeenAt: v.lastSeenAt,
                        visits: Number(v.visits), totalVisibleMs: Number(v.totalVisibleMs), totalActiveMs: Number(v.totalActiveMs) };
                }
            }
        }
    }
    catch { /* start fresh if this browser blocks or corrupts local storage */ }
    const now = new Date().toISOString();
    return { visitorId: makeId(), firstSeenAt: now, lastSeenAt: now, visits: 0, totalVisibleMs: 0, totalActiveMs: 0 };
}
function persistUsage() {
    try {
        localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
    }
    catch { /* usage tracking is optional */ }
    try {
        sessionStorage.setItem(VISIT_KEY, JSON.stringify(visit));
    }
    catch { /* session continuity is optional */ }
}
function initializeUsageTracking() {
    usage = loadUsageStats();
    const now = Date.now();
    let savedVisit = null;
    try {
        const raw = sessionStorage.getItem(VISIT_KEY);
        if (raw) {
            const value = JSON.parse(raw);
            if (value && typeof value === 'object') {
                const v = value;
                if (typeof v.startedAt === 'string' && Number.isFinite(Date.parse(v.startedAt)) &&
                    Number.isFinite(v.visibleMs) && Number(v.visibleMs) >= 0 &&
                    Number.isFinite(v.activeMs) && Number(v.activeMs) >= 0) {
                    savedVisit = { startedAt: v.startedAt, visibleMs: Number(v.visibleMs), activeMs: Number(v.activeMs), lastInteractionAt: now };
                }
            }
        }
    }
    catch { /* new visit if session storage is unavailable */ }
    visit = savedVisit ?? { startedAt: new Date(now).toISOString(), visibleMs: 0, activeMs: 0, lastInteractionAt: now };
    if (!savedVisit)
        usage.visits += 1;
    usage.lastSeenAt = new Date(now).toISOString();
    usageLastTick = now;
    persistUsage();
    const markInteraction = () => {
        if (document.visibilityState !== 'visible')
            return;
        visit.lastInteractionAt = Date.now();
        usage.lastSeenAt = new Date(visit.lastInteractionAt).toISOString();
    };
    for (const eventName of ['pointerdown', 'keydown', 'touchstart', 'scroll']) {
        document.addEventListener(eventName, markInteraction, { passive: true });
    }
    document.addEventListener('pointermove', () => {
        if (Date.now() - visit.lastInteractionAt > 10_000)
            markInteraction();
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        const nowVisible = Date.now();
        usageLastTick = nowVisible;
        if (document.visibilityState === 'visible')
            markInteraction();
        persistUsage();
    });
    usageTimer = window.setInterval(updateUsageTracking, 5000);
    window.addEventListener('pagehide', () => {
        updateUsageTracking();
        window.clearInterval(usageTimer);
        usageTimer = 0;
        persistUsage();
    });
}
function updateUsageTracking() {
    const now = Date.now();
    const delta = Math.max(0, Math.min(10_000, now - usageLastTick));
    usageLastTick = now;
    if (document.visibilityState === 'visible' && delta > 0) {
        visit.visibleMs += delta;
        usage.totalVisibleMs += delta;
        if (now - visit.lastInteractionAt <= IDLE_AFTER_MS) {
            visit.activeMs += delta;
            usage.totalActiveMs += delta;
        }
    }
    persistUsage();
    refreshUsageLiveValues();
}
function fmtDuration(ms) {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60), remainder = seconds % 60;
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    if (minutes > 0)
        return `${minutes}m ${remainder}s`;
    return `${remainder}s`;
}
function fmtDate(value) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed) : '—';
}
function currentVisibleMs() {
    const liveDelta = document.visibilityState === 'visible' ? Math.max(0, Math.min(10_000, Date.now() - usageLastTick)) : 0;
    return visit.visibleMs + liveDelta;
}
function currentActiveMs() {
    const liveDelta = document.visibilityState === 'visible' && Date.now() - visit.lastInteractionAt <= IDLE_AFTER_MS
        ? Math.max(0, Math.min(10_000, Date.now() - usageLastTick)) : 0;
    return visit.activeMs + liveDelta;
}
function refreshUsageLiveValues() {
    const values = {
        'usage-current-visible': fmtDuration(currentVisibleMs()),
        'usage-current-active': fmtDuration(currentActiveMs()),
        'usage-total-visible': fmtDuration(usage.totalVisibleMs),
        'usage-total-active': fmtDuration(usage.totalActiveMs),
        'usage-last-seen': fmtDate(usage.lastSeenAt),
    };
    for (const [id, value] of Object.entries(values)) {
        const el = document.getElementById(id);
        if (el)
            el.textContent = value;
    }
}
function resetUsageTracking() {
    try {
        localStorage.removeItem(USAGE_KEY);
    }
    catch { /* ignore unavailable storage */ }
    try {
        sessionStorage.removeItem(VISIT_KEY);
    }
    catch { /* ignore unavailable storage */ }
    usage = loadUsageStats();
    visit = { startedAt: new Date().toISOString(), visibleMs: 0, activeMs: 0, lastInteractionAt: Date.now() };
    usage.visits = 1;
    usage.lastSeenAt = new Date().toISOString();
    usageLastTick = Date.now();
    persistUsage();
}
function shell(content, active = section) {
    setTheme();
    root.innerHTML = `<div class="app-shell">
    <header class="topbar">
      <button class="brand" id="brand-title" aria-label="MINDSCAPE home"><span class="brand-name">MINDSCAPE</span><span class="brand-sub">a practice in attention</span></button>
      <div class="top-meta"><span class="local-indicator">Stored on this device</span></div>
    </header>
    <main class="main-wrap">
      <div class="intro"><div><div class="eyebrow">A QUIETER KIND OF FOCUS</div><h1>Make room for<br>one thing.</h1><p>A private space to practice attention. Settle into focused work, or take a moment to train your mind with a small challenge.</p></div><div class="date-note">${todayText}</div></div>
      ${notice ? `<div class="notice" role="status">${esc(notice)}</div>` : ''}
      <nav class="tabs" role="tablist" aria-label="MINDSCAPE sections">
        <button class="tab" role="tab" aria-selected="${active === 'focus'}" data-section="focus">Focus</button>
        <button class="tab" role="tab" aria-selected="${active === 'games'}" data-section="games">Brain Games</button>
        <button class="tab" role="tab" aria-selected="${active === 'progress'}" data-section="progress">Progress</button>
      </nav>
      <div class="view" id="view">${content}</div>
      <p class="footer-note">Your practice stays here, on this device.</p>
    </main>
    <div class="toast" role="status" aria-live="polite"></div>
    ${adminOpen ? adminMarkup() : ''}
  </div>`;
    if (adminOpen) {
        root.querySelector('header')?.setAttribute('inert', '');
        root.querySelector('main')?.setAttribute('inert', '');
    }
    bind();
}
function focusMarkup() {
    const total = Math.max(1, durationDraft * 60);
    const seconds = timerMode === 'idle' ? total : Math.ceil(remainingMs / 1000);
    const progress = Math.max(0, Math.min(100, (1 - seconds / total) * 100));
    const running = timerMode === 'running';
    const taskDisabled = running || timerMode === 'paused';
    return `<div class="focus-layout">
    <section class="panel timer-panel" aria-label="Focus timer">
      <div class="timer-title"><div class="eyebrow">YOUR FOCUS SESSION</div>
      <input class="task-input" id="task-name" aria-label="Task name" maxlength="160" placeholder="What will you focus on?" value="${esc(taskName)}" ${taskDisabled ? 'disabled' : ''}></div>
      <div class="timer-ring" id="timer-ring" style="--progress:${progress}%"><div class="timer-inner">
        <div class="timer-value" id="timer-value" role="timer" aria-live="off">${fmt(seconds)}</div>
        <div class="timer-caption" id="timer-caption">${timerMode === 'done' ? 'SESSION COMPLETE' : running ? 'STAY WITH IT' : timerMode === 'paused' ? 'PAUSED' : 'READY WHEN YOU ARE'}</div>
      </div></div>
      <div class="timer-controls">
        ${running ? `<button class="button primary" data-action="pause">Pause</button>` : timerMode === 'paused' ? `<button class="button primary" data-action="resume">Resume</button>` : `<button class="button primary" data-action="start">${timerMode === 'done' ? 'Start again' : 'Begin focus'}</button>`}
        ${(running || timerMode === 'paused' || timerMode === 'done') ? `<button class="button" data-action="reset">Reset</button>` : ''}
      </div>
        <span class="sr-only" id="focus-announcement" aria-live="polite">${timerMode === 'done' ? 'Focus session complete.' : ''}</span>
    </section>
    <aside class="side-stack">
      <section class="panel settings-panel">
        <div class="section-heading"><div><div class="eyebrow">SESSION SETUP</div><h2>Set your pace</h2></div></div>
        <label class="form-label" for="focus-duration">Focus duration <span class="duration-row"><input class="field" id="focus-duration" type="number" min="1" max="180" step="1" value="${durationDraft}" ${taskDisabled ? 'disabled' : ''}><span class="unit">MINUTES</span></span></label>
        <div class="toggle-row"><span>Completion sound</span><input class="toggle" type="checkbox" id="sound-toggle" aria-label="Completion sound" ${data.settings.sound ? 'checked' : ''}></div>
        <p class="quiet-note">Only a finished timer is counted. Pausing keeps your progress; resetting or leaving early does not.</p>
      </section>
      <section class="panel session-strip"><span>Completed focus sessions</span><strong>${data.sessions.length}</strong></section>
    </aside>
  </div>`;
}
function gameMarkup(game) {
    const conf = data.settings.games[game];
    if (!conf.enabled)
        return `<section class="panel game-card"><div class="game-top"><div class="eyebrow">PRACTICE ${game === 'memory' ? '01' : '02'}</div><h3>${game === 'memory' ? 'Memory Sequence' : 'Attention Challenge'}</h3><p>This exercise is currently turned off in settings.</p></div><div class="game-body"><div class="game-disabled">When enabled, your results will be kept on this device.</div></div></section>`;
    return game === 'memory' ? memoryMarkup() : attentionMarkup();
}
function memoryMarkup() {
    const stateLabel = memory.phase === 'showing' ? 'Watch the sequence' : memory.phase === 'input' ? 'Repeat the sequence' : memory.rounds ? `Run ended · ${memory.score} ${memory.score === 1 ? 'round' : 'rounds'} completed` : 'Ready for a short memory practice?';
    return `<section class="panel game-card">
    <div class="game-top"><div class="eyebrow">PRACTICE 01 · SEQUENCE</div><h3>Memory Sequence</h3><p>Watch the tiles light up, then repeat the order. Each clear round adds one more step.</p>
      <div class="game-meta"><span>YOUR BEST<b>${latestBest('memory').best ?? '—'} rounds</b></span><span>YOUR LATEST<b>${latestBest('memory').latest ?? '—'} rounds</b></span></div>
    </div>
    <div class="game-body">
      <div class="memory-grid" aria-label="Three by three memory tile board">${Array.from({ length: 9 }, (_, i) => `<button class="memory-tile ${memory.phase === 'input' ? '' : ''}" aria-label="Memory tile ${i + 1}" data-memory="${i}" ${memory.phase !== 'input' ? 'disabled' : ''}></button>`).join('')}</div>
      <p class="game-status" id="memory-status" aria-live="polite">${stateLabel}</p>
      <div class="game-actions"><label class="sr-only" for="memory-difficulty">Memory difficulty</label><select class="field difficulty" id="memory-difficulty" ${memory.phase !== 'idle' ? 'disabled' : ''}>${difficultyOptions(memory.difficulty)}</select>
      <button class="button primary" data-action="memory-start" ${memory.phase !== 'idle' ? 'disabled' : ''}>${memory.rounds ? 'Try again' : 'Start practice'}</button></div>
    </div>
  </section>`;
}
function difficultyOptions(selected) {
    return ['easy', 'normal', 'hard'].map(d => `<option value="${d}" ${selected === d ? 'selected' : ''}>${d[0].toUpperCase() + d.slice(1)}</option>`).join('');
}
const symbols = ['●', '○', '◉', '◎', '◌', '◍', '◐', '◑'];
function makeBoard() {
    const count = attention.count;
    attention.targetIndex = Math.floor(Math.random() * count);
    const targetOptions = symbols.filter(s => s !== attention.target);
    attention.target = targetOptions[Math.floor(Math.random() * targetOptions.length)];
    const distractors = symbols.filter(s => s !== attention.target);
    const board = Array.from({ length: count }, () => distractors[Math.floor(Math.random() * distractors.length)]);
    board[attention.targetIndex] = attention.target;
    attention.board = board;
    return attention.board;
}
function attentionMarkup() {
    const rows = attention.running ? (attention.board.length ? attention.board : makeBoard()) : [];
    const left = attention.running ? Math.max(0, Math.ceil((attention.endsAt - Date.now()) / 1000)) : 30;
    return `<section class="panel game-card">
    <div class="game-top"><div class="eyebrow">PRACTICE 02 · VISUAL SEARCH</div><h3>Attention Challenge</h3><p>Find the one symbol that differs. Work steadily through a ${left === 30 && !attention.running ? '30' : '30'}-second round.</p>
      <div class="game-meta"><span>YOUR BEST<b>${latestBest('attention').best ?? '—'} points</b></span><span>YOUR LATEST<b>${latestBest('attention').latest ?? '—'} points</b></span></div>
    </div>
    <div class="game-body">
      <div class="attention-board" aria-label="Symbol search board">${rows.map((s, i) => `<button class="symbol-cell" aria-label="Symbol ${i + 1}" data-attention="${i}">${s}</button>`).join('')}</div>
      <p class="game-status" id="attention-status" aria-live="polite">${attention.running ? `Find the different symbol · ${left}s remaining · ${attention.score} found` : attention.feedback || `30 seconds · ${attention.count} symbols per board`}</p>
      <div class="game-actions"><label class="sr-only" for="attention-difficulty">Attention difficulty</label><select class="field difficulty" id="attention-difficulty" ${attention.running ? 'disabled' : ''}>${difficultyOptions(attention.difficulty)}</select>
      <button class="button primary" data-action="attention-start" ${attention.running ? 'disabled' : ''}>${attention.feedback ? 'Play again' : 'Start practice'}</button></div>
    </div>
  </section>`;
}
function gamesMarkup() {
    return `<div class="games-header"><div><div class="eyebrow">A MOMENT TO RESET</div><h2>Train your attention.</h2><p>Two small exercises. Your scores stay private on this device.</p></div></div><div class="game-grid">${gameMarkup('memory')}${gameMarkup('attention')}</div>`;
}
function progressMarkup() {
    const minutes = data.sessions.reduce((sum, s) => sum + s.minutes, 0);
    const sessions = [...data.sessions].sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 8);
    const memoryScores = latestBest('memory'), attentionScores = latestBest('attention');
    return `<div><div class="eyebrow">YOUR PRACTICE, OVER TIME</div><h2 class="progress-title">A record of showing up.</h2></div>
    <div class="stats-grid">
      <section class="panel stat-panel"><div class="stat-label">COMPLETED SESSIONS</div><div class="stat-value">${data.sessions.length}</div></section>
      <section class="panel stat-panel"><div class="stat-label">FOCUSED MINUTES</div><div class="stat-value">${minutes}</div></section>
      <section class="panel stat-panel"><div class="stat-label">GAME PRACTICES</div><div class="stat-value">${data.results.length}</div></section>
    </div>
    <div class="progress-columns">
      <section class="panel history-panel"><div class="section-heading"><div><div class="eyebrow">FOCUS HISTORY</div><h3>Recent sessions</h3></div></div>
        ${sessions.length ? `<ul class="session-list">${sessions.map(s => `<li class="session-item"><div><div class="session-name">${esc(s.task || 'Untitled focus')}</div><div class="session-date">${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(s.completedAt))}</div></div><span class="session-duration">${s.minutes} min</span></li>`).join('')}</ul>` : '<div class="empty-state">No completed focus sessions yet.<br>A session appears here only when its timer reaches zero.</div>'}
      </section>
      <section class="panel scores-panel"><div class="section-heading"><div><div class="eyebrow">COGNITIVE PRACTICE</div><h3>Game results</h3></div></div>
        ${[['Memory Sequence', memoryScores], ['Attention Challenge', attentionScores]].map(([name, score]) => {
        const item = score;
        return `<div class="score-row"><span>${name}<small style="display:block;color:var(--quiet);font-size:10px;margin-top:5px">${item.count} ${item.count === 1 ? 'result' : 'results'}</small></span><div class="score-pair"><span><small>LATEST</small><strong>${item.latest ?? '—'}</strong></span><span><small>BEST</small><strong>${item.best ?? '—'}</strong></span></div></div>`;
    }).join('')}
        ${data.results.length === 0 ? '<div class="empty-state">Your game results will appear after you finish a practice.</div>' : ''}
      </section>
    </div>`;
}
function adminMarkup() {
    const completedMinutes = data.sessions.reduce((n, s) => n + s.minutes, 0);
    const memoryCount = data.results.filter(r => r.game === 'memory').length;
    const attentionCount = data.results.filter(r => r.game === 'attention').length;
    const averageVisitMs = usage.visits > 0 ? usage.totalVisibleMs / usage.visits : 0;
    return `<div class="admin-backdrop" id="admin-backdrop"><section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title">
    <div class="admin-head"><div><div class="eyebrow">LOCAL CONTROLS</div><h2 id="admin-title">Practice settings</h2></div><button class="button small" data-action="admin-close" aria-label="Close settings">Close</button></div>
    <div class="admin-overview"><span>Focus sessions<b>${data.sessions.length}</b></span><span>Minutes<b>${completedMinutes}</b></span><span>Game results<b>${data.results.length}</b></span></div>
    <section class="admin-section admin-usage"><div class="admin-usage-heading"><div><h3>Usage analytics · this browser</h3><p class="quiet-note">Anonymous, local-only measurements. This static app cannot see visitors using other browsers or devices.</p></div><span class="local-pill">1 browser profile</span></div>
      <div class="usage-grid">
        <div class="usage-metric"><span>Visits on this browser</span><strong>${usage.visits}</strong></div>
        <div class="usage-metric"><span>Current visit · visible time</span><strong id="usage-current-visible">${fmtDuration(currentVisibleMs())}</strong></div>
        <div class="usage-metric"><span>Current visit · active time</span><strong id="usage-current-active">${fmtDuration(currentActiveMs())}</strong></div>
        <div class="usage-metric"><span>Total visible time</span><strong id="usage-total-visible">${fmtDuration(usage.totalVisibleMs)}</strong></div>
        <div class="usage-metric"><span>Total active time</span><strong id="usage-total-active">${fmtDuration(usage.totalActiveMs)}</strong></div>
        <div class="usage-metric"><span>Average visit length</span><strong>${fmtDuration(averageVisitMs)}</strong></div>
        <div class="usage-metric"><span>First visit</span><strong class="usage-date">${esc(fmtDate(usage.firstSeenAt))}</strong></div>
        <div class="usage-metric"><span>Last activity</span><strong class="usage-date">${esc(fmtDate(usage.lastSeenAt))}</strong></div>
      </div>
      <div class="usage-breakdown"><span>Memory Sequence results <b>${memoryCount}</b></span><span>Attention Challenge results <b>${attentionCount}</b></span><span>Completed focus sessions <b>${data.sessions.length}</b></span></div>
      <p class="quiet-note usage-footnote">“Active time” counts visible use when there has been interaction in the last 60 seconds. Other visitors cannot be counted globally unless a shared backend/database is added.</p>
    </section>
    <div class="admin-grid">
      <section class="admin-section"><h3>Focus preferences</h3>
        <label class="form-label">Focus length, minutes<input class="field" id="admin-focus" type="number" min="1" max="180" value="${data.settings.focusMinutes}"></label>
        <label class="form-label">Preferred break, minutes<input class="field" id="admin-break" type="number" min="1" max="60" value="${data.settings.breakMinutes}"></label>
        <div class="toggle-row"><span>Completion sound</span><input class="toggle" type="checkbox" id="admin-sound" ${data.settings.sound ? 'checked' : ''}></div>
        <label class="form-label">Appearance<select class="field" id="admin-theme"><option value="dark" ${data.settings.theme === 'dark' ? 'selected' : ''}>Dark</option><option value="light" ${data.settings.theme === 'light' ? 'selected' : ''}>Light</option></select></label>
      </section>
      <section class="admin-section"><h3>Game availability</h3>
        ${['memory', 'attention'].map(g => `<div class="toggle-row"><span>${g === 'memory' ? 'Memory Sequence' : 'Attention Challenge'}</span><input class="toggle" type="checkbox" data-game-enabled="${g}" aria-label="Enable ${g}" ${data.settings.games[g].enabled ? 'checked' : ''}></div>
          <label class="form-label">${g === 'memory' ? 'Memory' : 'Attention'} difficulty<select class="field" data-game-difficulty="${g}">${difficultyOptions(data.settings.games[g].difficulty)}</select></label>`).join('')}
      </section>
      <section class="admin-section"><h3>Backup and restore</h3><div class="admin-actions">
        <button class="button small" data-action="export">Export all data</button><button class="button small" data-action="import-open">Import backup</button>
        <input class="file-input" id="import-file" type="file" accept="application/json,.json">
      </div><p class="quiet-note">Versioned JSON backup includes your settings, completed focus sessions, and game results.</p></section>
      <section class="admin-section"><h3>Data controls</h3><div class="admin-actions">
        <button class="button small danger" data-action="clear-history">Clear focus history</button>
        <button class="button small danger" data-action="clear-games">Reset game results</button>
        <button class="button small" data-action="restore-defaults">Restore defaults</button>
        <button class="button small danger" data-action="erase-all">Erase all app data</button>
      </div><p class="quiet-note">Each action asks for its own confirmation before changing local records.</p></section>
    </div>
  </section></div>`;
}
function render() {
    if (timerMode === 'running' && endAt)
        remainingMs = Math.max(0, endAt - Date.now());
    const content = section === 'focus' ? focusMarkup() : section === 'games' ? gamesMarkup() : progressMarkup();
    shell(content);
    if (timerMode === 'running')
        startTimerTicker();
    if (attention.running)
        startAttentionTicker();
}
function startTimerTicker() {
    window.clearInterval(timerHandle);
    timerHandle = window.setInterval(() => {
        if (timerMode !== 'running')
            return;
        remainingMs = Math.max(0, endAt - Date.now());
        if (remainingMs <= 0) {
            completeTimer();
            return;
        }
        const value = document.querySelector('#timer-value');
        const ring = document.querySelector('#timer-ring');
        const elapsed = durationDraft * 60 - Math.ceil(remainingMs / 1000);
        if (value)
            value.textContent = fmt(Math.ceil(remainingMs / 1000));
        if (ring)
            ring.style.setProperty('--progress', `${Math.max(0, elapsed / (durationDraft * 60) * 100)}%`);
    }, 250);
}
function startAttentionTicker() {
    window.clearInterval(gameHandle);
    gameHandle = window.setInterval(() => {
        if (!attention.running)
            return;
        const left = Math.max(0, Math.ceil((attention.endsAt - Date.now()) / 1000));
        const status = document.querySelector('#attention-status');
        if (status)
            status.textContent = `Find the different symbol · ${left}s remaining · ${attention.score} found`;
        if (left <= 0)
            finishAttention();
    }, 250);
}
function completionSound() {
    if (!data.settings.sound)
        return;
    try {
        if (!audio || audio.state === 'closed')
            audio = new AudioContext();
        if (audio.state === 'suspended')
            void audio.resume();
        const osc = audio.createOscillator(), gain = audio.createGain();
        osc.frequency.value = 660;
        osc.type = 'sine';
        gain.gain.setValueAtTime(.0001, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(.08, audio.currentTime + .025);
        gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .45);
        osc.connect(gain);
        gain.connect(audio.destination);
        osc.start();
        osc.stop(audio.currentTime + .46);
    }
    catch { /* audio is optional and may be unavailable */ }
}
function completeTimer() {
    if (completionGuard || timerMode !== 'running')
        return;
    completionGuard = true;
    window.clearInterval(timerHandle);
    timerMode = 'done';
    remainingMs = 0;
    data.sessions.unshift({ id: makeId(), task: taskName.trim(), minutes: durationDraft, completedAt: new Date().toISOString() });
    if (data.sessions.length > 10000)
        data.sessions.length = 10000;
    save();
    completionSound();
    render();
    toast('Focus session complete. It has been added to your history.');
}
function resetTimer() {
    window.clearInterval(timerHandle);
    timerMode = 'idle';
    completionGuard = false;
    durationDraft = data.settings.focusMinutes;
    remainingMs = durationDraft * 60000;
    endAt = 0;
    render();
}
function beginMemory() {
    clearMemoryTimers();
    const difficulty = memory.difficulty;
    memory = { phase: 'showing', sequence: [], index: 0, rounds: 0, score: 0, difficulty };
    memory.sequence = Array.from({ length: 3 }, () => Math.floor(Math.random() * 9));
    render();
    playMemorySequence();
}
function playMemorySequence() {
    clearMemoryTimers();
    memory.phase = 'showing';
    const status = document.querySelector('#memory-status');
    if (status)
        status.textContent = 'Watch the sequence';
    document.querySelectorAll('.memory-tile').forEach(b => b.disabled = true);
    const pace = memory.difficulty === 'easy' ? 850 : memory.difficulty === 'hard' ? 430 : 650;
    memory.sequence.forEach((tile, i) => {
        memoryDelay(() => {
            if (memory.phase !== 'showing')
                return;
            const cell = document.querySelector(`[data-memory="${tile}"]`);
            if (cell)
                cell.classList.add('lit');
            memoryDelay(() => cell?.classList.remove('lit'), pace * .55);
            if (i === memory.sequence.length - 1)
                memoryDelay(() => {
                    if (memory.phase !== 'showing')
                        return;
                    memory.phase = 'input';
                    memory.index = 0;
                    document.querySelectorAll('.memory-tile').forEach(b => b.disabled = false);
                    const st = document.querySelector('#memory-status');
                    if (st)
                        st.textContent = 'Your turn — repeat the pattern';
                }, pace);
        }, i * pace);
    });
}
function endMemory() {
    if (memory.phase === 'idle')
        return;
    clearMemoryTimers();
    memory.phase = 'idle';
    saveResult('memory', memory.score, memory.difficulty);
    render();
}
function nextMemoryRound() {
    memory.score++;
    memory.rounds++;
    if (memory.score >= 500) {
        endMemory();
        return;
    }
    memory.sequence.push(Math.floor(Math.random() * 9));
    memory.phase = 'showing';
    document.querySelectorAll('.memory-tile').forEach(b => b.disabled = true);
    memoryDelay(playMemorySequence, 500);
}
function memoryDelay(callback, delay) {
    const handle = window.setTimeout(callback, delay);
    memoryTimers.push(handle);
}
function clearMemoryTimers() {
    memoryTimers.forEach(handle => window.clearTimeout(handle));
    memoryTimers = [];
}
function startAttention() {
    const diff = attention.difficulty;
    attention = { running: true, score: 0, endsAt: Date.now() + 30000, target: '', targetIndex: 0, count: diff === 'easy' ? 12 : diff === 'hard' ? 30 : 20, board: [], difficulty: diff, feedback: '' };
    render();
}
function finishAttention() {
    if (!attention.running)
        return;
    attention.running = false;
    window.clearInterval(gameHandle);
    attention.feedback = `Round complete · ${attention.score} ${attention.score === 1 ? 'point' : 'points'} · 30 seconds`;
    saveResult('attention', attention.score, attention.difficulty);
    render();
}
function setDuration(value) {
    if (!Number.isInteger(value) || value < 1 || value > 180) {
        const field = document.querySelector('#focus-duration');
        if (field)
            field.value = String(durationDraft);
        toast('Choose a focus length from 1 to 180 minutes.');
        return;
    }
    durationDraft = value;
    data.settings.focusMinutes = value;
    if (timerMode === 'idle' || timerMode === 'done')
        remainingMs = value * 60000;
    save();
    render();
}
function downloadBackup() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url;
    link.download = `mindscape-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup exported.');
}
function ask(message) { return window.confirm(message); }
function bind() {
    root.querySelectorAll('[data-section]').forEach(b => b.addEventListener('click', () => {
        section = b.dataset.section;
        render();
    }));
    document.querySelector('#brand-title')?.addEventListener('click', titleGesture);
    root.querySelector('#task-name')?.addEventListener('input', e => { taskName = e.currentTarget.value; });
    root.querySelector('#focus-duration')?.addEventListener('change', e => setDuration(Number(e.currentTarget.value)));
    root.querySelector('#sound-toggle')?.addEventListener('change', e => { data.settings.sound = e.currentTarget.checked; save(); });
    root.querySelector('#memory-difficulty')?.addEventListener('change', e => {
        memory.difficulty = e.currentTarget.value;
        data.settings.games.memory.difficulty = memory.difficulty;
        save();
    });
    root.querySelector('#attention-difficulty')?.addEventListener('change', e => {
        attention.difficulty = e.currentTarget.value;
        data.settings.games.attention.difficulty = attention.difficulty;
        save();
    });
    root.querySelectorAll('[data-memory]').forEach(b => b.addEventListener('click', () => {
        const picked = Number(b.dataset.memory);
        if (memory.phase !== 'input')
            return;
        if (picked !== memory.sequence[memory.index]) {
            clearMemoryTimers();
            memory.phase = 'idle';
            saveResult('memory', memory.score, memory.difficulty);
            render();
            toast(`Pattern ended. ${memory.score} rounds completed.`);
            return;
        }
        b.classList.add('lit');
        window.setTimeout(() => b.classList.remove('lit'), 150);
        memory.index++;
        if (memory.index === memory.sequence.length)
            nextMemoryRound();
    }));
    const attentionBoard = root.querySelector('.attention-board');
    if (attentionBoard && attention.running)
        bindAttentionBoard(attentionBoard);
    root.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', () => action(el.dataset.action)));
    bindAdmin();
}
function bindAttentionBoard(board) {
    board.querySelectorAll('[data-attention]').forEach(btn => btn.addEventListener('click', () => {
        if (!attention.running)
            return;
        if (Number(btn.dataset.attention) === attention.targetIndex) {
            attention.score++;
            const parent = btn.closest('.attention-board');
            if (parent) {
                parent.innerHTML = makeBoard().map((s, i) => `<button class="symbol-cell" aria-label="Symbol ${i + 1}" data-attention="${i}">${s}</button>`).join('');
                bindAttentionBoard(parent);
            }
        }
        else
            attention.score = Math.max(0, attention.score - 1);
        const st = document.querySelector('#attention-status');
        if (st)
            st.textContent = `Find the different symbol · ${Math.max(0, Math.ceil((attention.endsAt - Date.now()) / 1000))}s remaining · ${attention.score} found`;
    }));
}
function titleGesture(event) {
    if (event.detail === 0) {
        resetGesture();
        return;
    }
    if (gesturePhase === 'wait') {
        resetGesture();
        return;
    }
    if (gesturePhase === 'ready') {
        gesturePhase = 'one';
        window.clearTimeout(gestureTimer);
        gestureTimer = window.setTimeout(resetGesture, 8000);
        return;
    }
    if (gesturePhase === 'one') {
        window.clearTimeout(gestureTimer);
        gesturePhase = 'idle';
        gesture = 0;
        adminOpen = true;
        render();
        document.querySelector('[data-action="admin-close"]')?.focus();
        return;
    }
    gesture++;
    window.clearTimeout(gestureTimer);
    if (gesture >= 7) {
        gesture = 0;
        gesturePhase = 'wait';
        gestureTimer = window.setTimeout(() => { gesturePhase = 'ready'; gestureTimer = window.setTimeout(resetGesture, 8000); }, 2000);
    }
}
function resetGesture() {
    window.clearTimeout(gestureTimer);
    gesture = 0;
    gesturePhase = 'idle';
}
function closeAdmin() { adminOpen = false; render(); document.querySelector('#brand-title')?.focus(); }
function action(name) {
    if (name === 'start') {
        if (timerMode === 'done')
            completionGuard = false;
        durationDraft = data.settings.focusMinutes;
        remainingMs = durationDraft * 60000;
        timerMode = 'running';
        endAt = Date.now() + remainingMs;
        completionGuard = false;
        try {
            if (!audio || audio.state === 'closed')
                audio = new AudioContext();
        }
        catch { /* optional */ }
        render();
        return;
    }
    if (name === 'pause' && timerMode === 'running') {
        remainingMs = Math.max(0, endAt - Date.now());
        if (remainingMs <= 0) {
            completeTimer();
            return;
        }
        timerMode = 'paused';
        window.clearInterval(timerHandle);
        render();
        return;
    }
    if (name === 'resume' && timerMode === 'paused') {
        timerMode = 'running';
        endAt = Date.now() + remainingMs;
        render();
        return;
    }
    if (name === 'reset') {
        resetTimer();
        return;
    }
    if (name === 'memory-start') {
        beginMemory();
        return;
    }
    if (name === 'attention-start') {
        startAttention();
        return;
    }
    if (name === 'admin-close') {
        closeAdmin();
        return;
    }
    if (name === 'export') {
        downloadBackup();
        return;
    }
    if (name === 'import-open') {
        document.querySelector('#import-file')?.click();
        return;
    }
    if (name === 'clear-history') {
        if (!ask('Clear all completed focus sessions? This cannot be undone. Game results and settings will stay.'))
            return;
        data.sessions = [];
        save();
        render();
        toast('Focus history cleared.');
        return;
    }
    if (name === 'clear-games') {
        if (!ask('Reset all game scores and results? This cannot be undone. Focus history and settings will stay.'))
            return;
        data.results = [];
        save();
        render();
        toast('Game results reset.');
        return;
    }
    if (name === 'restore-defaults') {
        if (!ask('Restore default settings? Your focus history and game results will be kept.'))
            return;
        const fresh = defaults();
        data.settings = fresh.settings;
        memory.difficulty = data.settings.games.memory.difficulty;
        attention.difficulty = data.settings.games.attention.difficulty;
        if (timerMode === 'idle' || timerMode === 'done') {
            durationDraft = data.settings.focusMinutes;
            remainingMs = durationDraft * 60000;
        }
        save();
        render();
        toast('Default settings restored.');
        return;
    }
    if (name === 'erase-all') {
        if (!ask('Erase all MINDSCAPE data on this device, including settings, sessions, and game results? This cannot be undone.'))
            return;
        data = defaults();
        durationDraft = data.settings.focusMinutes;
        taskName = '';
        resetUsageTracking();
        resetTimer();
        clearMemoryTimers();
        memory = { phase: 'idle', sequence: [], index: 0, rounds: 0, score: 0, difficulty: 'normal' };
        attention = { running: false, score: 0, endsAt: 0, target: '', targetIndex: 0, count: 12, board: [], difficulty: 'normal', feedback: '' };
        window.clearInterval(gameHandle);
        save();
        adminOpen = true;
        render();
        toast('All app data erased.');
        return;
    }
}
function bindAdmin() {
    const backdrop = document.querySelector('#admin-backdrop');
    backdrop?.addEventListener('click', e => { if (e.target === backdrop)
        closeAdmin(); });
    document.querySelector('#admin-focus')?.addEventListener('change', e => {
        const field = e.currentTarget, value = Number(field.value);
        if (!Number.isInteger(value) || value < 1 || value > 180) {
            field.value = String(data.settings.focusMinutes);
            toast('Focus length must be 1–180 minutes.');
            return;
        }
        data.settings.focusMinutes = value;
        if (timerMode === 'idle' || timerMode === 'done') {
            durationDraft = value;
            remainingMs = value * 60000;
        }
        save();
    });
    document.querySelector('#admin-break')?.addEventListener('change', e => {
        const field = e.currentTarget, value = Number(field.value);
        if (!Number.isInteger(value) || value < 1 || value > 60) {
            field.value = String(data.settings.breakMinutes);
            toast('Break length must be 1–60 minutes.');
            return;
        }
        data.settings.breakMinutes = value;
        save();
    });
    document.querySelector('#admin-sound')?.addEventListener('change', e => { data.settings.sound = e.currentTarget.checked; save(); });
    document.querySelector('#admin-theme')?.addEventListener('change', e => {
        data.settings.theme = e.currentTarget.value;
        save();
        setTheme();
    });
    document.querySelectorAll('[data-game-enabled]').forEach(el => el.addEventListener('change', () => {
        const game = el.dataset.gameEnabled;
        data.settings.games[game].enabled = el.checked;
        if (!el.checked && game === 'memory') {
            clearMemoryTimers();
            memory = { phase: 'idle', sequence: [], index: 0, rounds: 0, score: 0, difficulty: data.settings.games.memory.difficulty };
        }
        if (!el.checked && game === 'attention') {
            attention.running = false;
            window.clearInterval(gameHandle);
        }
        save();
    }));
    document.querySelectorAll('[data-game-difficulty]').forEach(el => el.addEventListener('change', () => {
        const game = el.dataset.gameDifficulty;
        if (isDifficulty(el.value)) {
            data.settings.games[game].difficulty = el.value;
            if (game === 'memory')
                memory.difficulty = el.value;
            else
                attention.difficulty = el.value;
            save();
        }
    }));
    document.querySelector('#import-file')?.addEventListener('change', async (e) => {
        const input = e.currentTarget, file = input.files?.[0];
        if (!file)
            return;
        try {
            if (file.size > 5_000_000)
                throw new Error('This backup is larger than 5 MB.');
            const parsed = JSON.parse(await file.text());
            const imported = parseImport(parsed);
            if (!ask('Replace all current MINDSCAPE data with this backup? This cannot be undone.')) {
                input.value = '';
                return;
            }
            if (!saveData(imported))
                throw new Error('The backup is valid, but this browser could not save it. Current data was kept.');
            data = imported;
            durationDraft = data.settings.focusMinutes;
            taskName = '';
            resetTimer();
            attention.running = false;
            window.clearInterval(gameHandle);
            clearMemoryTimers();
            memory = { phase: 'idle', sequence: [], index: 0, rounds: 0, score: 0, difficulty: data.settings.games.memory.difficulty };
            attention = { running: false, score: 0, endsAt: 0, target: '', targetIndex: 0, count: 12, board: [], difficulty: data.settings.games.attention.difficulty, feedback: '' };
            notice = '';
            render();
            toast('Backup imported successfully.');
        }
        catch (err) {
            toast(err instanceof Error ? err.message : 'Could not read this backup. Current data was kept.');
        }
        finally {
            input.value = '';
        }
    });
}
function handleGlobalKey(event) {
    if (!adminOpen)
        return;
    if (event.key === 'Escape') {
        closeAdmin();
        return;
    }
    if (event.key === 'Tab') {
        const modal = document.querySelector('.admin-modal');
        if (!modal)
            return;
        const items = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled):not([type="file"]), select:not(:disabled)')].filter(el => !el.closest('[inert]'));
        if (!items.length)
            return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        }
        else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
}
document.addEventListener('keydown', handleGlobalKey);
document.addEventListener('click', event => {
    if ((gesture > 0 || gesturePhase !== 'idle') && !(event.target instanceof Element && event.target.closest('#brand-title')))
        resetGesture();
}, true);
window.addEventListener('pagehide', () => {
    window.clearInterval(timerHandle);
    window.clearInterval(gameHandle);
    resetGesture();
    clearMemoryTimers();
    memory.phase = 'idle';
    attention.running = false;
    if (timerMode === 'running') {
        timerMode = 'idle';
        remainingMs = durationDraft * 60000;
        endAt = 0;
        completionGuard = false;
    }
    if (audio && audio.state !== 'closed')
        void audio.close();
});
window.addEventListener('pageshow', () => {
    if (!usageTimer) {
        usageLastTick = Date.now();
        usageTimer = window.setInterval(updateUsageTracking, 5000);
    }
    render();
});
initializeUsageTracking();
render();

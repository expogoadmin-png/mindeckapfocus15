export const KEY = 'mindscape.local.v1';
export const defaults = () => ({
    version: 1,
    settings: {
        focusMinutes: 25, breakMinutes: 5, sound: false, theme: 'dark',
        games: {
            memory: { enabled: true, difficulty: 'normal' },
            attention: { enabled: true, difficulty: 'normal' },
        },
    },
    sessions: [], results: [],
});
export const isDifficulty = (v) => v === 'easy' || v === 'normal' || v === 'hard';
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const hasKeys = (v, keys) => Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const isTimestamp = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v &&
    Date.parse(v) <= Date.now() + 5 * 60 * 1000;
const validate = (v) => {
    if (!isRecord(v) || !hasKeys(v, ['version', 'settings', 'sessions', 'results']) || v.version !== 1 ||
        !isRecord(v.settings) || !Array.isArray(v.sessions) || !Array.isArray(v.results))
        return false;
    const s = v.settings;
    if (!hasKeys(s, ['focusMinutes', 'breakMinutes', 'sound', 'theme', 'games']) ||
        !Number.isInteger(s.focusMinutes) || Number(s.focusMinutes) < 1 || Number(s.focusMinutes) > 180 ||
        !Number.isInteger(s.breakMinutes) || Number(s.breakMinutes) < 1 || Number(s.breakMinutes) > 60 ||
        typeof s.sound !== 'boolean' || (s.theme !== 'dark' && s.theme !== 'light') || !isRecord(s.games))
        return false;
    if (!hasKeys(s.games, ['memory', 'attention']))
        return false;
    for (const game of ['memory', 'attention']) {
        const g = s.games[game];
        if (!isRecord(g) || !hasKeys(g, ['enabled', 'difficulty']) || typeof g.enabled !== 'boolean' || !isDifficulty(g.difficulty))
            return false;
    }
    if (v.sessions.length > 10000 || v.results.length > 10000)
        return false;
    const ids = new Set();
    for (const row of v.sessions) {
        if (!isRecord(row) || !hasKeys(row, ['id', 'task', 'minutes', 'completedAt']) || typeof row.id !== 'string' || !/^[\w-]{1,100}$/.test(row.id) || ids.has(row.id) ||
            typeof row.task !== 'string' || row.task.length > 160 || !Number.isInteger(row.minutes) ||
            Number(row.minutes) < 1 || Number(row.minutes) > 180 || !isTimestamp(row.completedAt))
            return false;
        ids.add(row.id);
    }
    for (const row of v.results) {
        if (!isRecord(row) || !hasKeys(row, ['id', 'game', 'score', 'difficulty', 'completedAt']) || typeof row.id !== 'string' || !/^[\w-]{1,100}$/.test(row.id) || ids.has(row.id) ||
            (row.game !== 'memory' && row.game !== 'attention') || !Number.isInteger(row.score) ||
            Number(row.score) < 0 || Number(row.score) > (row.game === 'memory' ? 500 : 1000) ||
            !isDifficulty(row.difficulty) || !isTimestamp(row.completedAt))
            return false;
        ids.add(row.id);
    }
    return true;
};
export function parseImport(input) {
    if (!isRecord(input) || input.version !== 1)
        throw new Error('This file is not a compatible MINDSCAPE backup (version 1).');
    if (!validate(input))
        throw new Error('The backup contains invalid or incomplete data. Nothing was changed.');
    return structuredClone(input);
}
export function loadData() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw)
            return { data: defaults(), notice: '' };
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            try {
                localStorage.removeItem(KEY);
            }
            catch { /* continue with safe defaults */ }
            return { data: defaults(), notice: 'Saved MINDSCAPE data could not be read and was reset. Your new practice space is ready.' };
        }
        if (validate(parsed))
            return { data: parsed, notice: '' };
        const msg = isRecord(parsed) && typeof parsed.version === 'number' && parsed.version > 1
            ? 'Your saved MINDSCAPE data is from a newer version and could not be opened. A fresh local space is ready.'
            : 'Saved MINDSCAPE data was damaged or incompatible. A fresh local space is ready.';
        try {
            localStorage.removeItem(KEY);
        }
        catch { /* readable fallback */ }
        return { data: defaults(), notice: msg };
    }
    catch {
        return { data: defaults(), notice: 'Browser storage could not be read. Changes may not persist on this device.' };
    }
}
export function saveData(data) {
    try {
        localStorage.setItem(KEY, JSON.stringify(data));
        return true;
    }
    catch {
        return false;
    }
}
export function makeId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

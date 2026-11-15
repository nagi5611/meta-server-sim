/** @param {string} animState @returns {string} */
export function normalizePlayerAnimState(animState) {
    const s = String(animState ?? 'idle').trim().toLowerCase();
    if (s === 'dash') return 'run';
    if (s === 'walk' || s === 'run' || s === 'jump' || s === 'idle') return s;
    return 'idle';
}

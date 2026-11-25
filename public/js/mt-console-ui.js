// public/js/mt-console-ui.js — CONSOLE 線画アイコン（デザインハンドオフ mt-ui.js より）
const ICON_PATHS = {
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.4"/>',
    pulse: '<path d="M3 12h3.5l2-6 3 12 2.5-8 1.6 2H21"/>',
    net: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 2.4 12.7 0 17M12 3.5c-2.4 2.4-2.4 12.7 0 17"/>',
    cube: '<path d="M12 3.2l7.6 4.3v8.9L12 20.8l-7.6-4.4V7.5z"/><path d="M4.4 7.5L12 11.9l7.6-4.4M12 11.9v8.9"/>',
    shield: '<path d="M12 3.4l7 2.8v5.5c0 4.4-3 7.4-7 8.9-4-1.5-7-4.5-7-8.9V6.2z"/><path d="M9 12.2l2.1 2.1 4-4.2"/>',
    chev: '<path d="M6 9.5l6 5 6-5"/>',
    open: '<path d="M14 5h5v5M19 5l-6.5 6.5"/><path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
    modules:
        '<rect x="3.5" y="3.5" width="7" height="7" rx="1.3"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.3"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.3"/><path d="M17 4v6.4M13.8 7.2h6.4"/>',
    settings:
        '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.1 5.1l1.7 1.7M17.2 17.2l1.7 1.7M5.1 18.9l1.7-1.7M17.2 6.8l1.7-1.7"/>',
};

/**
 * HTML エスケープ
 * @param {unknown} s
 */
export function mtEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * 線画アイコン SVG
 * @param {string} name
 * @param {string} [cls]
 */
export function mtIcon(name, cls = '') {
    const body = ICON_PATHS[name] || '';
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true">${body}</svg>`;
}

/**
 * トースト表示（#mt-toast）
 * @param {string} msg
 */
export function mtToast(msg) {
    const el = document.getElementById('mt-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(mtToast._t);
    mtToast._t = window.setTimeout(() => el.classList.remove('on'), 2200);
}
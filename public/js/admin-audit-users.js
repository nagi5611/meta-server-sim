// public/js/admin-audit-users.js — プラットフォーム「監査ログ・権限」パネル（実ユーザー DB）
import { adminFetch } from './admin-api-fetch.js';
import { mtEsc } from './mt-console-ui.js';

/**
 * 教職員・生徒一覧を読み込み表示する
 */
export async function initAdminAuditUsersPanel() {
    const statusEl = document.getElementById('mt-audit-users-status');
    const hintEl = document.getElementById('mt-audit-users-hint');
    const teachersBody = document.querySelector('#mt-audit-teachers-table tbody');
    const studentsBody = document.querySelector('#mt-audit-students-table tbody');
    if (!teachersBody || !studentsBody) return;

    try {
        const statusRes = await adminFetch('/admin/users/status', { credentials: 'include' });
        const statusJson = await statusRes.json().catch(() => ({}));
        if (!statusRes.ok) throw new Error(statusJson.error || `HTTP ${statusRes.status}`);

        if (statusEl) {
            const ok = Boolean(statusJson.sqliteExists ?? statusJson.backend);
            statusEl.textContent = ok ? '接続済み' : '未接続';
            statusEl.className = ok ? 'tag ok' : 'tag bad';
        }
        if (hintEl) {
            const c = statusJson.counts || {};
            hintEl.textContent = `教職員 ${c.teachers ?? 0} 件 / 生徒 ${c.students ?? 0} 件（${statusJson.driver || statusJson.backend || 'users DB'}）`;
        }

        const [tRes, sRes] = await Promise.all([
            adminFetch('/admin/users/teachers', { credentials: 'include' }),
            adminFetch('/admin/users/students', { credentials: 'include' }),
        ]);
        const teachers = tRes.ok ? await tRes.json() : [];
        const students = sRes.ok ? await sRes.json() : [];

        renderUserRows(teachersBody, Array.isArray(teachers) ? teachers : []);
        renderUserRows(studentsBody, Array.isArray(students) ? students : []);
    } catch (e) {
        if (statusEl) {
            statusEl.textContent = '読み込み失敗';
            statusEl.className = 'tag bad';
        }
        if (hintEl) {
            hintEl.textContent = e instanceof Error ? e.message : 'ユーザー DB に接続できません';
        }
        teachersBody.innerHTML = '<tr><td colspan="3">—</td></tr>';
        studentsBody.innerHTML = '<tr><td colspan="3">—</td></tr>';
    }
}

/**
 * @param {HTMLTableSectionElement} tbody
 * @param {Array<{ id?: number|string, username?: string, displayName?: string }>} rows
 */
function renderUserRows(tbody, rows) {
    tbody.replaceChildren();
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="3">登録ユーザーがありません</td></tr>';
        return;
    }
    for (const u of rows) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="mono">${mtEsc(u.id)}</td>
          <td><code>${mtEsc(u.username)}</code></td>
          <td>${mtEsc(u.displayName || '')}</td>
        `;
        tbody.appendChild(tr);
    }
}
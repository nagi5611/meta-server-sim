// public/js/tenant-login-gate.js — 入場前: 表示名 + アバター選択
import { getTenantIdFromPath } from './tenant-runtime-shim.js';

/**
 * @returns {Promise<void>}
 */
export async function runTenantLoginGate() {
    const tenantId = getTenantIdFromPath();
    const gate = document.getElementById('tenant-login-gate');
    if (!tenantId || !gate) return;

    const apiBase = `/${encodeURIComponent(tenantId)}/api`;
    let avatars = [];
    try {
        const r = await fetch(`${apiBase}/avatars`, { credentials: 'include' });
        const data = await r.json().catch(() => ({}));
        avatars = Array.isArray(data.avatars) ? data.avatars : [];
    } catch {
        gate.hidden = true;
        return;
    }

    const nameInput = document.getElementById('tenant-login-display-name');
    const avatarSelect = document.getElementById('tenant-login-avatar-select');
    const enterBtn = document.getElementById('tenant-login-enter-btn');

    const lsNameKey = 'username';
    const lsAvatarKey = `metaverseAvatarId:${tenantId}`;

    if (nameInput) {
        nameInput.value = localStorage.getItem(lsNameKey) || '';
    }

    if (avatarSelect) {
        avatarSelect.replaceChildren();
        if (avatars.length === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = '（アバター未登録 — 管理画面で GLB を追加）';
            avatarSelect.appendChild(opt);
            avatarSelect.disabled = true;
        } else {
            const saved = localStorage.getItem(lsAvatarKey);
            for (const a of avatars) {
                const opt = document.createElement('option');
                opt.value = a.id;
                opt.textContent = a.isDefault ? `${a.id} (default)` : a.id;
                avatarSelect.appendChild(opt);
            }
            const pick =
                saved && avatars.some((a) => a.id === saved)
                    ? saved
                    : avatars.find((a) => a.isDefault)?.id || avatars[0]?.id || '';
            avatarSelect.value = pick;
        }
    }

    if (avatars.length <= 1 && avatars[0]?.id) {
        localStorage.setItem(lsAvatarKey, avatars[0].id);
        if (avatars.length === 0) {
            gate.hidden = true;
            return;
        }
    }

    if (avatars.length <= 1) {
        gate.hidden = true;
        return;
    }

    const e2eHarnessEnabled =
        document.documentElement.dataset.e2eHarness === '1' ||
        window.__TENANT_E2E_HARNESS__ === '1';
    if (e2eHarnessEnabled) {
        const name =
            String(nameInput?.value || '').trim() ||
            localStorage.getItem(lsNameKey) ||
            `E2E-${Date.now()}`;
        localStorage.setItem(lsNameKey, name);
        const avatarId =
            String(avatarSelect?.value || '').trim() ||
            avatars.find((a) => a.isDefault)?.id ||
            avatars[0]?.id ||
            '';
        if (avatarId) localStorage.setItem(lsAvatarKey, avatarId);
        gate.hidden = true;
        document.body.classList.remove('tenant-login-gate-open');
        return;
    }

    gate.hidden = false;
    document.body.classList.add('tenant-login-gate-open');

    await new Promise((resolve) => {
        const finish = () => {
            const name = String(nameInput?.value || '').trim();
            if (name) localStorage.setItem(lsNameKey, name);
            const avatarId = String(avatarSelect?.value || '').trim();
            if (avatarId) localStorage.setItem(lsAvatarKey, avatarId);
            gate.hidden = true;
            document.body.classList.remove('tenant-login-gate-open');
            resolve();
        };
        enterBtn?.addEventListener('click', finish, { once: true });
        nameInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') finish();
        });
    });
}

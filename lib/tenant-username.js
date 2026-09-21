// lib/tenant-username.js — テナント表示名（set-username）の検証

import { getPlatformEnv } from './platform-env-config.js';

/** 管理者表示名として固定利用（getPlayerDisplayName と一致） */
export const PLATFORM_ADMIN_DISPLAY_NAME = 'admin';

/**
 * 非管理者が set-username で使えない表示名（小文字）
 * @param {string} [adminUsernameFromEnv]
 * @returns {Set<string>}
 */
export function buildReservedTenantUsernameSet(adminUsernameFromEnv) {
    const configured =
        String(adminUsernameFromEnv ?? (getPlatformEnv('ADMIN_USERNAME') || 'admin')).trim() || 'admin';
    const set = new Set([PLATFORM_ADMIN_DISPLAY_NAME.toLowerCase()]);
    set.add(configured.toLowerCase());
    return set;
}

/**
 * set-username の入力を検証する
 * @param {unknown} data
 * @param {{ isAdmin: boolean, reservedLowercase?: Set<string> }} ctx
 * @returns {{ ok: true, name: string } | { ok: false, code: 'invalid_length' | 'reserved_username' }}
 */
export function parseAndValidateTenantUsername(data, ctx) {
    const name = String(data?.username ?? data ?? '').trim();
    if (name.length < 1 || name.length > 32) {
        return { ok: false, code: 'invalid_length' };
    }
    if (!ctx.isAdmin) {
        const reserved = ctx.reservedLowercase ?? buildReservedTenantUsernameSet();
        if (reserved.has(name.toLowerCase())) {
            return { ok: false, code: 'reserved_username' };
        }
    }
    return { ok: true, name };
}

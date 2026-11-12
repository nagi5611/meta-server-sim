// lib/tenant-world-edit-request.js — ワールド編集ページからのレガシー /admin/worlds リクエスト解決

/**
 * metaverse-simple /admin/worlds 互換: Referer 等から tenant ID を解決
 * @param {import('express').Request} req
 * @returns {string | null}
 */
export function resolveTenantIdFromAdminWorldEditRequest(req) {
    const referer = String(req.get('referer') || '');
    const m = referer.match(/\/admin\/tenant\/([^/]+)\/world-edit/);
    if (m?.[1]) {
        return decodeURIComponent(m[1]).trim();
    }
    const header = String(req.get('x-tenant-admin-id') || '').trim();
    return header || null;
}

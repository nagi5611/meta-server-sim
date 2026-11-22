// lib/tenant-external-teleporter.js — worlds.json の外部 URL テレポーター検証

/**
 * テレポーターの外部遷移先 URL（https のみ許可）
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeExternalTeleporterUrl(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    try {
        const u = new URL(s);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        if (u.username || u.password) return null;
        return u.href;
    } catch {
        return null;
    }
}

/**
 * ワールド定義から teleporter.id → destinationUrl の Map を構築する
 * @param {Record<string, unknown> | null | undefined} world
 * @returns {Map<string, string>}
 */
export function collectTeleporterDestinationUrls(world) {
    const map = new Map();
    if (!world || typeof world !== 'object') return map;

    const ingest = (cfg) => {
        if (!cfg || typeof cfg !== 'object') return;
        const tp = /** @type {Record<string, unknown>} */ (cfg).teleporter;
        if (!tp || typeof tp !== 'object') return;
        const id = String(tp.id ?? '').trim();
        const url = normalizeExternalTeleporterUrl(tp.destinationUrl);
        if (id && url) map.set(id, url);
    };

    const models = Array.isArray(world.models) ? world.models : [];
    for (const m of models) ingest(m);

    const pdfs = Array.isArray(world.pdfs) ? world.pdfs : [];
    for (const p of pdfs) ingest(p);

    return map;
}
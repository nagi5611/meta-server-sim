// lib/platform-lobby-catalog.js — メタバースロビー（Cloudflare Pages）向けカタログ
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTenantPublicUrl } from './platform-network-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, '..', 'data', 'platform', 'lobby-catalog.json');

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   joinCode?: string,
 *   entryUrl: string,
 *   statusUrl?: string,
 *   presenceUrl?: string,
 *   description?: string,
 *   thumbnailUrl?: string,
 *   maintenance?: boolean,
 *   capacity?: number,
 *   sortOrder?: number,
 *   enabled?: boolean,
 *   tenantId?: string,
 * }} LobbyMetaverseEntry
 */

/**
 * @typedef {{ metaverses: LobbyMetaverseEntry[], updatedAt?: string }} LobbyCatalogFile
 */

/** @param {unknown} raw */
function normalizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id ?? '').trim();
    const name = String(raw.name ?? '').trim();
    const entryUrl = String(raw.entryUrl ?? '').trim();
    if (!id || !name || !entryUrl) return null;
    /** @type {LobbyMetaverseEntry} */
    const entry = {
        id,
        name,
        entryUrl,
        joinCode: raw.joinCode != null ? String(raw.joinCode).trim().toUpperCase() : undefined,
        statusUrl: raw.statusUrl != null ? String(raw.statusUrl).trim() : undefined,
        presenceUrl: raw.presenceUrl != null ? String(raw.presenceUrl).trim() : undefined,
        description: raw.description != null ? String(raw.description) : undefined,
        thumbnailUrl: raw.thumbnailUrl != null ? String(raw.thumbnailUrl).trim() : undefined,
        maintenance: Boolean(raw.maintenance),
        capacity:
            raw.capacity != null && Number.isFinite(Number(raw.capacity))
                ? Number(raw.capacity)
                : undefined,
        sortOrder:
            raw.sortOrder != null && Number.isFinite(Number(raw.sortOrder))
                ? Number(raw.sortOrder)
                : 0,
        enabled: raw.enabled !== false,
        tenantId: raw.tenantId != null ? String(raw.tenantId).trim() : undefined,
    };
    if (!entry.joinCode) delete entry.joinCode;
    return entry;
}

/**
 * @returns {LobbyCatalogFile}
 */
export function loadLobbyCatalog() {
    try {
        const raw = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
        const list = Array.isArray(raw?.metaverses) ? raw.metaverses : [];
        const metaverses = list.map(normalizeEntry).filter(Boolean);
        metaverses.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
        return {
            metaverses,
            updatedAt: raw?.updatedAt != null ? String(raw.updatedAt) : undefined,
        };
    } catch {
        return { metaverses: [] };
    }
}

/**
 * @param {LobbyCatalogFile} catalog
 */
export function saveLobbyCatalog(catalog) {
    const metaverses = (catalog.metaverses || []).map(normalizeEntry).filter(Boolean);
    metaverses.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const payload = {
        metaverses,
        updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });
    const tmp = `${CATALOG_PATH}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, CATALOG_PATH);
    return payload;
}

/**
 * Worker / Pages 用の公開ペイロード
 * @param {LobbyCatalogFile} [catalog]
 */
export function buildLobbyWorkerRegistry(catalog = loadLobbyCatalog()) {
    return {
        updatedAt: catalog.updatedAt || new Date().toISOString(),
        metaverses: catalog.metaverses
            .filter((m) => m.enabled !== false)
            .map((m) => ({
                id: m.id,
                name: m.name,
                joinCode: m.joinCode || null,
                entryUrl: m.entryUrl,
                statusUrl: m.statusUrl || null,
                presenceUrl: m.presenceUrl || null,
                description: m.description || '',
                thumbnailUrl: m.thumbnailUrl || null,
                maintenance: Boolean(m.maintenance),
                capacity: m.capacity ?? null,
            })),
    };
}

/**
 * @param {{ tenantId: string, displayName?: string, entryUrl?: string }} opts
 */
export function upsertLobbyEntryForTenant(opts) {
    const tenantId = String(opts.tenantId || '').trim();
    if (!tenantId) return loadLobbyCatalog();
    const catalog = loadLobbyCatalog();
    const entryUrl = String(opts.entryUrl || getTenantPublicUrl(tenantId) || `/${tenantId}/`).trim();
    const baseStatus = entryUrl.replace(/\/$/, '');
    const origin = (() => {
        try {
            return new URL(entryUrl).origin;
        } catch {
            return '';
        }
    })();
    const statusUrl = origin ? `${origin}/api/lobby/status` : `${baseStatus}/api/lobby/status`;
    const presenceUrl = origin ? `${origin}/api/lobby/presence` : `${baseStatus}/api/lobby/presence`;

    const name = String(opts.displayName || tenantId).trim() || tenantId;
    const id = `tenant-${tenantId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const joinCode = tenantId.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);

    const idx = catalog.metaverses.findIndex(
        (m) => m.tenantId === tenantId || m.id === id,
    );
    /** @type {LobbyMetaverseEntry} */
    const next = {
        id,
        tenantId,
        name,
        entryUrl: entryUrl.endsWith('/') ? entryUrl : `${entryUrl}/`,
        joinCode: joinCode || undefined,
        statusUrl,
        presenceUrl,
        description: '',
        maintenance: false,
        capacity: 5000,
        sortOrder: idx >= 0 ? catalog.metaverses[idx].sortOrder ?? 0 : catalog.metaverses.length,
        enabled: true,
    };
    if (idx >= 0) {
        catalog.metaverses[idx] = { ...catalog.metaverses[idx], ...next };
    } else {
        catalog.metaverses.push(next);
    }
    return saveLobbyCatalog(catalog);
}

export function removeLobbyEntryForTenant(tenantId) {
    const id = String(tenantId || '').trim();
    const catalog = loadLobbyCatalog();
    catalog.metaverses = catalog.metaverses.filter(
        (m) => m.tenantId !== id && m.id !== id,
    );
    return saveLobbyCatalog(catalog);
}

export function getLobbyCatalogPath() {
    return CATALOG_PATH;
}
// lib/world-edit-mcp-snapshots.js — worlds.json のスナップショット（保存前バックアップ）

import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} snapshotDir
 */
export function ensureSnapshotDir(snapshotDir) {
    fs.mkdirSync(snapshotDir, { recursive: true });
}

/**
 * @param {string} snapshotDir
 * @param {string} tenantId
 * @param {unknown} worlds
 * @param {string} [label]
 * @returns {{ snapshotId: string, path: string }}
 */
export function writeWorldsSnapshot(snapshotDir, tenantId, worlds, label = 'pre-save') {
    ensureSnapshotDir(snapshotDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotId = `${tenantId}-${label}-${ts}`;
    const filePath = path.join(snapshotDir, `${snapshotId}.json`);
    const payload = {
        snapshotId,
        tenantId,
        label,
        createdAt: new Date().toISOString(),
        worlds,
    };
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return { snapshotId, path: filePath };
}

/**
 * @param {string} filePath
 */
export function readWorldsSnapshot(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data.worlds) throw new Error('snapshot missing worlds');
    return data;
}

/**
 * @param {string} snapshotDir
 * @returns {{ snapshotId: string, path: string, createdAt: string }[]}
 */
export function listWorldsSnapshots(snapshotDir) {
    if (!fs.existsSync(snapshotDir)) return [];
    const names = fs.readdirSync(snapshotDir).filter((n) => n.endsWith('.json'));
    /** @type {{ snapshotId: string, path: string, createdAt: string }[]} */
    const rows = [];
    for (const name of names) {
        const p = path.join(snapshotDir, name);
        try {
            const data = JSON.parse(fs.readFileSync(p, 'utf8'));
            rows.push({
                snapshotId: String(data.snapshotId || name.replace(/\.json$/, '')),
                path: p,
                createdAt: String(data.createdAt || ''),
            });
        } catch {
            rows.push({ snapshotId: name.replace(/\.json$/, ''), path: p, createdAt: '' });
        }
    }
    rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return rows;
}
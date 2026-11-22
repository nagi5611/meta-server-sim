#!/usr/bin/env node
// scripts/ws8-add-lobby-meta-server.mjs — lobby-catalog に meta-server 行を冪等追加（WS-8）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = process.argv[2];
if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
    console.error('Usage: node scripts/ws8-add-lobby-meta-server.mjs <baseUrl> [catalogPath]');
    process.exit(1);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath =
    process.argv[3] || path.join(root, 'data', 'platform', 'lobby-catalog.json');
const raw = fs.readFileSync(catalogPath, 'utf8');
/** @type {{ metaverses: object[], updatedAt?: string }} */
const catalog = JSON.parse(raw);
if (catalog.metaverses.some((m) => m.tenantId === 'meta-server')) {
    console.log('[ws8-lobby] tenant meta-server already in catalog');
    process.exit(0);
}
const sortOrders = catalog.metaverses.map((m) => Number(m.sortOrder) || 0);
const sortOrder = Math.max(0, ...sortOrders) + 1;
const base = baseUrl.replace(/\/$/, '');
catalog.metaverses.push({
    id: 'tenant-meta-server',
    name: 'meta-server（sim テナント）',
    entryUrl: `${base}/meta-server/`,
    joinCode: 'META',
    statusUrl: `${base}/api/lobby/status`,
    presenceUrl: `${base}/api/lobby/presence`,
    description: '',
    maintenance: false,
    lobbyStatus: 'open',
    audience: 'all',
    capacity: 5000,
    sortOrder,
    enabled: true,
    tenantId: 'meta-server',
});
catalog.updatedAt = new Date().toISOString();
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`[ws8-lobby] added meta-server entryUrl=${base}/meta-server/`);
#!/usr/bin/env node
// scripts/ws8-lobby-worker-sync-once.mjs — lobby-catalog.json → Worker KV（CSRF 不要・WS-8 運用）

import dotenv from 'dotenv';
import { buildLobbyWorkerRegistry, loadLobbyCatalog } from '../lib/platform-lobby-catalog.js';
import { syncLobbyCatalogToWorker } from '../lib/platform-lobby-sync.js';

dotenv.config();

const catalog = loadLobbyCatalog();
const preview = buildLobbyWorkerRegistry(catalog);
console.log(
    `[ws8-lobby-sync] preview count=${preview.metaverses.length} ids=${preview.metaverses.map((m) => m.id).join(',')}`
);
const sync = await syncLobbyCatalogToWorker(catalog);
console.log(`[ws8-lobby-sync] result ${JSON.stringify(sync)}`);
if (!sync.ok && !sync.skipped) process.exit(1);
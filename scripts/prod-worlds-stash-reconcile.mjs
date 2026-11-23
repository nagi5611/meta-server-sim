#!/usr/bin/env node
/**
 * 本番: 現行 worlds.json / stash / バックアップを比較し、stash にのみある差分をレポート。
 * 復元は --apply で実行（事前にバックアップ作成）。
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const tenantId = process.argv[2] || 'P-01';
const apply = process.argv.includes('--apply');
const backupPath = process.argv.find((a) => a.startsWith('--backup='))?.slice(9);

const worldsPath = path.join(ROOT, 'tenants', tenantId, 'data', 'worlds.json');
const current = JSON.parse(fs.readFileSync(worldsPath, 'utf8'));

/** @param {string} p */
function loadJsonFile(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

let stashWorlds = null;
try {
    const patch = execSync('git stash show -p stash@{0} -- tenants/' + tenantId + '/data/worlds.json', {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
    });
    if (patch.trim()) {
        const plus = patch
            .split('\n')
            .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
            .map((l) => l.slice(1))
            .join('\n');
        const body = plus.startsWith('{') ? plus : null;
        if (body) stashWorlds = JSON.parse(body);
    }
} catch {
    stashWorlds = null;
}

let backupWorlds = null;
const bk = backupPath || `/home/nagi/sim-server/backups/worlds-p01-pre-mcp-20261123T155002Z.json`;
if (fs.existsSync(bk)) {
    const raw = loadJsonFile(bk);
    backupWorlds = raw.worlds ?? raw;
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 一時検証オブジェクト（MCP place_model の座標）を models から除去
 * @param {Record<string, unknown>} worlds
 */
function stripMcpTestModels(worlds) {
    const w = structuredClone(worlds);
    for (const wid of Object.keys(w)) {
        const world = w[wid];
        if (!world || typeof world !== 'object') continue;
        const models = world.models;
        if (!Array.isArray(models)) continue;
        world.models = models.filter((m) => {
            const pos = m?.position;
            if (!pos) return true;
            const isTest =
                Math.abs(Number(pos.x) - 888.777) < 0.01 ||
                Math.abs(Number(pos.x) - 999.125) < 0.01 ||
                Math.abs(Number(pos.x) - 777.1) < 0.01;
            return !isTest;
        });
    }
    return w;
}

const report = {
    tenantId,
    paths: { worldsPath, backup: bk },
    stashAvailable: Boolean(stashWorlds),
    currentMatchesBackup: backupWorlds ? deepEqual(current, backupWorlds) : null,
    currentMatchesStash: stashWorlds ? deepEqual(stripMcpTestModels(current), stashWorlds) : null,
    stashDiffersFromCurrent: stashWorlds ? !deepEqual(stashWorlds, stripMcpTestModels(current)) : null,
};

if (stashWorlds && report.stashDiffersFromCurrent && apply) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outBk = `/home/nagi/sim-server/backups/worlds-${tenantId}-pre-stash-restore-${ts}.json`;
    fs.writeFileSync(outBk, JSON.stringify({ worlds: current }, null, 2));
    fs.writeFileSync(worldsPath, `${JSON.stringify(stashWorlds, null, 2)}\n`);
    report.applied = true;
    report.backupWritten = outBk;
}

const outDir = process.env.MCP_ARTIFACTS_DIR || '/opt/cursor/artifacts';
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `prod-worlds-stash-reconcile-${tenantId}.json`);
fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
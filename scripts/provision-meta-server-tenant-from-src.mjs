#!/usr/bin/env node
// scripts/provision-meta-server-tenant-from-src.mjs — WS-8 用: /server_src から meta-server テナント骨格を同期（rsync dry-run 対応）

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const TENANT_ID = 'meta-server';

const SRC_ROOT = path.resolve(process.env.META_SRC_DIRECTORY || '/server_src');
const DEST_ROOT = path.resolve(
    process.env.META_TENANT_DEST || path.join(projectRoot, 'tenants', TENANT_ID),
);

const dryRun =
    process.argv.includes('--dry-run') ||
    process.argv.includes('-n') ||
    process.env.DRY_RUN === '1' ||
    process.env.DRY_RUN === 'true';

/** @type {Array<{ label: string, src: string, dest: string }>} */
const FILE_PAIRS = [
    {
        label: 'worlds.json',
        src: path.join(SRC_ROOT, 'data', 'worlds.json'),
        dest: path.join(DEST_ROOT, 'data', 'worlds.json'),
    },
    {
        label: 'avatars-registry.json',
        src: path.join(SRC_ROOT, 'avatars', '_meta', 'avatars-registry.json'),
        dest: path.join(DEST_ROOT, 'avatars', '_meta', 'avatars-registry.json'),
    },
];

const EMPTY_DIRS = ['models', 'env', 'images'].map((d) => path.join(DEST_ROOT, d));

/**
 * meta-server 由来の registry ラベルを sim/P-01 形式へ揃える（animationMap は維持）
 * @param {object} registry
 * @returns {object}
 */
export function normalizeMetaServerAvatarRegistry(registry) {
    const labelByName = {
        Long_Breathe_and_Look_Around: 'idle',
        Regular_Jump: 'jump',
        Running: 'run',
        Walking: 'walk',
    };
    const out = structuredClone(registry);
    if (!Array.isArray(out.avatars)) return out;
    for (const entry of out.avatars) {
        if (!Array.isArray(entry.animationClips)) continue;
        for (const clip of entry.animationClips) {
            const mapped = labelByName[clip.name];
            if (mapped) clip.label = mapped;
        }
        if (typeof entry.displayScale !== 'number') {
            entry.displayScale = 1;
        }
    }
    return out;
}

/**
 * rsync が利用可能か
 * @returns {boolean}
 */
function isRsyncAvailable() {
    const probe = spawnSync('rsync', ['--version'], { encoding: 'utf8' });
    return probe.status === 0;
}

/**
 * rsync で単一ファイルを同期する（--dry-run 時は転送しない）
 * @param {string} src
 * @param {string} dest
 * @returns {boolean}
 */
function rsyncOneFile(src, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const args = ['-a'];
    if (dryRun) args.push('--dry-run', '-v');
    args.push(src, dest);
    const result = spawnSync('rsync', args, { encoding: 'utf8' });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result.status === 0;
}

/**
 * 単一ファイル同期（本番は rsync、未インストール環境は Node コピー）
 * @param {string} src
 * @param {string} dest
 * @returns {boolean}
 */
function copyOneFile(src, dest) {
    if (!fs.existsSync(src)) {
        console.error(`[provision-meta-server] source missing: ${src}`);
        return false;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (isRsyncAvailable()) {
        if (!rsyncOneFile(src, dest)) {
            console.error(`[provision-meta-server] rsync failed: ${src} -> ${dest}`);
            return false;
        }
        return true;
    }
    if (dryRun) {
        console.log(`[provision-meta-server] (dry-run) would copy ${src} -> ${dest}`);
        return true;
    }
    fs.copyFileSync(src, dest);
    console.log(`[provision-meta-server] copied ${src} -> ${dest}`);
    return true;
}

/**
 * アバター registry を正規化して書き込む（rsync 後の sim スキーマ整合）
 * @param {string} destPath
 */
function postProcessAvatarRegistry(destPath) {
    if (dryRun) {
        console.log(`[provision-meta-server] (dry-run) would normalize: ${destPath}`);
        return;
    }
    if (!fs.existsSync(destPath)) return;
    const raw = fs.readFileSync(destPath, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalizeMetaServerAvatarRegistry(parsed);
    fs.writeFileSync(destPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
}

function ensureEmptyDirs() {
    for (const dir of EMPTY_DIRS) {
        if (dryRun) {
            console.log(`[provision-meta-server] (dry-run) would mkdir -p ${dir}`);
            continue;
        }
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`[provision-meta-server] created ${dir}`);
        }
    }
}

function main() {
    console.log(`[provision-meta-server] src=${SRC_ROOT} dest=${DEST_ROOT} dryRun=${dryRun}`);

    let ok = true;
    for (const pair of FILE_PAIRS) {
        if (!copyOneFile(pair.src, pair.dest)) ok = false;
    }

    const registryDest = path.join(DEST_ROOT, 'avatars', '_meta', 'avatars-registry.json');
    try {
        postProcessAvatarRegistry(registryDest);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[provision-meta-server] normalize registry failed: ${msg}`);
        ok = false;
    }

    ensureEmptyDirs();

    if (!dryRun && ok) {
        const tenantJson = path.join(DEST_ROOT, 'tenant.json');
        if (!fs.existsSync(tenantJson)) {
            fs.writeFileSync(
                tenantJson,
                `${JSON.stringify({ id: TENANT_ID, displayName: TENANT_ID, enabled: true }, null, 2)}\n`,
                'utf8',
            );
            console.log(`[provision-meta-server] wrote ${tenantJson}`);
        }
    } else if (dryRun) {
        console.log(`[provision-meta-server] (dry-run) would ensure tenant.json at ${DEST_ROOT}`);
    }

    if (!ok) process.exit(1);
    console.log('[provision-meta-server] done');
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
    main();
}
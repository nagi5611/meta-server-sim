#!/usr/bin/env node
// scripts/sync-meta-server-tenant-assets.mjs — WS-8 用: /server_src の非モデルアセットを tenants/meta-server へ同期（dry-run 対応）

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

/**
 * rsync が利用可能か
 * @returns {boolean}
 */
function isRsyncAvailable() {
    const probe = spawnSync('rsync', ['--version'], { encoding: 'utf8' });
    return probe.status === 0;
}

/**
 * ディレクトリを rsync する（末尾スラッシュ付きで中身のみ）
 * @param {string} label
 * @param {string} srcDir
 * @param {string} destDir
 * @returns {boolean}
 */
function rsyncDirectory(label, srcDir, destDir) {
    if (!fs.existsSync(srcDir)) {
        console.warn(`[sync-meta-server-assets] skip ${label}: source missing (${srcDir})`);
        return true;
    }
    fs.mkdirSync(destDir, { recursive: true });
    const args = [
        '-a',
        '--delete',
        '--omit-dir-times',
        ...(dryRun ? ['-n', '--itemize-changes'] : []),
        `${srcDir.replace(/\/$/, '')}/`,
        `${destDir.replace(/\/$/, '')}/`,
    ];
    if (isRsyncAvailable()) {
        const run = spawnSync('rsync', args, { encoding: 'utf8' });
        if (run.status !== 0) {
            console.error(`[sync-meta-server-assets] rsync failed (${label}):`, run.stderr || run.stdout);
            return false;
        }
        console.log(`[sync-meta-server-assets] rsync ${label}: ${srcDir} -> ${destDir}${dryRun ? ' (dry-run)' : ''}`);
        return true;
    }
    return copyTreeFallback(label, srcDir, destDir);
}

/**
 * rsync 未導入時の単純コピー
 * @param {string} label
 * @param {string} srcDir
 * @param {string} destDir
 * @returns {boolean}
 */
function copyTreeFallback(label, srcDir, destDir) {
    if (dryRun) {
        console.log(`[sync-meta-server-assets] (dry-run) would mirror ${label}: ${srcDir} -> ${destDir}`);
        return true;
    }
    /** @type {string[]} */
    const stack = [''];
    while (stack.length) {
        const rel = stack.pop() ?? '';
        const from = path.join(srcDir, rel);
        const to = path.join(destDir, rel);
        const entries = fs.readdirSync(from, { withFileTypes: true });
        for (const ent of entries) {
            const childRel = rel ? `${rel}/${ent.name}` : ent.name;
            const fromChild = path.join(srcDir, childRel);
            const toChild = path.join(destDir, childRel);
            if (ent.isDirectory()) {
                fs.mkdirSync(toChild, { recursive: true });
                stack.push(childRel);
            } else if (ent.isFile()) {
                fs.mkdirSync(path.dirname(toChild), { recursive: true });
                fs.copyFileSync(fromChild, toChild);
            }
        }
    }
    console.log(`[sync-meta-server-assets] copied tree ${label}: ${srcDir} -> ${destDir}`);
    return true;
}

/**
 * 単一 GLB をアバター store へ配置する
 * @param {string} srcGlb
 * @param {string} destGlb
 * @returns {boolean}
 */
function syncAvatarGlb(srcGlb, destGlb) {
    if (!fs.existsSync(srcGlb)) {
        console.error(`[sync-meta-server-assets] avatar GLB missing: ${srcGlb}`);
        return false;
    }
    fs.mkdirSync(path.dirname(destGlb), { recursive: true });
    if (dryRun) {
        console.log(`[sync-meta-server-assets] (dry-run) would copy avatar ${srcGlb} -> ${destGlb}`);
        return true;
    }
    fs.copyFileSync(srcGlb, destGlb);
    console.log(`[sync-meta-server-assets] copied avatar ${path.basename(srcGlb)}`);
    return true;
}

/**
 * @typedef {{ label: string, src: string, dest: string }} DirSyncSpec
 */

/** @type {DirSyncSpec[]} */
export const DIR_SYNC_SPECS = [
    {
        label: 'env',
        src: path.join(SRC_ROOT, 'env'),
        dest: path.join(DEST_ROOT, 'env'),
    },
    {
        label: 'images',
        src: path.join(SRC_ROOT, 'images'),
        dest: path.join(DEST_ROOT, 'images'),
    },
    {
        label: 'pdfs',
        src: path.join(SRC_ROOT, 'pdfs'),
        dest: path.join(DEST_ROOT, 'pdfs'),
    },
    {
        label: 'chart-bgm',
        src: path.join(SRC_ROOT, 'data', 'chart-bgm'),
        dest: path.join(DEST_ROOT, 'data', 'chart-bgm'),
    },
];

/**
 * 既定アバター GLB 名（WS-1 registry 参照）
 */
export const DEFAULT_META_SERVER_AVATAR_GLB = 'avatar_v_momj3una_13923a4c0b.glb';

/**
 * メイン同期処理（テスト・WS-8 runbook から再利用可）
 * @param {{ srcRoot?: string, destRoot?: string, dryRunMode?: boolean }} [options]
 * @returns {{ ok: boolean }}
 */
export function runMetaServerTenantAssetSync(options = {}) {
    const srcRoot = path.resolve(options.srcRoot ?? SRC_ROOT);
    const destRoot = path.resolve(options.destRoot ?? DEST_ROOT);
    const specs = DIR_SYNC_SPECS.map((s) => ({
        ...s,
        src: s.src.replace(SRC_ROOT, srcRoot),
        dest: s.dest.replace(DEST_ROOT, destRoot),
    }));

    let ok = true;
    for (const spec of specs) {
        if (!rsyncDirectory(spec.label, spec.src, spec.dest)) ok = false;
    }

    const avatarSrc = path.join(srcRoot, 'avatars', DEFAULT_META_SERVER_AVATAR_GLB);
    const avatarDest = path.join(destRoot, 'avatars', DEFAULT_META_SERVER_AVATAR_GLB);
    if (!syncAvatarGlb(avatarSrc, avatarDest)) ok = false;

    return { ok };
}

function main() {
    console.log(
        `[sync-meta-server-assets] tenant=${TENANT_ID} src=${SRC_ROOT} dest=${DEST_ROOT} dryRun=${dryRun}`,
    );
    console.log(
        '[sync-meta-server-assets] scope: env, images, pdfs, chart-bgm, default avatar GLB (models は WS-2、骨格 JSON は WS-1)',
    );
    const { ok } = runMetaServerTenantAssetSync();
    if (!ok) process.exit(1);
    console.log('[sync-meta-server-assets] done');
}

const isMain =
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
    main();
}
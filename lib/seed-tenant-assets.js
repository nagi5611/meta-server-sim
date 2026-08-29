// lib/seed-tenant-assets.js — metaverse-simple からテナント用モデルを初回コピー
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TENANT_DEFAULT_WORLDS } from './tenant-metaverse-defaults.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SIMPLE_MODELS_DIR = path.resolve(PROJECT_ROOT, '..', 'metaverse-simple', 'public', 'models');

/**
 * metaverse-simple の public/models をテナント models/ へコピー（未存在のみ）
 * @param {string} modelsDir tenants/P-01/models
 * @returns {number} コピーしたファイル数
 */
export function seedTenantModelsFromSimple(modelsDir) {
    if (!fs.existsSync(SIMPLE_MODELS_DIR)) {
        console.warn('[seed-tenant] metaverse-simple models not found:', SIMPLE_MODELS_DIR);
        return 0;
    }
    fs.mkdirSync(modelsDir, { recursive: true });
    let copied = 0;
    for (const name of fs.readdirSync(SIMPLE_MODELS_DIR)) {
        const src = path.join(SIMPLE_MODELS_DIR, name);
        if (!fs.statSync(src).isFile()) continue;
        const dest = path.join(modelsDir, name);
        if (fs.existsSync(dest)) continue;
        fs.copyFileSync(src, dest);
        copied += 1;
    }
    return copied;
}

/**
 * worlds.json が空または models 未設定なら既定ワールドを書き込む
 * @param {string} worldsPath
 * @returns {boolean} 書き込みしたか
 */
export function ensureTenantDefaultWorlds(worldsPath) {
    let shouldWrite = !fs.existsSync(worldsPath);
    if (!shouldWrite) {
        try {
            const raw = fs.readFileSync(worldsPath, 'utf8');
            const data = JSON.parse(raw);
            const lobby = data?.lobby;
            const emptyLobby = !lobby || !Array.isArray(lobby.models) || lobby.models.length === 0;
            shouldWrite = emptyLobby;
        } catch {
            shouldWrite = true;
        }
    }
    if (!shouldWrite) return false;
    fs.mkdirSync(path.dirname(worldsPath), { recursive: true });
    fs.writeFileSync(worldsPath, JSON.stringify(TENANT_DEFAULT_WORLDS, null, 2), 'utf8');
    return true;
}

/**
 * テナントの models / worlds を metaverse-simple 由来で初期化
 * @param {ReturnType<import('./tenant-storage-paths.js').getTenantStoragePaths>} paths
 */
export function seedTenantMetaverseAssets(paths) {
    const worldsWritten = ensureTenantDefaultWorlds(paths.WORLDS_PATH);
    const modelsCopied = seedTenantModelsFromSimple(paths.MODELS_DIR);
    if (worldsWritten || modelsCopied > 0) {
        console.log(
            `[seed-tenant] ${paths.TENANT_ROOT}: worlds=${worldsWritten ? 'written' : 'kept'}, models copied=${modelsCopied}`
        );
    }
}

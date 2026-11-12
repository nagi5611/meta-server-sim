// lib/tenant-avatar-registry.js — per-tenant avatars registry (_meta/avatars-registry.json)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const AVATAR_REGISTRY_REL_POSIX = '_meta/avatars-registry.json';
export const AVATAR_REQUIRED_MAP_KEYS = ['walk', 'jump', 'idle', 'run'];

/**
 * @param {string} tenantRoot
 * @returns {string}
 */
export function getTenantAvatarsDir(tenantRoot) {
    return path.join(tenantRoot, 'avatars');
}

function registryAbsPath(avatarsDir) {
    return path.join(avatarsDir, ...AVATAR_REGISTRY_REL_POSIX.split('/'));
}

function safeGlbFilename(v) {
    const bn = path.basename(String(v || '').trim());
    if (!bn.toLowerCase().endsWith('.glb')) return '';
    if (bn.includes('/') || bn.includes('\\') || bn.includes('..')) return '';
    return bn;
}

/**
 * @param {string} avatarsDir
 */
export function readAvatarRegistry(avatarsDir) {
    const abs = registryAbsPath(avatarsDir);
    try {
        if (!fs.existsSync(abs)) return null;
        const raw = fs.readFileSync(abs, 'utf8');
        const j = JSON.parse(raw);
        return j && typeof j === 'object' ? j : null;
    } catch {
        return null;
    }
}

/**
 * @param {string} avatarsDir
 * @param {object} registry
 */
export function writeAvatarRegistry(avatarsDir, registry) {
    const abs = registryAbsPath(avatarsDir);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(registry)}\n`, 'utf8');
}

/**
 * @param {unknown} v
 */
export function normalizeDisplayScale(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 1;
    return Math.min(10, Math.max(0.05, n));
}

/**
 * @param {object} entry
 */
export function hasCompleteAnimationMap(entry) {
    const clips = Array.isArray(entry?.animationClips) ? entry.animationClips : [];
    if (clips.length === 0) return false;
    const m = entry?.animationMap;
    if (!m || typeof m !== 'object') return false;
    for (const k of AVATAR_REQUIRED_MAP_KEYS) {
        const v = m[k];
        if (typeof v !== 'number' || !Number.isFinite(v)) return false;
        const i = Math.trunc(v);
        if (i < 0 || i >= clips.length) return false;
    }
    return true;
}

function avatarFileExists(avatarsDir, filename) {
    const fn = safeGlbFilename(filename);
    if (!fn) return false;
    return fs.existsSync(path.join(avatarsDir, fn));
}

/**
 * Single-clip fallback map (login until admin assigns clips)
 */
export function defaultSingleClipAnimationMap() {
    return { idle: 0, walk: 0, jump: 0, run: 0 };
}

export function defaultSingleClipList() {
    return [{ index: 0, name: 'Animation', label: 'Animation' }];
}

/** legacy-avatar.glb（P-01 既定アバター）の既知クリップ割当 */
export const LEGACY_AVATAR_ANIMATION_CLIPS = [
    { index: 0, name: 'Long_Breathe_and_Look_Around', label: 'idle' },
    { index: 1, name: 'Regular_Jump', label: 'jump' },
    { index: 2, name: 'Running', label: 'run' },
    { index: 3, name: 'Walking', label: 'walk' },
];

export const LEGACY_AVATAR_ANIMATION_MAP = {
    idle: 0,
    walk: 3,
    jump: 1,
    run: 2,
};

/**
 * @param {object} entry
 */
export function needsLegacyAvatarAnimationRepair(entry) {
    const fn = safeGlbFilename(entry?.glbFilename || '');
    if (fn !== 'legacy-avatar.glb') return false;
    const m = entry?.animationMap;
    if (!m || typeof m !== 'object') return true;
    return m.idle === 0 && m.walk === 0 && m.jump === 0 && m.run === 0;
}

/**
 * @param {object} entry
 */
export function applyLegacyAvatarAnimationRepair(entry) {
    entry.animationClips = LEGACY_AVATAR_ANIMATION_CLIPS.map((c) => ({ ...c }));
    entry.animationMap = { ...LEGACY_AVATAR_ANIMATION_MAP };
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 */
export async function migrateLegacyModelAvatar(tenant) {
    const legacy = path.join(tenant.paths.MODELS_DIR, 'avatar.glb');
    const avatarsDir = getTenantAvatarsDir(tenant.paths.TENANT_ROOT);
    if (!fs.existsSync(legacy)) return;
    const reg = readAvatarRegistry(avatarsDir);
    if (reg?.avatars?.length) return;
    if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
    const destName = 'legacy-avatar.glb';
    const dest = path.join(avatarsDir, destName);
    if (!fs.existsSync(dest)) fs.copyFileSync(legacy, dest);
    writeAvatarRegistry(avatarsDir, {
        schemaVersion: 1,
        registryVersion: 1,
        avatars: [
            {
                id: crypto.randomUUID(),
                glbFilename: destName,
                isDefault: true,
                displayScale: 1,
                animationClips: defaultSingleClipList(),
                animationMap: defaultSingleClipAnimationMap(),
            },
        ],
    });
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 */
export async function ensureAvatarRegistry(tenant) {
    const avatarsDir = getTenantAvatarsDir(tenant.paths.TENANT_ROOT);
    await migrateLegacyModelAvatar(tenant);
    if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

    let reg = readAvatarRegistry(avatarsDir);
    if (!reg || !Array.isArray(reg.avatars)) {
        reg = { schemaVersion: 1, registryVersion: 1, avatars: [] };
        writeAvatarRegistry(avatarsDir, reg);
    }

    let changed = false;
    let hasDefault = false;
    for (const a of reg.avatars) {
        a.id = String(a.id || '').trim() || crypto.randomUUID();
        a.glbFilename = safeGlbFilename(a.glbFilename || '');
        if (!a.glbFilename || !avatarFileExists(avatarsDir, a.glbFilename)) continue;
        a.displayScale = normalizeDisplayScale(a.displayScale);
        if (!Array.isArray(a.animationClips) || a.animationClips.length === 0) {
            a.animationClips = defaultSingleClipList();
            a.animationMap = defaultSingleClipAnimationMap();
            changed = true;
        }
        if (needsLegacyAvatarAnimationRepair(a)) {
            applyLegacyAvatarAnimationRepair(a);
            changed = true;
        }
        if (a.isDefault && !hasDefault) hasDefault = true;
        else if (a.isDefault && hasDefault) {
            a.isDefault = false;
            changed = true;
        }
    }
    reg.avatars = reg.avatars.filter((a) => a.glbFilename && avatarFileExists(avatarsDir, a.glbFilename));
    if (!hasDefault && reg.avatars.length > 0) {
        reg.avatars[0].isDefault = true;
        changed = true;
    }
    if (changed) {
        reg.registryVersion = Math.trunc(Number(reg.registryVersion) || 0) + 1;
        writeAvatarRegistry(avatarsDir, reg);
    }
    return reg;
}

/**
 * @param {object} reg
 * @param {string} id
 */
export function findAvatarById(reg, id) {
    const want = String(id || '').trim();
    if (!want || !Array.isArray(reg?.avatars)) return null;
    return reg.avatars.find((a) => String(a.id) === want) || null;
}

/**
 * @param {object} reg
 * @param {string} avatarsDir
 * @param {string} [requestedId]
 */
export function resolveAvatarId(reg, avatarsDir, requestedId) {
    const req = String(requestedId || '').trim();
    if (req) {
        const e = findAvatarById(reg, req);
        if (e && hasCompleteAnimationMap(e) && avatarFileExists(avatarsDir, e.glbFilename)) return e.id;
    }
    const d = Array.isArray(reg?.avatars) ? reg.avatars.find((a) => a.isDefault) : null;
    if (d && hasCompleteAnimationMap(d) && avatarFileExists(avatarsDir, d.glbFilename)) return d.id;
    const any = Array.isArray(reg?.avatars)
        ? reg.avatars.find((a) => hasCompleteAnimationMap(a) && avatarFileExists(avatarsDir, a.glbFilename))
        : null;
    return any ? any.id : null;
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {string} filename
 * @param {{ makeDefault?: boolean }} [opts]
 */
export async function registerUploadedAvatarGlb(tenant, filename, opts = {}) {
    const avatarsDir = getTenantAvatarsDir(tenant.paths.TENANT_ROOT);
    const fn = safeGlbFilename(filename);
    if (!fn || !avatarFileExists(avatarsDir, fn)) {
        throw new Error('avatar file missing');
    }
    const reg = await ensureAvatarRegistry(tenant);
    const entry = {
        id: crypto.randomUUID(),
        glbFilename: fn,
        isDefault: !!opts.makeDefault,
        displayScale: 1,
        animationClips: defaultSingleClipList(),
        animationMap: defaultSingleClipAnimationMap(),
    };
    if (entry.isDefault || !reg.avatars.some((a) => a.isDefault)) {
        for (const a of reg.avatars) a.isDefault = false;
        entry.isDefault = true;
    }
    reg.avatars.push(entry);
    reg.registryVersion = Math.trunc(Number(reg.registryVersion) || 0) + 1;
    writeAvatarRegistry(avatarsDir, reg);
    return { registry: reg, entry };
}

/**
 * @param {object} entry
 * @param {string} tenantId
 */
export function avatarPublicGlbPath(entry, tenantId) {
    const fn = safeGlbFilename(entry?.glbFilename || '');
    if (!fn) return null;
    return `avatars/${fn}`;
}

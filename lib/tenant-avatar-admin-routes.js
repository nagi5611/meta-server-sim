// lib/tenant-avatar-admin-routes.js — /admin/tenants/:tenantId/avatars
import express from 'express';
import {
    AVATAR_REQUIRED_MAP_KEYS,
    ensureAvatarRegistry,
    findAvatarById,
    hasCompleteAnimationMap,
    getTenantAvatarsDir,
    writeAvatarRegistry,
    normalizeDisplayScale,
} from './tenant-avatar-registry.js';

/**
 * @param {import('express').Express} app
 * @param {string} base e.g. /admin/tenants/:tenantId
 * @param {import('express').RequestHandler} attachTenant
 */
export function registerTenantAvatarAdminRoutes(app, base, attachTenant) {
    app.get(`${base}/avatars`, attachTenant, async (req, res) => {
        try {
            const reg = await ensureAvatarRegistry(req.tenant);
            res.json(reg);
        } catch (e) {
            console.error('[tenant-avatars] GET:', e);
            res.status(500).json({ error: 'avatar_registry_read_failed' });
        }
    });

    app.patch(`${base}/avatars/:avatarId`, attachTenant, express.json(), async (req, res) => {
        const avatarId = String(req.params.avatarId || '').trim();
        if (!avatarId) return res.status(400).json({ error: 'invalid_id' });
        try {
            const reg = await ensureAvatarRegistry(req.tenant);
            const reqVer = Number(req.body?.registryVersion);
            if (!Number.isFinite(reqVer) || Math.trunc(reqVer) !== Math.trunc(Number(reg.registryVersion) || 0)) {
                return res.status(409).json({
                    error: 'registry_version_conflict',
                    registryVersion: reg.registryVersion,
                });
            }
            const entry = findAvatarById(reg, avatarId);
            if (!entry) return res.status(404).json({ error: 'avatar_not_found' });

            if (req.body?.animationMap && typeof req.body.animationMap === 'object') {
                /** @type {Record<string, number>} */
                const map = {};
                for (const k of AVATAR_REQUIRED_MAP_KEYS) {
                    const v = req.body.animationMap[k];
                    if (typeof v === 'number' && Number.isFinite(v)) map[k] = Math.trunc(v);
                }
                entry.animationMap = map;
            }
            if (typeof req.body?.displayScale === 'number') {
                entry.displayScale = normalizeDisplayScale(req.body.displayScale);
            }
            if (req.body?.makeDefault === true) {
                for (const a of reg.avatars) a.isDefault = a.id === entry.id;
            }

            if (!hasCompleteAnimationMap(entry)) {
                return res.status(400).json({ error: 'incomplete_animation_map' });
            }

            reg.registryVersion = Math.trunc(Number(reg.registryVersion) || 0) + 1;
            const avatarsDir = getTenantAvatarsDir(req.tenant.paths.TENANT_ROOT);
            writeAvatarRegistry(avatarsDir, reg);
            res.json({ ok: true, registryVersion: reg.registryVersion, entry });
        } catch (e) {
            console.error('[tenant-avatars] PATCH:', e);
            res.status(500).json({ error: 'avatar_update_failed' });
        }
    });

    app.post(`${base}/avatars/:avatarId/default`, attachTenant, async (req, res) => {
        const avatarId = String(req.params.avatarId || '').trim();
        try {
            const reg = await ensureAvatarRegistry(req.tenant);
            const entry = findAvatarById(reg, avatarId);
            if (!entry) return res.status(404).json({ error: 'avatar_not_found' });
            for (const a of reg.avatars) a.isDefault = a.id === entry.id;
            reg.registryVersion = Math.trunc(Number(reg.registryVersion) || 0) + 1;
            writeAvatarRegistry(getTenantAvatarsDir(req.tenant.paths.TENANT_ROOT), reg);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: 'avatar_default_failed' });
        }
    });
}

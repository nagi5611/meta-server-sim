// lib/platform-share-join-routes.js — GET /api/share-join-url/:tenantId

import { createShareJoinRateLimit } from './http-rate-limit.js';
import { resolveShareJoinTarget } from './tenant-share-join.js';

const shareJoinRateLimit = createShareJoinRateLimit();

/**
 * @param {import('express').Express} app
 */
export function registerPlatformShareJoinRoutes(app) {
    app.get('/api/share-join-url/:tenantId', shareJoinRateLimit, (req, res) => {
        const resolved = resolveShareJoinTarget(req.params.tenantId);
        if (!resolved.ok) {
            return res.status(resolved.status).json({ error: resolved.error });
        }
        return res.json({
            ok: true,
            tenantId: resolved.tenantId,
            shareUrl: resolved.shareUrl,
            displayName: resolved.displayName,
            worldName: resolved.worldName,
            maintenance: resolved.maintenance,
        });
    });
}
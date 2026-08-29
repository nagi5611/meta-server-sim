// lib/tenant-error.js
/**
 * tenant ルーター内の async ハンドラを包み、例外を tenant 内 500 に限定する
 * @param {import('express').RequestHandler} handler
 * @returns {import('express').RequestHandler}
 */
export function tenantErrorBoundary(handler) {
    return async (req, res, next) => {
        try {
            await handler(req, res, next);
        } catch (err) {
            const tenantId = req.tenant?.id ?? 'unknown';
            console.error(`[tenant:${tenantId}] handler error:`, err);
            if (res.headersSent) return;
            res.status(500).json({
                error: 'tenant_internal_error',
                tenantId,
            });
        }
    };
}

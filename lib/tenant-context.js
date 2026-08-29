// lib/tenant-context.js
import { getTenant } from './tenant-registry.js';
import { isValidTenantId } from './tenant-id.js';

/**
 * tenant 解決ミドルウェア（/:tenantId 配下）
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function tenantResolver(req, res, next) {
    const tenantId = String(req.params.tenantId || '').trim();
    if (!isValidTenantId(tenantId)) {
        return res.status(404).json({ error: 'tenant_not_found' });
    }
    const tenant = getTenant(tenantId);
    if (!tenant) {
        return res.status(404).json({ error: 'tenant_not_found', tenantId });
    }
    req.tenant = tenant;
    next();
}

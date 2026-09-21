// lib/fds-smoke-delivery.js — FDS 煙バイナリのレンジ対応ストリーミング配信

import fs, { createReadStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createByteCountTransform, recordHttpTraffic } from './http-traffic-metrics.js';
import { isPathInsideTenantRoot } from './tenant-storage-paths.js';
import { tenantErrorBoundary } from './tenant-error.js';
import { guessContentType } from './r2/r2-keys.js';
import { isTenantMetaverseHttpAuthorized } from './tenant-metaverse-http-auth.js';

/** @typedef {'fds_smoke_main' | 'fds_smoke_bulk'} FdsSmokeTrafficChannel */

/**
 * Range ヘッダを解釈する
 * @param {string | undefined} rangeHeader
 * @param {number} size
 * @returns {{ start: number, end: number } | null}
 */
export function parseByteRangeHeader(rangeHeader, size) {
    if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
        return null;
    }
    const spec = rangeHeader.slice('bytes='.length).trim();
    const dash = spec.indexOf('-');
    if (dash < 0) {
        return null;
    }
    const startPart = spec.slice(0, dash).trim();
    const endPart = spec.slice(dash + 1).trim();

    let start = startPart ? parseInt(startPart, 10) : 0;
    let end = endPart ? parseInt(endPart, 10) : size - 1;

    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= size) {
        return null;
    }
    end = Math.min(end, size - 1);
    return { start, end };
}

/**
 * テナント simulations 配下のファイルをストリーム配信する
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {{ trafficChannel?: FdsSmokeTrafficChannel }} [options]
 * @returns {import('express').RequestHandler}
 */
export function createFdsSmokeStaticHandler(tenant, options = {}) {
    const trafficChannel = options.trafficChannel === 'fds_smoke_bulk' ? 'fds_smoke_bulk' : 'fds_smoke_main';

    return tenantErrorBoundary(async (req, res) => {
        if (!isTenantMetaverseHttpAuthorized(req)) {
            return res.status(401).json({ error: 'metaverse_access_required' });
        }

        const rel = req.path.replace(/^\/+/, '');
        if (!rel || rel.includes('..')) {
            return res.status(403).json({ error: 'forbidden_path' });
        }

        const filePath = path.join(tenant.paths.SIMULATIONS_DIR, rel);
        if (!isPathInsideTenantRoot(tenant.paths.TENANT_ROOT, filePath)) {
            return res.status(403).json({ error: 'forbidden_path' });
        }

        let stat;
        try {
            stat = await fs.promises.stat(filePath);
        } catch {
            return res.status(404).end();
        }
        if (!stat.isFile()) {
            return res.status(404).end();
        }

        const filename = rel.split('/').pop() ?? 'download';
        const contentType = guessContentType(filename);
        const size = stat.size;

        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'private, max-age=3600');

        if (req.method === 'HEAD') {
            res.setHeader('Content-Length', String(size));
            recordHttpTraffic(tenant.id, trafficChannel, size, { path: rel });
            return res.status(200).end();
        }

        const range = parseByteRangeHeader(req.headers.range, size);
        if (range) {
            const { start, end } = range;
            const chunkSize = end - start + 1;
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
            res.setHeader('Content-Length', String(chunkSize));
            const counter = createByteCountTransform();
            await pipeline(
                createReadStream(filePath, { start, end, highWaterMark: 1024 * 256 }),
                counter.stream,
                res,
            );
            recordHttpTraffic(tenant.id, trafficChannel, counter.getBytesSent(), { path: rel });
            return;
        }

        res.setHeader('Content-Length', String(size));
        const counter = createByteCountTransform();
        await pipeline(createReadStream(filePath, { highWaterMark: 1024 * 256 }), counter.stream, res);
        recordHttpTraffic(tenant.id, trafficChannel, counter.getBytesSent(), { path: rel });
    });
}

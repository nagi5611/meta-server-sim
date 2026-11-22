// lib/tenant-chart-routes.js — テナント譜面 API（公開 + 管理）

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { ensureWavSidecarForMp3Path, wavPathForMp3 } from './chart-bgm-transcode.js';
import { createChartScoreRateLimit } from './http-rate-limit.js';
import { tenantErrorBoundary } from './tenant-error.js';
import {
    chartExists,
    getChartRanking,
    isChartFeaturesEnabled,
    parseChartScoreUsername,
    parseChartScoreValue,
    readCharts,
    recordChartScore,
    writeCharts,
} from './tenant-charts.js';
import { normalizeChartRankingPart, usesChartRankingD1 } from './chart-ranking-store.js';

const uploadChartBgm = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 80 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const ok =
            ext === '.mp3' &&
            (file.mimetype === 'audio/mpeg' ||
                file.mimetype === 'audio/mp3' ||
                file.mimetype === 'application/octet-stream');
        cb(null, !!ok);
    },
});

const chartScoreIpLimiter = createChartScoreRateLimit();

/**
 * 譜面ヒット音用: partHitSounds の配列を 5 要素に揃える
 * @param {Record<string, unknown>} chart
 */
function ensurePartHitSoundsShape(chart) {
    if (!chart.partHitSounds || typeof chart.partHitSounds !== 'object') {
        chart.partHitSounds = {};
    }
    const ph = /** @type {Record<string, unknown>} */ (chart.partHitSounds);
    for (let p = 1; p <= 3; p++) {
        const k = String(p);
        if (!Array.isArray(ph[k])) {
            ph[k] = [];
        }
        const arr = /** @type {unknown[]} */ (ph[k]);
        while (arr.length < 5) {
            arr.push({});
        }
    }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function chartPublicGate(req, res, next) {
    if (isChartFeaturesEnabled(req.tenant)) return next();
    const p = String(req.path || '');
    if (req.method === 'GET' && (p === '/' || p === '')) {
        return res.json({});
    }
    if (req.method === 'GET' && /\/[^/]+\/ranking\/?$/.test(p)) {
        return res.json([]);
    }
    return res.status(503).json({
        error: '譜面機能はこのサーバーでは無効です',
        chartFeaturesEnabled: false,
    });
}

/**
 * @param {import('express').Router} router
 */
export function registerTenantChartPublicRoutes(router) {
    router.use('/api/charts', chartPublicGate);

    router.get(
        '/api/charts',
        tenantErrorBoundary((req, res) => {
            try {
                res.json(readCharts(req.tenant));
            } catch (err) {
                console.error(`[tenant:${req.tenant.id}] GET /api/charts:`, err);
                res.status(500).json({ error: 'Failed to read charts' });
            }
        })
    );

    router.post(
        '/api/charts/:id/score',
        chartScoreIpLimiter,
        tenantErrorBoundary(async (req, res) => {
            const id = String(req.params.id || '').trim();
            const charts = readCharts(req.tenant);
            if (!chartExists(charts, id)) {
                return res.status(404).json({ error: 'Chart not found' });
            }
            const parsedScore = parseChartScoreValue(req.body?.score);
            if (!parsedScore.ok) {
                return res.status(400).json({ error: parsedScore.error });
            }
            const parsedName = parseChartScoreUsername(req.body?.username);
            if (!parsedName.ok) {
                return res.status(400).json({ error: parsedName.error });
            }
            const part = normalizeChartRankingPart(req.body?.part);
            try {
                await recordChartScore(req.tenant, id, parsedName.value, parsedScore.value, part);
            } catch (err) {
                if (usesChartRankingD1()) {
                    console.error(`[tenant:${req.tenant.id}] chart score D1:`, err);
                    return res.status(503).json({
                        error: 'ランキングの保存に失敗しました（D1）',
                        storage: 'd1',
                    });
                }
                throw err;
            }
            res.json({ success: true });
        })
    );

    router.get(
        '/api/charts/:id/ranking',
        tenantErrorBoundary(async (req, res) => {
            const id = String(req.params.id || '').trim();
            const part = normalizeChartRankingPart(req.query?.part);
            try {
                const ranking = await getChartRanking(req.tenant, id, 10, part);
                res.json(ranking);
            } catch (err) {
                if (usesChartRankingD1()) {
                    console.error(`[tenant:${req.tenant.id}] chart ranking D1:`, err);
                    return res.status(503).json({
                        error: 'ランキングの取得に失敗しました（D1）',
                        storage: 'd1',
                    });
                }
                throw err;
            }
        })
    );
}

/**
 * @param {import('express').Express} app
 * @param {string} base
 * @param {import('express').RequestHandler} attachTenant
 */
export function registerTenantChartAdminRoutes(app, base, attachTenant) {
    const chartsDisabled = (_req, res) =>
        res.status(503).json({
            error: '譜面機能はこのサーバーでは無効です',
            chartFeaturesEnabled: false,
        });

    app.use(`${base}/charts`, attachTenant, (req, res, next) => {
        if (isChartFeaturesEnabled(req.tenant)) return next();
        return chartsDisabled(req, res);
    });

    app.get(`${base}/charts`, attachTenant, (req, res) => {
        try {
            res.json(readCharts(req.tenant));
        } catch (err) {
            console.error(`[tenant:${req.tenant.id}] GET admin/charts:`, err);
            res.status(500).json({ error: 'Failed to read charts' });
        }
    });

    app.post(`${base}/charts`, attachTenant, express.json(), (req, res) => {
        const { id, name, notes } = req.body || {};
        if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
            return res.status(400).json({ error: 'Invalid or missing id (alphanumeric, underscore, hyphen)' });
        }
        const charts = readCharts(req.tenant);
        if (charts[id]) {
            return res.status(400).json({ error: 'Chart id already exists' });
        }
        const notesArr = Array.isArray(notes) ? notes : [];
        const difficulty = req.body.difficulty != null ? req.body.difficulty : null;
        const tempo = req.body.tempo != null ? Number(req.body.tempo) : null;
        const endTime =
            req.body.endTime != null && req.body.endTime !== '' ? Number(req.body.endTime) : null;
        const measureBpms = req.body.measureBpms != null ? req.body.measureBpms : null;
        const partNames =
            req.body.partNames != null && typeof req.body.partNames === 'object' ? req.body.partNames : null;
        const notes2Arr = Array.isArray(req.body.notes2) ? req.body.notes2 : [];
        const notes3Arr = Array.isArray(req.body.notes3) ? req.body.notes3 : [];
        charts[id] = {
            id,
            name: name || id,
            notes: notesArr,
            notes2: notes2Arr,
            notes3: notes3Arr,
            partNames,
            difficulty,
            tempo,
            endTime,
            measureBpms,
        };
        try {
            writeCharts(req.tenant, charts);
            res.json({ success: true, chart: charts[id] });
        } catch (err) {
            console.error(`[tenant:${req.tenant.id}] POST admin/charts:`, err);
            res.status(500).json({ error: 'Failed to save charts' });
        }
    });

    app.put(`${base}/charts/:id`, attachTenant, express.json(), (req, res) => {
        const id = req.params.id;
        const charts = readCharts(req.tenant);
        if (!charts[id]) {
            return res.status(404).json({ error: 'Chart not found' });
        }
        const { name, notes, notes2, notes3, partNames, difficulty, tempo, endTime, measureBpms } =
            req.body || {};
        if (name !== undefined) charts[id].name = name;
        if (Array.isArray(notes)) charts[id].notes = notes;
        if (Array.isArray(notes2)) charts[id].notes2 = notes2;
        if (Array.isArray(notes3)) charts[id].notes3 = notes3;
        if (partNames !== undefined) charts[id].partNames = partNames;
        if (difficulty !== undefined) charts[id].difficulty = difficulty;
        if (tempo !== undefined) charts[id].tempo = tempo == null ? null : Number(tempo);
        if (endTime !== undefined) {
            charts[id].endTime = endTime == null || endTime === '' ? null : Number(endTime);
        }
        if (measureBpms !== undefined) {
            charts[id].measureBpms = measureBpms == null ? null : measureBpms;
        }
        try {
            writeCharts(req.tenant, charts);
            res.json({ success: true, chart: charts[id] });
        } catch (err) {
            console.error(`[tenant:${req.tenant.id}] PUT admin/charts:`, err);
            res.status(500).json({ error: 'Failed to save charts' });
        }
    });

    app.delete(`${base}/charts/:id`, attachTenant, (req, res) => {
        const id = req.params.id;
        const charts = readCharts(req.tenant);
        if (!charts[id]) {
            return res.status(404).json({ error: 'Chart not found' });
        }
        delete charts[id];
        const bgmDir = req.tenant.paths.CHART_BGM_DIR;
        const bgmPath = path.join(bgmDir, `${id}.mp3`);
        const bgmWav = wavPathForMp3(bgmPath);
        try {
            if (fs.existsSync(bgmPath)) fs.unlinkSync(bgmPath);
            if (fs.existsSync(bgmWav)) fs.unlinkSync(bgmWav);
        } catch (e) {
            console.warn(`[tenant:${req.tenant.id}] DELETE chart BGM:`, e?.message || e);
        }
        for (const p of [1, 2, 3]) {
            const partPath = path.join(bgmDir, `${id}-p${p}.mp3`);
            const partWav = wavPathForMp3(partPath);
            try {
                if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
                if (fs.existsSync(partWav)) fs.unlinkSync(partWav);
            } catch (e) {
                console.warn(`[tenant:${req.tenant.id}] DELETE chart part BGM:`, e?.message || e);
            }
        }
        const hitDir = path.join(bgmDir, id);
        try {
            if (fs.existsSync(hitDir)) {
                const st = fs.statSync(hitDir);
                if (st.isDirectory()) {
                    fs.rmSync(hitDir, { recursive: true, force: true });
                }
            }
        } catch (e) {
            console.warn(`[tenant:${req.tenant.id}] DELETE chart hit sounds:`, e?.message || e);
        }
        try {
            writeCharts(req.tenant, charts);
            res.json({ success: true });
        } catch (err) {
            console.error(`[tenant:${req.tenant.id}] DELETE admin/charts:`, err);
            res.status(500).json({ error: 'Failed to save charts' });
        }
    });

    app.post(
        `${base}/charts/:id/bgm`,
        attachTenant,
        (req, res, next) => uploadChartBgm.single('bgm')(req, res, next),
        async (req, res) => {
            const id = req.params.id;
            if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
                return res.status(400).json({ error: 'Invalid chart id' });
            }
            if (!req.file?.buffer) {
                return res.status(400).json({ error: 'MP3ファイルを選択してください（フィールド名: bgm）' });
            }
            const charts = readCharts(req.tenant);
            if (!charts[id]) {
                return res.status(404).json({ error: 'Chart not found' });
            }
            try {
                const mp3Path = path.join(req.tenant.paths.CHART_BGM_DIR, `${id}.mp3`);
                fs.mkdirSync(req.tenant.paths.CHART_BGM_DIR, { recursive: true });
                fs.writeFileSync(mp3Path, req.file.buffer);
                const okWav = await ensureWavSidecarForMp3Path(mp3Path);
                if (!okWav) console.warn(`[tenant:${req.tenant.id}] chart-bgm WAV sidecar failed for`, id);
                const orig = path.basename(req.file.originalname || 'bgm.mp3');
                charts[id].bgmVersion = Date.now();
                charts[id].bgmOriginalName = orig.length > 200 ? orig.slice(0, 200) : orig;
                writeCharts(req.tenant, charts);
                res.json({ success: true, chart: charts[id] });
            } catch (err) {
                console.error(`[tenant:${req.tenant.id}] POST chart bgm:`, err);
                res.status(500).json({ error: 'BGMの保存に失敗しました' });
            }
        }
    );

    app.delete(`${base}/charts/:id/bgm`, attachTenant, (req, res) => {
        const id = req.params.id;
        if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
            return res.status(400).json({ error: 'Invalid chart id' });
        }
        const charts = readCharts(req.tenant);
        if (!charts[id]) {
            return res.status(404).json({ error: 'Chart not found' });
        }
        try {
            const bgmPath = path.join(req.tenant.paths.CHART_BGM_DIR, `${id}.mp3`);
            const bgmWav = wavPathForMp3(bgmPath);
            if (fs.existsSync(bgmPath)) fs.unlinkSync(bgmPath);
            if (fs.existsSync(bgmWav)) fs.unlinkSync(bgmWav);
            delete charts[id].bgmVersion;
            delete charts[id].bgmOriginalName;
            writeCharts(req.tenant, charts);
            res.json({ success: true, chart: charts[id] });
        } catch (err) {
            console.error(`[tenant:${req.tenant.id}] DELETE chart bgm:`, err);
            res.status(500).json({ error: 'BGMの削除に失敗しました' });
        }
    });

    app.post(
        `${base}/charts/:id/bgm/part/:partNum`,
        attachTenant,
        (req, res, next) => uploadChartBgm.single('bgm')(req, res, next),
        async (req, res) => {
            const id = req.params.id;
            const partNum = Number(req.params.partNum);
            if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
                return res.status(400).json({ error: 'Invalid chart id' });
            }
            if (![1, 2, 3].includes(partNum)) {
                return res.status(400).json({ error: 'partNum must be 1, 2, or 3' });
            }
            if (!req.file?.buffer) {
                return res.status(400).json({ error: 'MP3ファイルを選択してください' });
            }
            const charts = readCharts(req.tenant);
            if (!charts[id]) {
                return res.status(404).json({ error: 'Chart not found' });
            }
            try {
                const partPath = path.join(req.tenant.paths.CHART_BGM_DIR, `${id}-p${partNum}.mp3`);
                fs.mkdirSync(req.tenant.paths.CHART_BGM_DIR, { recursive: true });
                fs.writeFileSync(partPath, req.file.buffer);
                await ensureWavSidecarForMp3Path(partPath);
                if (!charts[id].partBgm || typeof charts[id].partBgm !== 'object') {
                    charts[id].partBgm = {};
                }
                const pb = /** @type {Record<string, unknown>} */ (charts[id].partBgm);
                const orig = path.basename(req.file.originalname || 'bgm.mp3');
                pb[String(partNum)] = {
                    version: Date.now(),
                    originalName: orig.length > 200 ? orig.slice(0, 200) : orig,
                };
                writeCharts(req.tenant, charts);
                res.json({ success: true, chart: charts[id] });
            } catch (err) {
                console.error(`[tenant:${req.tenant.id}] POST chart part bgm:`, err);
                res.status(500).json({ error: 'パートBGMの保存に失敗しました' });
            }
        }
    );

    app.delete(`${base}/charts/:id/bgm/part/:partNum`, attachTenant, (req, res) => {
        const id = req.params.id;
        const partNum = Number(req.params.partNum);
        if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
            return res.status(400).json({ error: 'Invalid chart id' });
        }
        if (![1, 2, 3].includes(partNum)) {
            return res.status(400).json({ error: 'partNum must be 1, 2, or 3' });
        }
        const charts = readCharts(req.tenant);
        if (!charts[id]) {
            return res.status(404).json({ error: 'Chart not found' });
        }
        const partPath = path.join(req.tenant.paths.CHART_BGM_DIR, `${id}-p${partNum}.mp3`);
        const partWav = wavPathForMp3(partPath);
        try {
            if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
            if (fs.existsSync(partWav)) fs.unlinkSync(partWav);
            if (charts[id].partBgm && typeof charts[id].partBgm === 'object') {
                const pb = /** @type {Record<string, unknown>} */ (charts[id].partBgm);
                delete pb[String(partNum)];
                if (Object.keys(pb).length === 0) delete charts[id].partBgm;
            }
            writeCharts(req.tenant, charts);
            res.json({ success: true, chart: charts[id] });
        } catch (err) {
            console.error(`[tenant:${req.tenant.id}] DELETE chart part bgm:`, err);
            res.status(500).json({ error: 'パートBGMの削除に失敗しました' });
        }
    });

    app.post(
        `${base}/charts/:id/part-hit-sound`,
        attachTenant,
        (req, res, next) => uploadChartBgm.single('sound')(req, res, next),
        async (req, res) => {
            const id = req.params.id;
            if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
                return res.status(400).json({ error: 'Invalid chart id' });
            }
            if (!req.file?.buffer) {
                return res.status(400).json({ error: 'MP3を選択してください（フィールド名: sound）' });
            }
            const part = Number(req.body.part);
            const bucket = Number(req.body.bucket);
            const kind = String(req.body.kind || '').toLowerCase();
            if (
                ![1, 2, 3].includes(part) ||
                ![0, 1, 2, 3, 4].includes(bucket) ||
                (kind !== 'don' && kind !== 'ka')
            ) {
                return res.status(400).json({ error: 'part(1-3), bucket(0-4), kind(don|ka) が不正です' });
            }
            const charts = readCharts(req.tenant);
            if (!charts[id]) {
                return res.status(404).json({ error: 'Chart not found' });
            }
            try {
                const hitDir = path.join(req.tenant.paths.CHART_BGM_DIR, id, 'hits');
                fs.mkdirSync(hitDir, { recursive: true });
                const fname = `p${part}-b${bucket}-${kind}.mp3`;
                const mp3Path = path.join(hitDir, fname);
                fs.writeFileSync(mp3Path, req.file.buffer);
                await ensureWavSidecarForMp3Path(mp3Path);
                ensurePartHitSoundsShape(charts[id]);
                const ph = /** @type {Record<string, Array<Record<string, unknown>>>} */ (charts[id].partHitSounds);
                const arr = ph[String(part)];
                const cell = { ...(arr[bucket] || {}) };
                const ver = Date.now();
                const orig = path.basename(req.file.originalname || `${kind}.mp3`);
                const oname = orig.length > 200 ? orig.slice(0, 200) : orig;
                if (kind === 'don') {
                    cell.donVersion = ver;
                    cell.donOriginalName = oname;
                } else {
                    cell.kaVersion = ver;
                    cell.kaOriginalName = oname;
                }
                arr[bucket] = cell;
                writeCharts(req.tenant, charts);
                res.json({ success: true, chart: charts[id] });
            } catch (err) {
                console.error(`[tenant:${req.tenant.id}] POST part-hit-sound:`, err);
                res.status(500).json({ error: 'ヒット音の保存に失敗しました' });
            }
        }
    );

    app.delete(`${base}/charts/:id/part-hit-sound`, attachTenant, (req, res) => {
        const id = req.params.id;
        if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
            return res.status(400).json({ error: 'Invalid chart id' });
        }
        const part = Number(req.query.part);
        const bucket = Number(req.query.bucket);
        const kind = String(req.query.kind || '').toLowerCase();
        if (
            ![1, 2, 3].includes(part) ||
            ![0, 1, 2, 3, 4].includes(bucket) ||
            (kind !== 'don' && kind !== 'ka')
        ) {
            return res.status(400).json({ error: 'part(1-3), bucket(0-4), kind(don|ka) が不正です' });
        }
        const charts = readCharts(req.tenant);
        if (!charts[id]) {
            return res.status(404).json({ error: 'Chart not found' });
        }
        const fpath = path.join(
            req.tenant.paths.CHART_BGM_DIR,
            id,
            'hits',
            `p${part}-b${bucket}-${kind}.mp3`
        );
        const fwav = wavPathForMp3(fpath);
        try {
            if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
            if (fs.existsSync(fwav)) fs.unlinkSync(fwav);
        } catch (e) {
            console.warn(`[tenant:${req.tenant.id}] DELETE part-hit-sound file:`, e?.message || e);
        }
        try {
            ensurePartHitSoundsShape(charts[id]);
            const ph = /** @type {Record<string, Array<Record<string, unknown>>>} */ (charts[id].partHitSounds);
            const arr = ph[String(part)];
            const cell = { ...(arr[bucket] || {}) };
            if (kind === 'don') {
                delete cell.donVersion;
                delete cell.donOriginalName;
            } else {
                delete cell.kaVersion;
                delete cell.kaOriginalName;
            }
            arr[bucket] = cell;
            writeCharts(req.tenant, charts);
            res.json({ success: true, chart: charts[id] });
        } catch (err) {
            console.error(`[tenant:${req.tenant.id}] DELETE part-hit-sound:`, err);
            res.status(500).json({ error: 'ヒット音の削除に失敗しました' });
        }
    });
}
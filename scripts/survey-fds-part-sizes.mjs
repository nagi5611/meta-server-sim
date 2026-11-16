#!/usr/bin/env node
/**
 * FDS multipart パートの Content-Length を調査し転送レート候補を出力する
 *
 * Usage:
 *   FDS_SURVEY_BASE_URL='https://sim.mmh-virtual.jp/P-01' \
 *   FDS_SURVEY_SIM='fugaku-prod01' \
 *   FDS_SURVEY_AUTH_QUERY='mvsauth=...' \
 *   node scripts/survey-fds-part-sizes.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const base = (process.env.FDS_SURVEY_BASE_URL || 'https://sim.mmh-virtual.jp/P-01').replace(/\/$/, '');
const simId = process.env.FDS_SURVEY_SIM || 'fugaku-prod01';
const auth = process.env.FDS_SURVEY_AUTH_QUERY || '';

async function headSize(url) {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const len = res.headers.get('content-length');
    return {
        url,
        status: res.status,
        bytes: len != null ? Number(len) : null,
    };
}

async function main() {
    const manifestUrl = `${base}/simulations/${simId}/manifest.json${auth ? (auth.startsWith('?') ? auth : `?${auth}`) : ''}`;
    const manifestRes = await fetch(manifestUrl);
    if (!manifestRes.ok) {
        console.error('manifest failed', manifestRes.status, manifestUrl);
        process.exit(1);
    }
    const manifest = await manifestRes.json();
    const parts = manifest.parts || [];
    const sizes = [];
    for (const part of parts) {
        const q = auth ? (auth.includes('?') ? auth.replace(/^\?/, '&') : `&${auth}`) : '';
        const partUrl = `${base}/simulations/${simId}/${part.dataFile}`;
        const sep = partUrl.includes('?') ? '' : '';
        const h = await headSize(`${partUrl}${sep}${q}`);
        sizes.push({ id: part.id, file: part.dataFile, ...h });
    }
    const bytes = sizes.map((s) => s.bytes).filter((n) => n != null);
    const report = { base, simId, manifestUrl, parts: sizes, bytes };
    const out = process.env.FDS_SURVEY_OUT || '/opt/cursor/artifacts/fds-part-size-survey.json';
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
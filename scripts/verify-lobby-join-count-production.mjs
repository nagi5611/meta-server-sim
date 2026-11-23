#!/usr/bin/env node
/**
 * 本番: サインアップ → join-world → D1 join_events と集計ロジックを検証（管理画面認証不要）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJoinHistoriesByUserRefs } from '../metaverse-lobby/src/db-ops.js';

const LOBBY = (process.env.E2E_LOBBY_ORIGIN || 'https://m.mmh-virtual.jp').replace(/\/$/, '');
const ACC = process.env.CLOUDFLARE_ACCOUNT_API_ACCOUNT_ID;
const TOK = process.env.CLOUDFLARE_ACCOUNT_API_TOKEN;
const LOBBY_DB = process.env.LOBBY_OPS_D1_ID || '0af7ee2d-dc3a-46fe-9ab8-ff7cef7f6288';
const ARTIFACT = '/opt/cursor/artifacts/lobby-join-count-production-verify.json';

async function d1Query(sql) {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACC}/d1/database/${LOBBY_DB}/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOK}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sql }),
    });
    const body = await res.json();
    if (!body.success) throw new Error(`d1 query failed: ${JSON.stringify(body.errors)}`);
    return body.result[0].results;
}

function parseSetCookie(setCookie, name) {
    const m = String(setCookie || '').match(new RegExp(`${name}=([^;]+)`));
    return m?.[1] || '';
}

/** @param {string} token */
function jwtSub(token) {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const pad = part.length % 4 ? '='.repeat(4 - (part.length % 4)) : '';
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload?.sub ? String(payload.sub) : null;
}

async function main() {
    if (!ACC || !TOK) throw new Error('CLOUDFLARE_ACCOUNT_API_* required');
    const stamp = Date.now();
    const email = `joincount-e2e-${stamp}@mmh-virtual.jp`;
    const password = `JoinCount${stamp}!`;
    const displayName = `JoinE2E${String(stamp).slice(-6)}`;

    const signupRes = await fetch(`${LOBBY}/api/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, displayName }),
    });
    const signupBody = await signupRes.json().catch(() => ({}));
    if (!signupRes.ok) throw new Error(`signup failed: ${signupRes.status} ${JSON.stringify(signupBody)}`);

    const sessionCookie = parseSetCookie(signupRes.headers.get('set-cookie'), 'lobby_session');
    const userRef = jwtSub(sessionCookie);
    if (!sessionCookie || !userRef) throw new Error('signup missing session or userRef');

    const beforeRows = await d1Query(
        `SELECT COUNT(*) AS c FROM join_events WHERE user_ref = '${userRef.replace(/'/g, "''")}'`,
    );
    const before = Number(beforeRows[0]?.c || 0);

    const listRes = await fetch(`${LOBBY}/api/metaverses`, {
        headers: { cookie: `lobby_session=${sessionCookie}` },
    });
    const list = await listRes.json().catch(() => ({}));
    const world = (list.metaverses || []).find((w) => w.id);
    if (!world?.id) throw new Error('no world in catalog');

    const joinRes = await fetch(`${LOBBY}/api/join-world`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            cookie: `lobby_session=${sessionCookie}`,
        },
        body: JSON.stringify({ worldId: world.id, displayName }),
    });
    const joinBody = await joinRes.json().catch(() => ({}));
    if (!joinRes.ok) throw new Error(`join-world failed: ${joinRes.status} ${JSON.stringify(joinBody)}`);

    await new Promise((r) => setTimeout(r, 2000));
    const afterRows = await d1Query(
        `SELECT COUNT(*) AS c FROM join_events WHERE user_ref = '${userRef.replace(/'/g, "''")}'`,
    );
    const after = Number(afterRows[0]?.c || 0);

    const d1Events = await d1Query(
        `SELECT user_ref, world_id, joined_at, left_at, ok FROM join_events WHERE user_ref = '${userRef.replace(/'/g, "''")}' ORDER BY joined_at DESC`,
    );
    const d1Db = {
        prepare(sql) {
            const q = sql.replace(/\s+/g, ' ').trim();
            return {
                bind(...args) {
                    return {
                        async all() {
                            if (q.includes('FROM join_events') && q.includes('user_ref IN')) {
                                const refs = new Set(args.map(String));
                                const matches = d1Events.filter((r) => refs.has(String(r.user_ref)));
                                return { results: matches };
                            }
                            return { results: [] };
                        },
                    };
                },
            };
        },
    };
    const aggregated = await fetchJoinHistoriesByUserRefs(/** @type {D1Database} */ (d1Db), [userRef]);
    const history = aggregated.get(userRef) || [];

    const report = {
        ok: after > before && history.length === after,
        userRef,
        email,
        worldId: world.id,
        beforeJoinEvents: before,
        afterJoinEvents: after,
        aggregatedHistoryLength: history.length,
        deployedCheck: 'join_events recorded; aggregation matches count',
    };
    fs.mkdirSync(path.dirname(ARTIFACT), { recursive: true });
    fs.writeFileSync(ARTIFACT, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exit(1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
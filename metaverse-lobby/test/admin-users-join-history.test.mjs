import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { handleAdminApi } from '../src/admin-api.js';
import { signJwt } from '../src/jwt.js';
import { fetchJoinHistoriesByUserRefs, mapJoinEventToUserHistory } from '../src/db-ops.js';

const SECRET = '0123456789abcdef0123456789abcdef';

/** Minimal D1 mock for join_events history lookup. */
function createJoinEventsDb(rows) {
    return {
        prepare(sql) {
            const q = sql.replace(/\s+/g, ' ').trim();
            return {
                bind(...args) {
                    return {
                        async all() {
                            if (q.includes('FROM join_events') && q.includes('user_ref IN')) {
                                const refs = new Set(args.map(String));
                                const matches = rows
                                    .filter((r) => refs.has(String(r.user_ref)))
                                    .sort((a, b) => String(b.joined_at).localeCompare(String(a.joined_at)));
                                return { results: matches };
                            }
                            return { results: [] };
                        },
                    };
                },
            };
        },
    };
}

test('mapJoinEventToUserHistory computes duration minutes', () => {
    const h = mapJoinEventToUserHistory({
        world_id: 'world-a',
        joined_at: '2026-01-01T10:00:00.000Z',
        left_at: '2026-01-01T11:30:00.000Z',
        ok: 1,
    });
    assert.equal(h.world, 'world-a');
    assert.equal(h.dur, 90);
    assert.equal(h.ok, true);
});

test('fetchJoinHistoriesByUserRefs groups and caps per user', async () => {
    const db = createJoinEventsDb([
        { user_ref: 'student-1', world_id: 'w1', joined_at: '2026-01-02T00:00:00Z', left_at: null, ok: 1 },
        { user_ref: 'student-1', world_id: 'w2', joined_at: '2026-01-01T00:00:00Z', left_at: null, ok: 1 },
        { user_ref: 'teacher-3', world_id: 'w1', joined_at: '2026-01-03T00:00:00Z', left_at: null, ok: 1 },
    ]);
    const map = await fetchJoinHistoriesByUserRefs(/** @type {D1Database} */ (db), [
        'student-1',
        'teacher-3',
        'student-9',
    ]);
    assert.equal(map.get('student-1')?.length, 2);
    assert.equal(map.get('student-1')?.[0].world, 'w1');
    assert.equal(map.get('teacher-3')?.length, 1);
    assert.equal(map.has('student-9'), false);
});

async function startSimUsersStub() {
    const app = express();
    app.use(express.json());
    app.get('/service/users/students', (_req, res) =>
        res.json([{ kind: 'student', id: 1, username: 'alice', displayName: 'Alice', lobbyRole: 'user' }]),
    );
    app.get('/service/users/teachers', (_req, res) => res.json([]));
    app.get('/service/lobby/presence-index', (_req, res) => res.json({ entries: [] }));
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

test('GET /api/admin/users fills history from join_events', async () => {
    const sim = await startSimUsersStub();
    const db = createJoinEventsDb([
        {
            user_ref: 'student-1',
            world_id: 'P-01-world',
            joined_at: '2026-06-01T12:00:00.000Z',
            left_at: null,
            ok: 1,
        },
    ]);
    const env = {
        LOBBY_ADMIN_SESSION_SECRET: SECRET,
        LOBBY_SIM_ORIGIN: sim.origin,
        LOBBY_SIM_SERVICE_TOKEN: 'svc',
        LOBBY_DB: db,
    };
    const token = await signJwt({ sub: 'admin', role: 'admin', admin: true }, SECRET, 3600);
    try {
        const req = new Request('http://lobby.test/api/admin/users', {
            method: 'GET',
            headers: { cookie: `lobby_admin_session=${token}` },
        });
        const res = await handleAdminApi(req, env, /** @type {KVNamespace} */ ({}));
        assert.equal(res?.status, 200);
        const data = await res.json();
        assert.equal(data.users.length, 1);
        assert.equal(data.users[0].id, 'student-1');
        assert.equal(data.users[0].history.length, 1);
        assert.equal(data.users[0].history[0].world, 'P-01-world');
        assert.equal(data.users[0].last, '2026-06-01T12:00:00.000Z');
    } finally {
        sim.close();
    }
});
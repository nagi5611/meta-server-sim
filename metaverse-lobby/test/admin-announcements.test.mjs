import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleAdminApi } from '../src/admin-api.js';
import { signJwt } from '../src/jwt.js';

const SECRET = 'test-admin-session-secret';

/**
 * Minimal D1 mock for announcement create/list flows.
 */
function createTestDb() {
    /** @type {Map<string, Record<string, unknown>>} */
    const announcements = new Map();
  return {
    announcements,
    prepare(sql) {
      const q = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...args) {
          return {
            async run() {
              if (q.startsWith('INSERT INTO announcements')) {
                const [
                  id,
                  title,
                  body,
                  published,
                  sort_order,
                  created_at,
                  updated_at,
                  source_locale,
                  i18n_json,
                ] = args;
                announcements.set(String(id), {
                  id,
                  title,
                  body,
                  published,
                  sort_order,
                  created_at,
                  updated_at,
                  source_locale,
                  i18n_json,
                });
                return { meta: { changes: 1 } };
              }
              if (q.startsWith('INSERT INTO audit_log')) {
                return { meta: { changes: 1 } };
              }
              if (q.startsWith('UPDATE announcements SET')) {
                const id = args[args.length - 1];
                const prev = announcements.get(String(id));
                if (!prev) return { meta: { changes: 0 } };
                const [
                  title,
                  body,
                  published,
                  sort_order,
                  updated_at,
                  source_locale,
                  i18n_json,
                ] = args;
                announcements.set(String(id), {
                  ...prev,
                  title,
                  body,
                  published,
                  sort_order,
                  updated_at,
                  source_locale,
                  i18n_json,
                });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
            async all() {
              if (q.includes('FROM announcements')) {
                const limit = Number(args[0]) || 50;
                const rows = [...announcements.values()].sort((a, b) =>
                  String(b.created_at).localeCompare(String(a.created_at)),
                );
                return { results: rows.slice(0, limit) };
              }
              return { results: [] };
            },
            async first() {
              if (q.includes('FROM announcements WHERE id =')) {
                const id = args[0];
                return announcements.get(String(id)) || null;
              }
              return null;
            },
          };
        },
      };
    },
    async exec() {},
  };
}

/** @type {KVNamespace} */
const emptyKv = {
  async get() {
    return null;
  },
  async put() {},
  async delete() {},
  async list() {
    return { keys: [], list_complete: true, cursor: '' };
  },
};

test('POST /api/admin/announcements accepts title-only create', async () => {
  const db = createTestDb();
  const token = await signJwt({ sub: 'admin', role: 'admin', admin: true }, SECRET, 3600);
  const req = new Request('https://lobby.test/api/admin/announcements', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `lobby_admin_session=${token}`,
    },
    body: JSON.stringify({ title: 'メンテナンスのお知らせ', published: true, sourceLocale: 'ja' }),
  });
  const env = { LOBBY_DB: db, LOBBY_ADMIN_SESSION_SECRET: SECRET };
  const res = await handleAdminApi(req, env, emptyKv);
  assert.equal(res?.status, 201);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.announcement.title, 'メンテナンスのお知らせ');
  assert.equal(data.announcement.body, '');
  assert.equal(db.announcements.size, 1);
  const stored = [...db.announcements.values()][0];
  assert.equal(stored.body, '');
  assert.equal(stored.title, 'メンテナンスのお知らせ');
});

test('POST /api/admin/announcements rejects empty title', async () => {
  const db = createTestDb();
  const token = await signJwt({ sub: 'admin', role: 'admin', admin: true }, SECRET, 3600);
  const req = new Request('https://lobby.test/api/admin/announcements', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `lobby_admin_session=${token}`,
    },
    body: JSON.stringify({ title: '   ' }),
  });
  const env = { LOBBY_DB: db, LOBBY_ADMIN_SESSION_SECRET: SECRET };
  const res = await handleAdminApi(req, env, emptyKv);
  assert.equal(res?.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'title_required');
});

test('PUT /api/admin/announcements/:id can toggle published without title', async () => {
  const db = createTestDb();
  const id = 'ann-1';
  const now = new Date().toISOString();
  db.announcements.set(id, {
    id,
    title: 'Draft notice',
    body: '',
    published: 1,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    source_locale: 'ja',
    i18n_json: null,
  });
  const token = await signJwt({ sub: 'admin', role: 'admin', admin: true }, SECRET, 3600);
  const req = new Request(`https://lobby.test/api/admin/announcements/${id}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      cookie: `lobby_admin_session=${token}`,
    },
    body: JSON.stringify({ published: false }),
  });
  const env = { LOBBY_DB: db, LOBBY_ADMIN_SESSION_SECRET: SECRET };
  const res = await handleAdminApi(req, env, emptyKv);
  assert.equal(res?.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.announcement.published, false);
  assert.equal(data.announcement.title, 'Draft notice');
  assert.equal(db.announcements.get(id).published, 0);
});
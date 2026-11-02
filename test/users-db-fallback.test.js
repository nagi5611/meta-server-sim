// test/users-db-fallback.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('d1-config wrangler database id', () => {
    it('reads metaverse-sim id from wrangler.toml', async () => {
        const { getD1DatabaseId, getD1DatabaseName } = await import('../lib/d1/d1-config.js');
        assert.equal(getD1DatabaseName(), 'metaverse-sim');
        assert.equal(getD1DatabaseId(), 'd2102b3c-e357-479f-befc-a22cc0ddcd96');
    });
});

describe('users sqlite path', () => {
    it('defaults to data/users.db under repo root', async () => {
        const { getPlatformUsersDbPath } = await import('../db/users-path.js');
        assert.match(getPlatformUsersDbPath(), /data[/\\]users\.db$/);
    });
});

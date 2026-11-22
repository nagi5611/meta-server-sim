// test/tenant-share-join.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTenantRegistry } from '../lib/tenant-registry.js';
import {
    buildShareJoinPublicUrl,
    normalizeShareJoinTenantId,
    resolveShareJoinTarget,
} from '../lib/tenant-share-join.js';
import { saveLobbyCatalog } from '../lib/platform-lobby-catalog.js';

describe('tenant-share-join', () => {
    /** @type {string | undefined} */
    let prevLobbyUrl;

    beforeEach(() => {
        prevLobbyUrl = process.env.LOBBY_PUBLIC_URL;
        process.env.LOBBY_PUBLIC_URL = 'https://m.mmh-virtual.jp/';
        loadTenantRegistry();
        saveLobbyCatalog({
            metaverses: [
                {
                    id: 'tenant-p-01',
                    tenantId: 'P-01',
                    name: 'P-01 Demo',
                    entryUrl: 'https://sim.mmh-virtual.jp/P-01/',
                    audience: 'all',
                },
            ],
        });
    });

    afterEach(() => {
        if (prevLobbyUrl === undefined) delete process.env.LOBBY_PUBLIC_URL;
        else process.env.LOBBY_PUBLIC_URL = prevLobbyUrl;
        saveLobbyCatalog({ metaverses: [] });
    });

    it('buildShareJoinPublicUrl uses join/<tenantId>', () => {
        const url = buildShareJoinPublicUrl('P-01');
        assert.equal(url, 'https://m.mmh-virtual.jp/join/P-01');
    });

    it('rejects reserved join tenant id segment', () => {
        assert.equal(normalizeShareJoinTenantId('join'), null);
    });

    it('resolveShareJoinTarget finds P-01', () => {
        const r = resolveShareJoinTarget('P-01');
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.tenantId, 'P-01');
        assert.match(r.shareUrl, /\/join\/P-01$/);
    });

    it('unknown tenant returns not_found', () => {
        const r = resolveShareJoinTarget('no-such-tenant-xyz');
        assert.equal(r.ok, false);
        if (r.ok) return;
        assert.equal(r.error, 'not_found');
    });
});
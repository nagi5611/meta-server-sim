// test/fds-smoke-fetch-client.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fdsSmokeBulkOriginMatchesPage } from '../lib/fds-smoke-origin-match.js';

describe('fds-smoke-fetch-client', () => {
    it('fdsSmokeBulkOriginMatchesPage requires exact origin including scheme', () => {
        assert.equal(
            fdsSmokeBulkOriginMatchesPage('http://localhost:3003', 'http://localhost:3003'),
            true,
        );
        assert.equal(
            fdsSmokeBulkOriginMatchesPage('https://localhost:3003', 'http://localhost:3003'),
            false,
        );
        assert.equal(
            fdsSmokeBulkOriginMatchesPage('http://localhost:3012', 'http://localhost:3003'),
            false,
        );
    });
});

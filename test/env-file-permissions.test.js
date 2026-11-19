// test/env-file-permissions.test.js

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    DEFAULT_EXPECTED_ENV_OWNER,
    isEnvModeTooPermissive,
    readEnvFileStat,
    resolveExpectedEnvOwner,
    warnIfEnvFileInsecure,
} from '../lib/env-file-permissions.js';

const tempPaths = [];

afterEach(() => {
    for (const p of tempPaths.splice(0)) {
        try {
            fs.unlinkSync(p);
        } catch {
            /* ignore */
        }
    }
});

function touchEnv(mode) {
    const p = path.join(os.tmpdir(), `env-perm-test-${process.pid}-${Math.random().toString(36).slice(2)}.env`);
    tempPaths.push(p);
    fs.writeFileSync(p, 'SECRET=dummy\n');
    fs.chmodSync(p, mode);
    return p;
}

describe('isEnvModeTooPermissive', () => {
    it('flags 664 and allows 600', () => {
        assert.equal(isEnvModeTooPermissive(0o664), true);
        assert.equal(isEnvModeTooPermissive(0o600), false);
        assert.equal(isEnvModeTooPermissive(0o640), true);
    });
});

describe('readEnvFileStat', () => {
    it('reads mode from filesystem', () => {
        if (process.platform === 'win32') return;
        const p = touchEnv(0o600);
        const { mode } = readEnvFileStat(p);
        assert.equal(mode, 0o600);
    });
});

describe('resolveExpectedEnvOwner', () => {
    it('uses explicit option over env', () => {
        assert.equal(resolveExpectedEnvOwner({ expectedOwner: 'alice' }), 'alice');
    });

    it('defaults to nagi in production when unset', () => {
        const prev = process.env.NODE_ENV;
        const prevOwner = process.env.ENV_FILE_EXPECTED_OWNER;
        delete process.env.ENV_FILE_EXPECTED_OWNER;
        process.env.NODE_ENV = 'production';
        assert.equal(resolveExpectedEnvOwner(), DEFAULT_EXPECTED_ENV_OWNER);
        process.env.NODE_ENV = prev;
        if (prevOwner === undefined) delete process.env.ENV_FILE_EXPECTED_OWNER;
        else process.env.ENV_FILE_EXPECTED_OWNER = prevOwner;
    });
});

describe('warnIfEnvFileInsecure', () => {
    it('logs when mode is too permissive', () => {
        if (process.platform === 'win32') return;
        const p = touchEnv(0o664);
        const warnings = [];
        const orig = console.warn;
        console.warn = (...args) => warnings.push(args.join(' '));
        try {
            warnIfEnvFileInsecure({ envPath: p, expectedOwner: '' });
        } finally {
            console.warn = orig;
        }
        assert.ok(warnings.some((w) => w.includes('664') && w.includes('group/other')));
    });

    it('skips warning for mode 600', () => {
        if (process.platform === 'win32') return;
        const p = touchEnv(0o600);
        const warnings = [];
        const orig = console.warn;
        console.warn = (...args) => warnings.push(args.join(' '));
        try {
            warnIfEnvFileInsecure({ envPath: p, expectedOwner: '' });
        } finally {
            console.warn = orig;
        }
        assert.equal(warnings.length, 0);
    });
});
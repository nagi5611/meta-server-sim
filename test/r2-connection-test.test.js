// test/r2-connection-test.test.js — R2 接続ステータス

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    computeR2ConfigFingerprint,
    getR2ConnectionStatusForAdmin,
    _resetR2ConnectionStatusForTests,
} from '../lib/r2/r2-connection-test.js';
import {
    ENV_CONFIG_PATH,
    _resetEnvConfigCacheForTests,
} from '../lib/platform-env-config.js';

/** @type {string | undefined} */
let envConfigBackup = null;
/** @type {boolean} */
let hadEnvConfig = false;

function backupEnvConfigFile() {
    hadEnvConfig = fs.existsSync(ENV_CONFIG_PATH);
    envConfigBackup = hadEnvConfig ? fs.readFileSync(ENV_CONFIG_PATH, 'utf8') : undefined;
}

function restoreEnvConfigFile() {
    if (hadEnvConfig && envConfigBackup !== undefined) {
        fs.mkdirSync(path.dirname(ENV_CONFIG_PATH), { recursive: true });
        fs.writeFileSync(ENV_CONFIG_PATH, envConfigBackup, 'utf8');
    } else if (fs.existsSync(ENV_CONFIG_PATH)) {
        fs.unlinkSync(ENV_CONFIG_PATH);
    }
    _resetEnvConfigCacheForTests();
}

describe('r2-connection-test', () => {
    const originalStorage = process.env.STORAGE_BACKEND;

    beforeEach(() => {
        backupEnvConfigFile();
        if (fs.existsSync(ENV_CONFIG_PATH)) {
            fs.unlinkSync(ENV_CONFIG_PATH);
        }
        _resetEnvConfigCacheForTests();
        _resetR2ConnectionStatusForTests();
    });

    afterEach(() => {
        restoreEnvConfigFile();
        if (originalStorage === undefined) {
            delete process.env.STORAGE_BACKEND;
        } else {
            process.env.STORAGE_BACKEND = originalStorage;
        }
        delete process.env.R2_ACCOUNT_ID;
        delete process.env.R2_ACCESS_KEY_ID;
        delete process.env.R2_SECRET_ACCESS_KEY;
        _resetEnvConfigCacheForTests();
        _resetR2ConnectionStatusForTests();
    });

    it('getR2ConnectionStatusForAdmin reports local backend by default', () => {
        delete process.env.STORAGE_BACKEND;
        _resetEnvConfigCacheForTests();
        const status = getR2ConnectionStatusForAdmin();
        assert.equal(status.backend, 'local');
        assert.equal(status.connected, false);
    });

    it('getR2ConnectionStatusForAdmin detects missing credentials', () => {
        process.env.STORAGE_BACKEND = 'r2';
        _resetEnvConfigCacheForTests();
        const status = getR2ConnectionStatusForAdmin();
        assert.equal(status.backend, 'r2');
        assert.equal(status.configured, false);
        assert.ok(Array.isArray(status.missing));
    });

    it('computeR2ConfigFingerprint changes when account id changes', () => {
        process.env.STORAGE_BACKEND = 'r2';
        process.env.R2_ACCOUNT_ID = 'account-a';
        process.env.R2_ACCESS_KEY_ID = 'key-a';
        process.env.R2_SECRET_ACCESS_KEY = 'secret-a';
        _resetEnvConfigCacheForTests();
        const a = computeR2ConfigFingerprint();
        process.env.R2_ACCOUNT_ID = 'account-b';
        _resetEnvConfigCacheForTests();
        const b = computeR2ConfigFingerprint();
        assert.notEqual(a, b);
    });
});

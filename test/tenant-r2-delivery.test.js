// test/tenant-r2-delivery.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    ENV_CONFIG_PATH,
    _resetEnvConfigCacheForTests,
} from '../lib/platform-env-config.js';
import {
    isR2CredentialsConfigured,
} from '../lib/r2/storage-backend.js';
import {
    isR2StorageActive,
    shouldRedirectTenantAssetsToR2,
} from '../lib/r2/tenant-r2-delivery.js';

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

describe('tenant-r2-delivery', () => {
    it('shouldRedirectTenantAssetsToR2 is false for browser-safe proxy delivery', () => {
        assert.equal(shouldRedirectTenantAssetsToR2(), false);
    });

    describe('isR2StorageActive', () => {
        const originalStorage = process.env.STORAGE_BACKEND;

        beforeEach(() => {
            backupEnvConfigFile();
            if (fs.existsSync(ENV_CONFIG_PATH)) {
                fs.unlinkSync(ENV_CONFIG_PATH);
            }
            _resetEnvConfigCacheForTests();
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
        });

        it('is false when STORAGE_BACKEND=r2 but credentials are missing', () => {
            process.env.STORAGE_BACKEND = 'r2';
            _resetEnvConfigCacheForTests();
            assert.equal(isR2CredentialsConfigured(), false);
            assert.equal(isR2StorageActive(), false);
        });

        it('is true when STORAGE_BACKEND=r2 and credentials are set', () => {
            process.env.STORAGE_BACKEND = 'r2';
            process.env.R2_ACCOUNT_ID = 'test-account';
            process.env.R2_ACCESS_KEY_ID = 'test-key';
            process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
            _resetEnvConfigCacheForTests();
            assert.equal(isR2CredentialsConfigured(), true);
            assert.equal(isR2StorageActive(), true);
        });
    });
});

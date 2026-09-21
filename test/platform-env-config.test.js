// test/platform-env-config.test.js — 環境変数統合のユニットテスト

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ENV_CONFIG_PATH,
    getEnvConfigForAdmin,
    getPlatformEnv,
    getPlatformEnvSource,
    isEnvLockedByDotEnv,
    shouldMaskEnvValueForAdmin,
    saveEnvConfigFromAdmin,
    _resetEnvConfigCacheForTests,
} from '../lib/platform-env-config.js';
import { getRestartRequiredKeys } from '../lib/platform-env-schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

describe('platform-env-config', () => {
    beforeEach(() => {
        backupEnvConfigFile();
        _resetEnvConfigCacheForTests();
    });

    afterEach(() => {
        restoreEnvConfigFile();
        delete process.env.PLATFORM_ENV_TEST_KEY;
        delete process.env.R2_SECRET_ACCESS_KEY;
        delete process.env.ADMIN_ENV_SECRET_LEVEL;
        delete process.env.ADMIN_ENV_MASK_KEYS;
        delete process.env.ENV_CONFIG_ENCRYPTION_KEY;
        _resetEnvConfigCacheForTests();
    });

    it('getPlatformEnv uses default when unset', () => {
        assert.equal(getPlatformEnv('PORT'), '3002');
        assert.equal(getPlatformEnvSource('PORT'), 'default');
    });

    it('getPlatformEnv prefers .env over file', () => {
        fs.mkdirSync(path.dirname(ENV_CONFIG_PATH), { recursive: true });
        fs.writeFileSync(ENV_CONFIG_PATH, JSON.stringify({ R2_BUCKET_NAME: 'from-file' }), 'utf8');
        _resetEnvConfigCacheForTests();
        process.env.R2_BUCKET_NAME = 'from-env';
        assert.equal(getPlatformEnv('R2_BUCKET_NAME'), 'from-env');
        assert.equal(isEnvLockedByDotEnv('R2_BUCKET_NAME'), true);
        assert.equal(getPlatformEnvSource('R2_BUCKET_NAME'), 'env');
    });

    it('getPlatformEnv reads file when .env is empty', () => {
        fs.mkdirSync(path.dirname(ENV_CONFIG_PATH), { recursive: true });
        fs.writeFileSync(ENV_CONFIG_PATH, JSON.stringify({ R2_KEY_PREFIX: 'panel-prefix' }), 'utf8');
        _resetEnvConfigCacheForTests();
        delete process.env.R2_KEY_PREFIX;
        assert.equal(getPlatformEnv('R2_KEY_PREFIX'), 'panel-prefix');
        assert.equal(getPlatformEnvSource('R2_KEY_PREFIX'), 'file');
    });

    it('isEnvLockedByDotEnv is false for empty env values', () => {
        process.env.R2_ACCOUNT_ID = '   ';
        assert.equal(isEnvLockedByDotEnv('R2_ACCOUNT_ID'), false);
    });

    it('shouldMaskEnvValueForAdmin level 1 masks listed keys only', () => {
        process.env.ADMIN_ENV_SECRET_LEVEL = '1';
        process.env.ADMIN_ENV_MASK_KEYS = 'R2_SECRET_ACCESS_KEY,ADMIN_PASSWORD';
        assert.equal(shouldMaskEnvValueForAdmin('R2_SECRET_ACCESS_KEY', true), true);
        assert.equal(shouldMaskEnvValueForAdmin('R2_BUCKET_NAME', true), false);
        assert.equal(shouldMaskEnvValueForAdmin('R2_SECRET_ACCESS_KEY', false), false);
    });

    it('shouldMaskEnvValueForAdmin level 2 masks all file values', () => {
        process.env.ADMIN_ENV_SECRET_LEVEL = '2';
        assert.equal(shouldMaskEnvValueForAdmin('R2_BUCKET_NAME', true), true);
        assert.equal(shouldMaskEnvValueForAdmin('PORT', true), true);
    });

    it('saveEnvConfigFromAdmin reports restart-required keys', () => {
        delete process.env.PORT;
        delete process.env.HOST;
        const result = saveEnvConfigFromAdmin({ PORT: '4000', R2_KEY_PREFIX: 'test' });
        assert.equal(result.ok, true);
        assert.ok(result.requiresRestart.includes('PORT'));
        assert.ok(!result.requiresRestart.includes('R2_KEY_PREFIX'));
    });

    it('saveEnvConfigFromAdmin rejects locked keys', () => {
        process.env.PORT = '3002';
        const result = saveEnvConfigFromAdmin({ PORT: '4000' });
        assert.equal(result.ok, false);
        assert.ok(Array.isArray(result.errors));
    });

    it('getRestartRequiredKeys includes PORT and excludes METAVERSE_PORTAL_LINKS', () => {
        const keys = getRestartRequiredKeys();
        assert.ok(keys.has('PORT'));
        assert.ok(!keys.has('METAVERSE_PORTAL_LINKS'));
    });

    it('load strips secret keys from env-config.json on disk', () => {
        fs.mkdirSync(path.dirname(ENV_CONFIG_PATH), { recursive: true });
        fs.writeFileSync(
            ENV_CONFIG_PATH,
            JSON.stringify({
                R2_KEY_PREFIX: 'keep-me',
                R2_SECRET_ACCESS_KEY: 'must-not-persist',
                R2_ACCESS_KEY_ID: 'also-strip',
            }),
            'utf8'
        );
        _resetEnvConfigCacheForTests();
        delete process.env.R2_SECRET_ACCESS_KEY;
        delete process.env.R2_ACCESS_KEY_ID;
        delete process.env.R2_KEY_PREFIX;

        assert.equal(getPlatformEnv('R2_KEY_PREFIX'), 'keep-me');
        assert.equal(getPlatformEnv('R2_SECRET_ACCESS_KEY'), undefined);

        const onDisk = JSON.parse(fs.readFileSync(ENV_CONFIG_PATH, 'utf8'));
        assert.equal(onDisk.R2_KEY_PREFIX, 'keep-me');
        assert.equal(onDisk.R2_SECRET_ACCESS_KEY, undefined);
        assert.equal(onDisk.R2_ACCESS_KEY_ID, undefined);
    });

    it('saveEnvConfigFromAdmin rejects persisting secret keys', () => {
        const result = saveEnvConfigFromAdmin({ R2_SECRET_ACCESS_KEY: 'new-secret' });
        assert.equal(result.ok, false);
        assert.ok(result.errors.some((e) => e.includes('R2_SECRET_ACCESS_KEY')));
    });

    it('getEnvConfigForAdmin marks secrets as envOnly without effectiveValue', () => {
        process.env.R2_SECRET_ACCESS_KEY = 'from-env-only';
        _resetEnvConfigCacheForTests();
        const view = getEnvConfigForAdmin();
        const secretItem = view.groups
            .flatMap((g) => g.items)
            .find((i) => i.key === 'R2_SECRET_ACCESS_KEY');
        assert.ok(secretItem);
        assert.equal(secretItem.envOnly, true);
        assert.equal(secretItem.effectiveValue, '');
        assert.equal(secretItem.configured, true);
    });

    it('optional encryption at rest when ENV_CONFIG_ENCRYPTION_KEY is set', () => {
        process.env.ENV_CONFIG_ENCRYPTION_KEY = 'test-encryption-key-material';
        delete process.env.R2_KEY_PREFIX;
        const saved = saveEnvConfigFromAdmin({ R2_KEY_PREFIX: 'encrypted-prefix' });
        assert.equal(saved.ok, true);
        const raw = fs.readFileSync(ENV_CONFIG_PATH, 'utf8');
        assert.ok(raw.startsWith('v1:'));
        _resetEnvConfigCacheForTests();
        assert.equal(getPlatformEnv('R2_KEY_PREFIX'), 'encrypted-prefix');
    });
});

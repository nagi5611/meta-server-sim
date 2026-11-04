// test/fleet-addon-env.test.js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isFleetAddonEnvKey } from '../lib/platform-fleet-registry.js';
import {
    pickAddonEnvKeys,
    readEnvFile,
    writeAddonEnvFileUpdates,
} from '../lib/platform-fleet-env.js';

describe('fleet addon env keys', () => {
    it('isFleetAddonEnvKey accepts ADDON_ and TENANT_*_ADDON_', () => {
        expect(isFleetAddonEnvKey('ADDON_TIME_MACHINE_MOUNTS')).toBe(true);
        expect(isFleetAddonEnvKey('TENANT_P_01_ADDON_TIME_MACHINE_FOO')).toBe(true);
        expect(isFleetAddonEnvKey('PORT')).toBe(false);
        expect(isFleetAddonEnvKey('TENANT_SOCKET_SECRET')).toBe(false);
    });

    it('writeAddonEnvFileUpdates writes only addon keys', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-addon-'));
        const envPath = path.join(dir, '.env');
        fs.writeFileSync(envPath, 'PORT=3002\n', 'utf8');
        const bad = writeAddonEnvFileUpdates(envPath, { PORT: '9999' });
        expect(bad.ok).toBe(false);
        const ok = writeAddonEnvFileUpdates(envPath, {
            ADDON_TIME_MACHINE_MOUNTS: 'hdd-01:/mnt/hdd-01',
        });
        expect(ok.ok).toBe(true);
        const all = readEnvFile(envPath);
        expect(all.PORT).toBe('3002');
        expect(all.ADDON_TIME_MACHINE_MOUNTS).toBe('hdd-01:/mnt/hdd-01');
        const picked = pickAddonEnvKeys(all);
        expect(picked.ADDON_TIME_MACHINE_MOUNTS).toBe('hdd-01:/mnt/hdd-01');
        expect(picked.PORT).toBeUndefined();
        fs.rmSync(dir, { recursive: true, force: true });
    });
});

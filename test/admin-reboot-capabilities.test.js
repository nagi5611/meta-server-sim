// test/admin-reboot-capabilities.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminRebootMain = path.join(__dirname, '../addons/admin-reboot/server/main.js');

describe('admin-reboot safety', () => {
    it('server module never invokes systemctl or restart.sh', () => {
        const src = fs.readFileSync(adminRebootMain, 'utf8');
        assert.equal(/spawn\s*\(\s*['"]systemctl['"]/.test(src), false);
        assert.equal(/spawn\s*\([^)]*restart\.sh/.test(src), false);
        assert.ok(src.includes('host_restart_disabled'));
    });
});
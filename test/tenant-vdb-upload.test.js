// test/tenant-vdb-upload.test.js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    isValidVdbOrNvdbBuffer,
    listTenantVdbFiles,
    saveTenantVdbFile,
    sanitizeVdbFilename,
} from '../lib/tenant-vdb-upload.js';

describe('tenant-vdb-upload', () => {
    it('accepts NanoVDB magic header', () => {
        const buf = Buffer.alloc(32);
        buf.writeBigUInt64LE(0x304244566f6e614en, 0);
        assert.equal(isValidVdbOrNvdbBuffer(buf), true);
    });

    it('rejects random bytes', () => {
        assert.equal(isValidVdbOrNvdbBuffer(Buffer.from('hello')), false);
    });

    it('sanitizes filename extension', () => {
        assert.equal(sanitizeVdbFilename('my cloud.nvdb'), 'my_cloud.nvdb');
    });

    it('saves and lists under tenant vdbs dir', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vdb-upload-'));
        const vdbDir = path.join(root, 'data', 'vdbs');
        const buf = Buffer.alloc(64);
        buf.writeBigUInt64LE(0x304244566f6e614en, 0);
        const saved = saveTenantVdbFile(root, vdbDir, 'test.nvdb', buf);
        assert.equal(saved.file, 'vdbs/test.nvdb');
        const list = listTenantVdbFiles(vdbDir);
        assert.equal(list.length, 1);
        assert.equal(list[0].name, 'test.nvdb');
    });
});
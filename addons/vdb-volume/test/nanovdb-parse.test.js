// addons/vdb-volume/test/nanovdb-parse.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseNanoVDB, isNanoVDB } from '../client/vendor/three-vdb-loader/NanoVDBParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.join(__dirname, '..', 'samples', 'smoke-0016.nvdb');

test('smoke-0016.nvdb is NanoVDB', () => {
    const buf = fs.readFileSync(SAMPLE);
    assert.equal(isNanoVDB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), true);
});

test('parseNanoVDB returns density grid with voxels', () => {
    const buf = fs.readFileSync(SAMPLE);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const grids = parseNanoVDB(ab, { gridNames: ['density'] });
    assert.ok(grids.length >= 1);
    const grid = grids[0];
    assert.equal(grid.name, 'density');
    assert.ok(grid.width > 0 && grid.height > 0 && grid.depth > 0);
    assert.ok(grid.data && grid.data.length > 0);
});
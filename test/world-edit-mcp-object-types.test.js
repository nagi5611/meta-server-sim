// test/world-edit-mcp-object-types.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildModelEntryFromType,
    vec3Near,
} from '../lib/world-edit-mcp-object-types.js';

describe('world-edit-mcp-object-types', () => {
    it('builds model entry', () => {
        const e = buildModelEntryFromType('model', {
            path: 'models/foo.glb',
            position: { x: 1, y: 2, z: 3 },
        });
        assert.equal(e.path, 'models/foo.glb');
        assert.deepEqual(e.position, { x: 1, y: 2, z: 3 });
    });

    it('vec3Near within epsilon', () => {
        assert.equal(vec3Near({ x: 1, y: 2, z: 3 }, { x: 1.0005, y: 2, z: 3 }, 0.001), true);
        assert.equal(vec3Near({ x: 1, y: 2, z: 3 }, { x: 1.01, y: 2, z: 3 }, 0.001), false);
    });
});
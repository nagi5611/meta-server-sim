import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    defaultSingleClipAnimationMap,
    hasCompleteAnimationMap,
    writeAvatarRegistry,
    readAvatarRegistry,
    resolveAvatarId,
} from '../lib/tenant-avatar-registry.js';

describe('tenant-avatar-registry', () => {
    it('hasCompleteAnimationMap accepts default single-clip map', () => {
        const entry = {
            animationClips: [{ index: 0, name: 'Animation' }],
            animationMap: defaultSingleClipAnimationMap(),
        };
        assert.equal(hasCompleteAnimationMap(entry), true);
    });

    it('resolveAvatarId picks default', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatars-'));
        const id = 'a1111111-1111-4111-8111-111111111111';
        writeAvatarRegistry(dir, {
            schemaVersion: 1,
            registryVersion: 1,
            avatars: [
                {
                    id,
                    glbFilename: 'char.glb',
                    isDefault: true,
                    animationClips: [{ index: 0, name: 'Animation' }],
                    animationMap: defaultSingleClipAnimationMap(),
                },
            ],
        });
        fs.writeFileSync(path.join(dir, 'char.glb'), 'glb');
        const reg = readAvatarRegistry(dir);
        assert.equal(resolveAvatarId(reg, dir, ''), id);
    });
});

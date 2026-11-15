import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    defaultSingleClipAnimationMap,
    hasCompleteAnimationMap,
    needsLegacyAvatarAnimationRepair,
    applyLegacyAvatarAnimationRepair,
    LEGACY_AVATAR_ANIMATION_MAP,
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

    it('needsLegacyAvatarAnimationRepair detects all-zero map on legacy-avatar.glb', () => {
        assert.equal(
            needsLegacyAvatarAnimationRepair({
                glbFilename: 'legacy-avatar.glb',
                animationMap: defaultSingleClipAnimationMap(),
            }),
            true,
        );
        assert.equal(
            needsLegacyAvatarAnimationRepair({
                glbFilename: 'legacy-avatar.glb',
                animationMap: LEGACY_AVATAR_ANIMATION_MAP,
            }),
            false,
        );
    });

    it('applyLegacyAvatarAnimationRepair assigns walk/run/jump indices', () => {
        const entry = { glbFilename: 'legacy-avatar.glb', animationMap: defaultSingleClipAnimationMap() };
        applyLegacyAvatarAnimationRepair(entry);
        assert.deepEqual(entry.animationMap, LEGACY_AVATAR_ANIMATION_MAP);
        assert.equal(entry.animationClips.length, 4);
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

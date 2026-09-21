// test/fds-smoke-control-panel.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    fdsSmokePanelUvHitsButton,
    isFdsSmokePanelButton,
    normalizeFdsSmokePanelEntry,
    PANEL_PLAY_BUTTON_RECT,
} from '../public/js/fds/fds-smoke-control-panel.js';

describe('fds-smoke-control-panel', () => {
    it('isFdsSmokePanelButton detects panel object', () => {
        assert.equal(isFdsSmokePanelButton({ panel: {} }), true);
        assert.equal(isFdsSmokePanelButton({ panel: false }), false);
        assert.equal(isFdsSmokePanelButton({}), false);
    });

    it('normalizeFdsSmokePanelEntry fills defaults', () => {
        const entry = normalizeFdsSmokePanelEntry({
            fdsSmokeId: 'smoke-a',
            position: { x: 1, y: 2, z: 3 },
            panel: { rotation: { x: 0, y: 90, z: 0 } },
            label: '再生',
        });
        assert.ok(entry);
        assert.equal(entry.fdsSmokeId, 'smoke-a');
        assert.equal(entry.rotation.y, 90);
        assert.equal(entry.scale.x, 1.4);
        assert.equal(entry.maxDistance, 18);
    });

    it('fdsSmokePanelUvHitsButton respects button rect', () => {
        const cx = PANEL_PLAY_BUTTON_RECT.x + PANEL_PLAY_BUTTON_RECT.w / 2;
        const cy = PANEL_PLAY_BUTTON_RECT.y + PANEL_PLAY_BUTTON_RECT.h / 2;
        assert.equal(fdsSmokePanelUvHitsButton({ x: cx, y: cy }), true);
        assert.equal(fdsSmokePanelUvHitsButton({ x: 0.01, y: 0.01 }), false);
    });
});

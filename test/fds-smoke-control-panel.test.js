// test/fds-smoke-control-panel.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    ensureFdsSmokeButtonPanel,
    isFdsSmokePanelButton,
} from '../public/js/fds/fds-smoke-control-panel.js';

describe('fds-smoke-control-panel', () => {
    it('ensureFdsSmokeButtonPanel adds default panel', () => {
        const out = ensureFdsSmokeButtonPanel({ id: 'b1', fdsSmokeId: 's1' });
        assert.equal(isFdsSmokePanelButton(out), true);
        assert.equal(out.panel.maxDistance, 18);
    });

    it('ensureFdsSmokeButtonPanel respects panel: false', () => {
        const out = ensureFdsSmokeButtonPanel({ panel: false, fdsSmokeId: 's1' });
        assert.equal(isFdsSmokePanelButton(out), false);
    });
});

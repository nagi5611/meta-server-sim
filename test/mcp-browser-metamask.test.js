import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    classifyMetamaskUi,
    classifyPageUrl,
    getBrowserMetamaskConfig,
} from '../lib/mcp-browser-metamask.js';

describe('mcp-browser-metamask helpers', () => {
    it('classifyPageUrl detects MetaMask notification', () => {
        assert.equal(
            classifyPageUrl('chrome-extension://abc/home.html#notification'),
            'metamask-extension',
        );
        assert.equal(
            classifyPageUrl('chrome-extension://abc/notification.html'),
            'metamask-notification',
        );
        assert.equal(classifyPageUrl('http://127.0.0.1:3003/P-01/'), 'app');
    });

    it('classifyMetamaskUi detects connect / signature / network', () => {
        assert.equal(
            classifyMetamaskUi('Site requested your accounts', ['Cancel', 'Connect']),
            'connect',
        );
        assert.equal(
            classifyMetamaskUi('Signature request', ['Reject', 'Sign']),
            'signature',
        );
        assert.equal(
            classifyMetamaskUi('Allow this site to switch the network?', ['Switch network']),
            'network',
        );
    });

    it('getBrowserMetamaskConfig defaults', () => {
        const prev = process.env.BROWSER_METAMASK_BASE_URL;
        delete process.env.BROWSER_METAMASK_BASE_URL;
        const cfg = getBrowserMetamaskConfig();
        assert.equal(cfg.defaultBaseUrl, 'http://127.0.0.1:3003');
        if (prev !== undefined) process.env.BROWSER_METAMASK_BASE_URL = prev;
    });
});

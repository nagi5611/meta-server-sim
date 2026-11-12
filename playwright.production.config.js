// playwright.production.config.js — E2E against live sim.mmh-virtual.jp (no local webServer)
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';

dotenv.config();

const adminPassword = process.env.ADMIN_PASSWORD || '';

export default defineConfig({
    testDir: './e2e',
    timeout: 180_000,
    expect: { timeout: 60_000 },
    retries: 1,
    use: {
        baseURL: process.env.E2E_BASE_URL || 'https://sim.mmh-virtual.jp',
        trace: 'on-first-retry',
        httpCredentials: {
            username: process.env.ADMIN_USERNAME || 'admin',
            password: adminPassword,
        },
    },
    projects: [
        { name: 'production', testMatch: /^(?!.*prod-vc-duplex).*$/ },
        {
            name: 'production-vc-duplex',
            testMatch: /prod-vc-duplex\.spec\.js/,
            timeout: 420_000,
            use: {
                permissions: ['microphone', 'camera'],
                launchOptions: {
                    args: [
                        '--use-fake-ui-for-media-stream',
                        '--use-fake-device-for-media-stream',
                    ],
                },
            },
        },
    ],
});

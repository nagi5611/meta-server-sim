// playwright.staging-remote.config.js — 既存 sim/staging サーバーに叩く（webServer なし）
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';

dotenv.config();

const port = process.env.METASIM_REMOTE_PORT || process.env.METASIM_STAGING_PORT || '3104';
const forwardHost =
    process.env.PLAYWRIGHT_FORWARD_HOST || 'staging.mmh-virtual.jp';
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;
const adminPassword = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';

export default defineConfig({
    testDir: './e2e',
    timeout: 180_000,
    expect: { timeout: 60_000 },
    retries: 1,
    use: {
        baseURL,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: {
            'X-Forwarded-Proto': 'https',
            Host: forwardHost,
        },
        trace: 'on-first-retry',
        httpCredentials: {
            username: process.env.ADMIN_USERNAME || 'admin',
            password: adminPassword,
        },
    },
    projects: [{ name: 'staging-remote', testMatch: /tenant-taiko-chart\.spec\.js/ }],
});
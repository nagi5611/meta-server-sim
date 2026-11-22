// playwright.staging-remote.config.js — 既存 staging サーバーに叩く（webServer なし）
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';

dotenv.config();

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3104';
const adminPassword = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';

export default defineConfig({
    testDir: './e2e',
    timeout: 180_000,
    expect: { timeout: 60_000 },
    retries: 0,
    use: {
        baseURL,
        trace: 'on-first-retry',
        httpCredentials: {
            username: process.env.ADMIN_USERNAME || 'admin',
            password: adminPassword,
        },
    },
    projects: [{ name: 'staging-remote', testMatch: /tenant-taiko-chart\.spec\.js/ }],
});
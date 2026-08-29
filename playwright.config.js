// playwright.config.js
import { defineConfig } from '@playwright/test';
import { readExtraVitePorts } from './scripts/read-dev-vite-ports.mjs';

const extraVitePorts = readExtraVitePorts();
const adminPassword = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';

export default defineConfig({
    testDir: './e2e',
    timeout: 180_000,
    expect: { timeout: 60_000 },
    retries: 0,
    use: {
        baseURL: 'http://localhost:3003',
        trace: 'on-first-retry',
        httpCredentials: {
            username: process.env.ADMIN_USERNAME || 'admin',
            password: adminPassword,
        },
    },
    webServer: [
        {
            command: `npx cross-env ADMIN_PASSWORD=${adminPassword} node server.js`,
            url: 'http://localhost:3002/api/health',
            reuseExistingServer: true,
            timeout: 60_000,
        },
        {
            command: 'npx cross-env VITE_DEV_PORT=3003 vite --port 3003 --strictPort',
            url: 'http://localhost:3003/',
            reuseExistingServer: true,
            timeout: 60_000,
        },
        ...extraVitePorts.map((port) => ({
            command: `npx cross-env VITE_DEV_PORT=${port} vite --port ${port} --strictPort`,
            url: `http://localhost:${port}/`,
            reuseExistingServer: true,
            timeout: 60_000,
        })),
    ],
});

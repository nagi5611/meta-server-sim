// e2e/tenant-menu.global-setup.js — テナントメニュー E2E 起動前チェック
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:3003';
const tenantId = process.env.E2E_TENANT_ID || 'P-01';

export default async function globalSetup() {
    const healthUrl = baseUrl.replace(/:\d+$/, ':3002') + '/api/health';
    let healthOk = false;
    for (let i = 0; i < 3; i++) {
        try {
            const res = await fetch(healthUrl);
            if (res.ok) {
                healthOk = true;
                break;
            }
        } catch {
            /* webServer may still be starting */
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
    if (!healthOk) {
        console.warn(`[e2e setup] health check skipped or failed: ${healthUrl}`);
    }

    const tenantUrl = `${baseUrl}/${tenantId}/api/client-config`;
    try {
        const res = await fetch(tenantUrl);
        if (!res.ok) {
            throw new Error(`tenant client-config ${res.status}`);
        }
        const data = await res.json();
        if (data.tenantId !== tenantId) {
            throw new Error(`unexpected tenantId: ${data.tenantId}`);
        }
    } catch (err) {
        throw new Error(`[e2e setup] tenant ${tenantId} not reachable at ${tenantUrl}: ${err.message}`);
    }

    console.log(`[e2e setup] tenant menu env ready (${tenantId}, gemini=${Boolean(process.env.GEMINI_API_KEY)})`);
}

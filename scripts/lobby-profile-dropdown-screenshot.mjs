import { chromium } from '@playwright/test';
import path from 'node:path';

const out = path.resolve('/opt/cursor/artifacts/lobby-profile-dropdown.png');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:8799/index.html', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
    localStorage.setItem(
        'mnm.auth',
        JSON.stringify({
            mode: 'login',
            draft: {
                login: { email: '', pass: '' },
                signup: { name: '', email: '', pass: '' },
            },
            user: { name: '山田太郎', handle: '@yamada_t', role: 'member' },
        }),
    );
});
await page.reload({ waitUntil: 'networkidle' });
await page.locator('#openProfile').click();
await page.locator('#profileDrop:not([hidden])').waitFor({ state: 'visible', timeout: 5000 });
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
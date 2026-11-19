import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: false, slowMo: 120 });
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
await page.waitForTimeout(400);
await page.locator('#openProfile').click();
await page.waitForTimeout(800);
await page.locator('#pName').fill('山田 花子');
await page.waitForTimeout(600);
await page.locator('#profileAvatarPick').click();
await page.waitForTimeout(400);
await browser.close();
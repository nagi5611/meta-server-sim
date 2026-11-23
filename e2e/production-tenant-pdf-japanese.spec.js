// e2e/production-tenant-pdf-japanese.spec.js — 日本語ファイル名 PDF の取得と pdfjs シムコンソール
import { test, expect } from '@playwright/test';

const SIM_ORIGIN = (process.env.SIM_ORIGIN || 'https://sim.mmh-virtual.jp').replace(/\/$/, '');
const TENANT_ID = process.env.TENANT_ID || 'P-01';
const JP_PDF = '一般_ポスター原稿_松山南（物理１）.pdf';

test.describe('production tenant PDF', () => {
    test('Japanese PDF path returns 200 and no pdfjs shim error on entry', async ({ page, request }) => {
        const consoleErr = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') consoleErr.push(msg.text());
        });

        const pdfUrl = `${SIM_ORIGIN}/${encodeURIComponent(TENANT_ID)}/pdfs/${encodeURIComponent(JP_PDF)}`;
        const pdfRes = await request.get(pdfUrl);
        expect(pdfRes.status(), pdfUrl).toBe(200);
        const pdfHead = (await pdfRes.body()).subarray(0, 5).toString('utf8');
        expect(pdfHead).toBe('%PDF-');

        await page.goto(`${SIM_ORIGIN}/${encodeURIComponent(TENANT_ID)}/`, {
            waitUntil: 'domcontentloaded',
            timeout: 120_000,
        });
        const gate = page.locator('#tenant-login-enter-btn');
        if (await gate.isVisible({ timeout: 5000 }).catch(() => false)) await gate.click();
        await expect
            .poll(
                async () => page.evaluate(() => document.documentElement.dataset.tenantMetaverseReady === 'true'),
                { timeout: 120_000 },
            )
            .toBe(true);

        const shimErrors = consoleErr.filter((t) => /tenant-pdfjs-shim|read only property 'getDocument'/i.test(t));
        expect(shimErrors, shimErrors.join('\n')).toEqual([]);

        const pdfLoad = await page.evaluate(
            async ({ tenantId, pdfFile }) => {
                const mapEl = document.querySelector('script[type="importmap"]');
                if (!mapEl?.textContent) return { ok: false, reason: 'no-importmap' };
                let imports;
                try {
                    imports = JSON.parse(mapEl.textContent).imports ?? {};
                } catch {
                    return { ok: false, reason: 'importmap-parse' };
                }
                const spec = imports['pdfjs-dist'];
                if (!spec) return { ok: false, reason: 'no-pdfjs-dist' };
                const modUrl = new URL(spec, `${window.location.origin}/${encodeURIComponent(tenantId)}/`).href;
                const { getDocument } = await import(modUrl);
                const task = getDocument(`pdfs/${pdfFile}`);
                const doc = await task.promise;
                return { ok: true, numPages: doc.numPages };
            },
            { tenantId: TENANT_ID, pdfFile: JP_PDF },
        );
        expect(pdfLoad.ok, pdfLoad.reason || '').toBe(true);
        expect(pdfLoad.numPages, 'PDF page count').toBeGreaterThan(0);
    });
});
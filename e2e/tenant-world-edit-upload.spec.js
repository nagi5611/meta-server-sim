// e2e/tenant-world-edit-upload.spec.js
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';
const HDR_PATH = process.env.E2E_HDR_PATH || 'D:\\Downloads\\327\\default.hdr';
const GLB_PATH = process.env.E2E_GLB_PATH || 'D:\\Downloads\\0710\\lite_3dmodel.glb';

test.describe('tenant world edit uploads', () => {
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('P-01 env-ibl-hdr API and HDR overwrite upload', async ({ page, request }) => {
        const csrfRes = await request.get('/admin/csrf-token');
        expect(csrfRes.ok()).toBeTruthy();
        const { token } = await csrfRes.json();

        const envRes = await request.get('/P-01/api/env-ibl-hdr');
        expect(envRes.ok(), `env-ibl-hdr status ${envRes.status()}`).toBeTruthy();
        const envJson = await envRes.json();
        expect(envJson.path).toBe('env/default.hdr');
        expect(typeof envJson.present).toBe('boolean');

        if (!fs.existsSync(HDR_PATH)) {
            test.skip(true, `HDR fixture missing: ${HDR_PATH}`);
        }

        const hdrUpload = await request.post('/admin/tenants/P-01/upload-hdr?confirm=1', {
            headers: { 'X-Admin-CSRF': token },
            multipart: {
                hdr: {
                    name: 'default.hdr',
                    mimeType: 'application/octet-stream',
                    buffer: fs.readFileSync(HDR_PATH),
                },
            },
        });
        expect(hdrUpload.ok(), `upload-hdr ${hdrUpload.status()} ${await hdrUpload.text()}`).toBeTruthy();

        const envAfter = await request.get('/P-01/api/env-ibl-hdr');
        const envAfterJson = await envAfter.json();
        expect(envAfterJson.present).toBe(true);

        await page.goto('/admin/tenant/P-01/world-edit');
        await expect(page.locator('#world-list .item').first()).toBeVisible({ timeout: 120_000 });

        await page.locator('.we-category-btn[data-we-category="assets"]').click();
        const hdrLabel = await page.locator('#we-hdr-current-filename').textContent();
        expect(hdrLabel || '').toContain('env/default.hdr');
    });

    test('P-01 GLB model upload appears in model list', async ({ page, request }) => {
        if (!fs.existsSync(GLB_PATH)) {
            test.skip(true, `GLB fixture missing: ${GLB_PATH}`);
        }

        const csrfRes = await request.get('/admin/csrf-token');
        const { token } = await csrfRes.json();
        const glbName = path.basename(GLB_PATH);

        const uploadRes = await request.post('/admin/tenants/P-01/upload?confirm=1', {
            headers: { 'X-Admin-CSRF': token },
            multipart: {
                model: {
                    name: glbName,
                    mimeType: 'model/gltf-binary',
                    buffer: fs.readFileSync(GLB_PATH),
                },
                filename_b64: Buffer.from(glbName, 'utf8').toString('base64'),
            },
        });
        expect(uploadRes.ok(), `upload glb ${uploadRes.status()} ${await uploadRes.text()}`).toBeTruthy();

        const modelsRes = await request.get('/admin/tenants/P-01/models');
        const models = await modelsRes.json();
        expect(models).toEqual(expect.arrayContaining([glbName]));

        await page.goto('/admin/tenant/P-01/world-edit');
        await expect(page.locator('#world-list .item').first()).toBeVisible({ timeout: 120_000 });
        await page.locator('.we-category-btn[data-we-category="assets"]').click();
        await expect(page.locator('#model-list .item', { hasText: glbName })).toBeVisible({
            timeout: 30_000,
        });
    });

    test('P-01 GLB model upload via UI completes status row', async ({ page }) => {
        if (!fs.existsSync(GLB_PATH)) {
            test.skip(true, `GLB fixture missing: ${GLB_PATH}`);
        }

        const glbName = path.basename(GLB_PATH);

        await page.goto('/admin/tenant/P-01/world-edit');
        await expect(page.locator('#world-list .item').first()).toBeVisible({ timeout: 120_000 });

        await page.locator('.we-category-btn[data-we-category="assets"]').click();
        await expect(page.locator('#we-cat-assets.active')).toBeVisible({ timeout: 30_000 });
        const uploadOpenBtn = page.locator('#btn-model-upload-open');
        await uploadOpenBtn.scrollIntoViewIfNeeded();
        await uploadOpenBtn.click();
        await expect(page.locator('#model-upload-modal.show')).toBeVisible();

        const fileInput = page.locator('#model-upload-input');
        await fileInput.setInputFiles(GLB_PATH);

        const row = page.locator('.model-upload-row', { hasText: glbName });
        await expect(row).toBeVisible({ timeout: 10_000 });
        await expect(row.locator('.model-upload-row-status')).not.toHaveText('アップロード中…', {
            timeout: 120_000,
        });
        await expect(row.locator('.model-upload-row-status')).toHaveText(/保存|スキップ|失敗/, {
            timeout: 5_000,
        });
    });

    test('R2 storage API init (skipped unless STORAGE_BACKEND=r2)', async ({ request }) => {
        if (process.env.STORAGE_BACKEND !== 'r2') {
            test.skip(true, 'STORAGE_BACKEND=r2 が未設定');
        }
        const csrfRes = await request.get('/admin/csrf-token');
        const { token } = await csrfRes.json();

        const initRes = await request.post('/admin/tenants/P-01/r2-storage/upload/init', {
            headers: {
                'X-Admin-CSRF': token,
                'Content-Type': 'application/json',
            },
            data: {
                store: 'images',
                filename: 'r2-test.txt',
                size: 4,
                allowOverwrite: true,
            },
        });
        expect(initRes.ok(), await initRes.text()).toBeTruthy();
        const initJson = await initRes.json();
        expect(initJson.sessionId).toBeTruthy();
        expect(typeof initJson.directUpload).toBe('boolean');
    });
});

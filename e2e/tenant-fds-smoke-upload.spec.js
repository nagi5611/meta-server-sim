// e2e/tenant-fds-smoke-upload.spec.js
import { zipSync } from 'fflate';
import { test, expect } from '@playwright/test';

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';
const TENANT_ID = 'P-04';
const TEST_SIM_ID = 'e2e-fds-smoke-fixture';

/**
 * 最小限の有効 FDS smoke ZIP を生成する
 * @returns {Buffer}
 */
function buildMinimalFdsSmokeZip() {
    const manifest = {
        quantity: 'TEST',
        frameCount: 2,
        dims: [2, 2, 2],
        times: [0, 1],
        valueMax: 1,
        bounds: {
            x: [0, 1],
            y: [0, 1],
            z: [0, 1],
        },
        dataFile: 'smoke.uint8.bin',
        dataType: 'uint8',
        layout: 'xi+zi*nx+yi*nx*ny (volumeResolution: nx,nz,ny)',
    };
    const binBytes = new Uint8Array(2 * 2 * 2 * 2);
    const zipped = zipSync({
        'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
        'smoke.uint8.bin': binBytes,
    });
    return Buffer.from(zipped);
}

/**
 * manifest なしの不正 ZIP
 * @returns {Buffer}
 */
function buildInvalidZip() {
    const zipped = zipSync({
        'readme.txt': new TextEncoder().encode('not a fds smoke export'),
    });
    return Buffer.from(zipped);
}

test.describe('tenant FDS smoke ZIP upload', () => {
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('upload valid ZIP, list simulation, reject invalid ZIP', async ({ request }) => {
        const csrfRes = await request.get('/admin/csrf-token');
        expect(csrfRes.ok()).toBeTruthy();
        const { token } = await csrfRes.json();

        const zipBuffer = buildMinimalFdsSmokeZip();
        const uploadRes = await request.post(
            `/admin/tenants/${TENANT_ID}/upload-fds-smoke-zip?confirm=1`,
            {
                headers: { 'X-Admin-CSRF': token },
                multipart: {
                    zip: {
                        name: `${TEST_SIM_ID}.zip`,
                        mimeType: 'application/zip',
                        buffer: zipBuffer,
                    },
                    simId: TEST_SIM_ID,
                },
            },
        );
        expect(
            uploadRes.ok(),
            `upload-fds-smoke-zip ${uploadRes.status()} ${await uploadRes.text()}`,
        ).toBeTruthy();
        const uploadJson = await uploadRes.json();
        expect(uploadJson.simId).toBe(TEST_SIM_ID);

        const listRes = await request.get(`/admin/tenants/${TENANT_ID}/simulations`);
        expect(listRes.ok()).toBeTruthy();
        const listJson = await listRes.json();
        expect(listJson.simulations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: TEST_SIM_ID,
                    frameCount: 2,
                    multipart: false,
                }),
            ]),
        );

        const badZipRes = await request.post(
            `/admin/tenants/${TENANT_ID}/upload-fds-smoke-zip`,
            {
                headers: { 'X-Admin-CSRF': token },
                multipart: {
                    zip: {
                        name: 'invalid.zip',
                        mimeType: 'application/zip',
                        buffer: buildInvalidZip(),
                    },
                    simId: 'invalid-fds-smoke',
                },
            },
        );
        expect(badZipRes.status()).toBe(400);

        const deleteRes = await request.delete(
            `/admin/tenants/${TENANT_ID}/simulations/${TEST_SIM_ID}`,
            { headers: { 'X-Admin-CSRF': token } },
        );
        expect(deleteRes.ok()).toBeTruthy();
    });
});

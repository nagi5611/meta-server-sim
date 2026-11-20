// e2e/helpers/aircraft-visual.mjs — 飛行機メッシュと HUD のランタイム検証

/**
 * @param {import('@playwright/test').Page} page
 */
export async function expectAircraftVisualOnScene(page) {
    const ok = await page.evaluate(() => {
        const app = window.__tenantE2E?.getMetaverseApp?.();
        const slots = app?.sceneManager?.getAircraftSlots?.() || [];
        return slots.some((s) => s.root?.getObjectByName?.('sim-aircraft-visual'));
    });
    if (!ok) throw new Error('sim-aircraft-visual not found in scene');
}

/**
 * @param {import('@playwright/test').Page} page
 */
export async function readAircraftHudNumbers(page) {
    return page.evaluate(() => {
        const easy = document.getElementById('aircraft-hud-easy-omega-speed')?.textContent?.trim() || '';
        const hard = document.getElementById('aircraft-hud-speed')?.textContent?.trim() || '';
        const alt =
            window.__tenantE2E?.getAircraftHud?.()?.altitude ??
            window.__tenantE2E?.getMetaverseApp?.()?.sceneManager?.getCamera?.()?.position?.y;
        return { easy, hard, altitude: alt };
    });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} minAltitude
 */
export async function expectAltitudeAbove(page, minAltitude) {
    await page.waitForFunction(
        (min) => {
            const hud = window.__tenantE2E?.getAircraftHud?.();
            const y = hud?.altitude;
            return typeof y === 'number' && Number.isFinite(y) && y > min;
        },
        minAltitude,
        { timeout: 120_000 },
    );
}

/**
 * レンダリング後のキャンバスで機体色（青系）ピクセルが一定数あるか
 * @param {import('@playwright/test').Page} page
 * @param {number} minCount
 */
export async function expectCanvasAircraftPixels(page, minCount = 80) {
    const count = await page.evaluate(async () => {
        const app = window.__tenantE2E?.getMetaverseApp?.();
        const renderer = app?.sceneManager?.getRenderer?.();
        const scene = app?.sceneManager?.getScene?.();
        const camera = app?.sceneManager?.getCamera?.();
        const canvas = document.getElementById('canvas');
        if (!renderer || !scene || !camera || !canvas) return 0;

        const slots = app.sceneManager.getAircraftSlots?.() || [];
        const visual = slots.map((s) => s.root?.getObjectByName?.('sim-aircraft-visual')).find(Boolean);
        if (!visual) return 0;

        const { WebGLRenderTarget, RGBAFormat, UnsignedByteType } = window.__metaverseSharedThree;
        const w = Math.min(256, canvas.width || 256);
        const h = Math.min(256, canvas.height || 256);
        const target = new WebGLRenderTarget(w, h, { format: RGBAFormat, type: UnsignedByteType });
        const oldTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        const buf = new Uint8Array(w * h * 4);
        renderer.readRenderTargetPixels(target, 0, 0, w, h, buf);
        renderer.setRenderTarget(oldTarget);
        target.dispose();

        let blues = 0;
        for (let i = 0; i < buf.length; i += 4) {
            const r = buf[i];
            const g = buf[i + 1];
            const b = buf[i + 2];
            const a = buf[i + 3];
            if (a < 40) continue;
            if (b > 90 && b > r + 15 && g > 60) blues += 1;
        }
        return blues;
    });
    if (count < minCount) {
        throw new Error(`Expected >=${minCount} aircraft-colored pixels, got ${count}`);
    }
    return count;
}
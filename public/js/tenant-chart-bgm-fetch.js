// public/js/tenant-chart-bgm-fetch.js — テナント向け譜面 BGM / ヒット音取得（WAV 優先）

import { toTenantUrl } from './tenant-runtime-shim.js';

/**
 * 拡張子なしのベース URL に .wav または .mp3 を付けて取得する
 * @param {string} basePath 例: /chart-bgm/myChart または /myChart/hits/p1-b0-don（toTenantUrl 済み推奨）
 * @param {string|number} version キャッシュ無効化用 v=
 * @returns {Promise<ArrayBuffer>}
 */
export async function fetchChartBgmArrayBuffer(basePath, version) {
    const path = basePath.startsWith('/') ? toTenantUrl(basePath) : basePath;
    const v = encodeURIComponent(String(version));
    const tryExt = async (ext) => {
        const res = await fetch(`${path}${ext}?v=${v}`, { credentials: 'same-origin' });
        if (!res.ok) return null;
        return res.arrayBuffer();
    };
    const wav = await tryExt('.wav');
    if (wav) return wav;
    const mp3 = await tryExt('.mp3');
    if (mp3) return mp3;
    throw new Error('BGMの取得に失敗しました');
}
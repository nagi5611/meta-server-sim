// lib/chart-bgm-transcode.js — 譜面 BGM の WAV サイドカー（ffmpeg が無い環境では no-op）

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * MP3 パスに対応する WAV サイドカーのパスを返す
 * @param {string} mp3Path
 * @returns {string}
 */
export function wavPathForMp3(mp3Path) {
    const base = String(mp3Path || '').replace(/\.mp3$/i, '');
    return `${base}.wav`;
}

/**
 * システム ffmpeg があれば MP3 を WAV に変換する
 * @param {string} mp3Path
 * @param {string} wavPath
 * @returns {Promise<void>}
 */
function transcodeMp3FileToWav(mp3Path, wavPath) {
    if (!fs.existsSync(mp3Path)) {
        return Promise.reject(new Error(`MP3 not found: ${mp3Path}`));
    }
    const dir = path.dirname(wavPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return new Promise((resolve, reject) => {
        const args = [
            '-hide_banner',
            '-loglevel', 'error',
            '-y',
            '-i', mp3Path,
            '-ac', '2',
            '-ar', '44100',
            wavPath,
        ];
        execFile('ffmpeg', args, { maxBuffer: 20 * 1024 * 1024 }, (err, _stdout, stderr) => {
            if (err) {
                reject(new Error(stderr?.toString?.() || err.message || String(err)));
                return;
            }
            resolve();
        });
    });
}

/**
 * MP3 を書いた直後に呼ぶ: 対応 WAV を生成する（失敗時は false）
 * @param {string} mp3Path
 * @returns {Promise<boolean>}
 */
export async function ensureWavSidecarForMp3Path(mp3Path) {
    const wav = wavPathForMp3(mp3Path);
    try {
        await transcodeMp3FileToWav(mp3Path, wav);
        return true;
    } catch {
        return false;
    }
}
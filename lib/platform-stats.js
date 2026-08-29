// lib/platform-stats.js — プラットフォーム CPU/RAM 等（metaverse-simple 縮小）
import os from 'node:os';

let lastCpuUsage = null;
/** @type {number | null} */
let lastCpuTime = null;

/**
 * サーバーロード指標
 * @returns {{ cpuUsagePercent: number | null, ramUsagePercent: number | null, commPerSecond: number, degradationIndex: number }}
 */
export function getServerLoadMetrics() {
    const now = Date.now();
    let cpuUsagePercent = null;
    const numCpus = os.cpus().length;
    if (lastCpuTime !== null && lastCpuUsage !== null && numCpus > 0) {
        const elapsedSec = (now - lastCpuTime) / 1000;
        if (elapsedSec > 0) {
            const delta = process.cpuUsage(lastCpuUsage);
            const oneCorePercent = ((delta.user + delta.system) / 1e6 / elapsedSec) * 100;
            cpuUsagePercent = oneCorePercent / numCpus;
        }
    }
    lastCpuUsage = process.cpuUsage();
    lastCpuTime = now;

    const totalMem = os.totalmem();
    const usedMem = totalMem - os.freemem();
    const ramUsagePercent = totalMem > 0 ? (usedMem / totalMem) * 100 : null;

    const commPerSecond = 0;
    const degradationIndex = commPerSecond / 30;

    return { cpuUsagePercent, ramUsagePercent, commPerSecond, degradationIndex };
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

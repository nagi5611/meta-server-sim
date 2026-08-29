// scripts/read-dev-vite-ports.mjs — network-config から dev 用 Vite ポート一覧
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'platform', 'network-config.json');

export const NODE_DEV_PORT = 3002;
export const BASE_VITE_DEV_PORT = 3003;

/**
 * network-config の系列サーバーから追加 Vite ポートを収集する
 * @returns {number[]}
 */
export function readExtraVitePorts() {
    const ports = new Set();
    try {
        if (!fs.existsSync(CONFIG_PATH)) return [];
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        const servers = Array.isArray(raw.servers) ? raw.servers : [];
        for (const s of servers) {
            if (s?.bindService) continue;
            const port = parseInt(String(s.port ?? ''), 10);
            if (!Number.isFinite(port) || port < 1 || port > 65535) continue;
            if (port === NODE_DEV_PORT || port === BASE_VITE_DEV_PORT) continue;
            ports.add(port);
        }
    } catch {
        /* ignore */
    }
    return [...ports].sort((a, b) => a - b);
}

/**
 * free-dev-ports 用の全 dev ポート
 * @returns {number[]}
 */
export function readAllDevPorts() {
    return [NODE_DEV_PORT, BASE_VITE_DEV_PORT, ...readExtraVitePorts()];
}

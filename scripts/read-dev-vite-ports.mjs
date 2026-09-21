// scripts/read-dev-vite-ports.mjs — network-config から dev 用 Vite ポート一覧
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'platform', 'network-config.json');

export const NODE_DEV_PORT = 3002;
export const BASE_VITE_DEV_PORT = 3003;
/** FDS 煙バルク（PORT+1 が Vite と衝突するため dev 既定） */
export const FDS_SMOKE_BULK_DEV_PORT = 3012;

/**
 * @returns {number}
 */
export function resolveNodeDevPort() {
    const port = parseInt(String(process.env.PORT ?? ''), 10);
    return Number.isFinite(port) && port > 0 ? port : NODE_DEV_PORT;
}

/**
 * @returns {number}
 */
export function resolveBaseViteDevPort() {
    const port = parseInt(String(process.env.VITE_DEV_PORT ?? ''), 10);
    return Number.isFinite(port) && port > 0 ? port : BASE_VITE_DEV_PORT;
}

/**
 * @param {number} nodePort
 * @returns {number}
 */
export function resolveFdsBulkDevPort(nodePort) {
    const candidate = nodePort + 1;
    const vitePort = resolveBaseViteDevPort();
    if (candidate === vitePort) {
        return FDS_SMOKE_BULK_DEV_PORT;
    }
    return candidate;
}

/**
 * network-config の系列サーバーから追加 Vite ポートを収集する
 * @param {number} [nodePort]
 * @param {number} [baseVitePort]
 * @returns {number[]}
 */
export function readExtraVitePorts(nodePort = resolveNodeDevPort(), baseVitePort = resolveBaseViteDevPort()) {
    const ports = new Set();
    try {
        if (!fs.existsSync(CONFIG_PATH)) return [];
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        const servers = Array.isArray(raw.servers) ? raw.servers : [];
        for (const s of servers) {
            if (s?.bindService) continue;
            const port = parseInt(String(s.port ?? ''), 10);
            if (!Number.isFinite(port) || port < 1 || port > 65535) continue;
            if (port === nodePort || port === baseVitePort) continue;
            ports.add(port);
        }
    } catch {
        /* ignore */
    }
    return [...ports].sort((a, b) => a - b);
}

/**
 * dev 起動で bind する全ポート（Node / Vite / FDS bulk / network-config 追加分）
 * @returns {number[]}
 */
export function readAllDevPorts() {
    const nodePort = resolveNodeDevPort();
    const vitePort = resolveBaseViteDevPort();
    const bulkPort = resolveFdsBulkDevPort(nodePort);
    const ports = [nodePort, vitePort];
    if (bulkPort > 0) {
        ports.push(bulkPort);
    }
    for (const p of readExtraVitePorts(nodePort, vitePort)) {
        ports.push(p);
    }
    return [...new Set(ports)].sort((a, b) => a - b);
}

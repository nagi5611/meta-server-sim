// scripts/dev-extra-vite.mjs — network-config の追加ポートで Vite を起動
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readExtraVitePorts } from './read-dev-vite-ports.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'platform', 'network-config.json');

/** @type {Map<number, import('node:child_process').ChildProcess>} */
const children = new Map();

/**
 * @param {number} port
 */
function startPort(port) {
    if (children.has(port)) return;

    const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
        cwd: ROOT,
        shell: true,
        env: { ...process.env, VITE_DEV_PORT: String(port) },
        stdio: 'inherit',
    });

    child.on('exit', (code, signal) => {
        children.delete(port);
        if (code !== 0 && code !== null && signal !== 'SIGTERM') {
            console.warn(`[dev-extra-vite] port ${port} exited (code=${code})`);
        }
    });

    children.set(port, child);
    console.log(`[dev-extra-vite] Vite http://localhost:${port} (→ Node 3002)`);
}

/**
 * @param {number} port
 */
function stopPort(port) {
    const child = children.get(port);
    if (!child) return;
    child.kill('SIGTERM');
    children.delete(port);
    console.log(`[dev-extra-vite] stopped port ${port}`);
}

function syncPorts() {
    const wanted = new Set(readExtraVitePorts());
    for (const port of children.keys()) {
        if (!wanted.has(port)) stopPort(port);
    }
    for (const port of wanted) {
        startPort(port);
    }
}

syncPorts();

let debounceTimer = null;
if (fs.existsSync(CONFIG_PATH)) {
    fs.watch(CONFIG_PATH, () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(syncPorts, 1000);
    });
}

process.on('SIGINT', () => {
    for (const port of children.keys()) stopPort(port);
    process.exit(0);
});

process.on('SIGTERM', () => {
    for (const port of children.keys()) stopPort(port);
    process.exit(0);
});

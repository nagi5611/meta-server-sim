// scripts/dev-port-utils.mjs — dev ポート占有の検出・解放
import { execSync } from 'node:child_process';
import process from 'node:process';

/**
 * @param {number} port
 * @returns {number[]}
 */
export function findListeningPids(port) {
    if (process.platform === 'win32') {
        try {
            const out = execSync(
                `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
            );
            return [...new Set(out.trim().split(/\s+/).filter(Boolean))]
                .map((s) => parseInt(s, 10))
                .filter((n) => Number.isFinite(n) && n > 0 && n !== process.pid);
        } catch {
            return [];
        }
    }

    try {
        const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return [...new Set(out.trim().split(/\s+/).filter(Boolean))]
            .map((s) => parseInt(s, 10))
            .filter((n) => Number.isFinite(n) && n > 0 && n !== process.pid);
    } catch {
        return [];
    }
}

/**
 * @param {number} pid
 * @returns {string | null}
 */
export function getProcessName(pid) {
    if (process.platform === 'win32') {
        try {
            const out = execSync(
                `powershell -NoProfile -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName"`,
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
            );
            const name = out.trim();
            return name || null;
        } catch {
            return null;
        }
    }
    try {
        const out = execSync(`ps -p ${pid} -o comm=`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return out.trim() || null;
    } catch {
        return null;
    }
}

/**
 * @param {number[]} ports
 * @returns {{ port: number, occupants: { pid: number, processName: string | null }[] }[]}
 */
export function findPortConflicts(ports) {
    /** @type {{ port: number, occupants: { pid: number, processName: string | null }[] }[]} */
    const conflicts = [];
    for (const port of ports) {
        const pids = findListeningPids(port);
        if (pids.length === 0) continue;
        conflicts.push({
            port,
            occupants: pids.map((pid) => ({
                pid,
                processName: getProcessName(pid),
            })),
        });
    }
    return conflicts;
}

/**
 * @param {number} port
 * @returns {boolean} いずれかの PID を終了した
 */
export function freePort(port) {
    const pids = findListeningPids(port);
    let killed = false;
    for (const pid of pids) {
        try {
            if (process.platform === 'win32') {
                execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
            } else {
                execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
            }
            console.log(`[dev] freed port ${port} (pid ${pid})`);
            killed = true;
        } catch {
            /* ignore */
        }
    }
    return killed;
}

/**
 * @param {{ port: number, occupants: { pid: number }[] }[]} conflicts
 */
export function freePortConflicts(conflicts) {
    for (const { port } of conflicts) {
        freePort(port);
    }
}

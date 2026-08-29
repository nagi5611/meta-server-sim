// scripts/free-dev-ports.mjs — dev 用ポートの占有プロセスを解放
import { execSync } from 'node:child_process';
import process from 'node:process';
import { readAllDevPorts } from './read-dev-vite-ports.mjs';

const DEV_PORTS = readAllDevPorts();
/**
 * @param {number} port
 */
function freePort(port) {
    if (process.platform === 'win32') {
        try {
            const out = execSync(
                `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
            );
            const pids = [...new Set(out.trim().split(/\s+/).filter(Boolean))];
            for (const pid of pids) {
                if (pid === String(process.pid)) continue;
                execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
                console.log(`[dev] freed port ${port} (pid ${pid})`);
            }
        } catch {
            // ポート未使用
        }
        return;
    }

    try {
        execSync(`lsof -ti:${port} | xargs -r kill -9`, { shell: true, stdio: 'ignore' });
        console.log(`[dev] freed port ${port}`);
    } catch {
        // ポート未使用
    }
}

for (const port of DEV_PORTS) {
    freePort(port);
}

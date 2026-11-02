// lib/platform-fleet-systemd.js — systemctl ラッパー経由のサービス操作
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { getFleetCore, loadFleetCores } from './platform-fleet-registry.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WRAPPER = path.join(__dirname, '..', 'scripts', 'platform-fleet-systemctl.sh');

function getWrapperPath() {
    return String(process.env.PLATFORM_FLEET_SYSTEMCTL_WRAPPER || DEFAULT_WRAPPER).trim() || DEFAULT_WRAPPER;
}

/** @type {Set<string>} */
function allowedUnits() {
    return new Set(loadFleetCores().map((c) => c.systemdUnit));
}

async function execWrapper(action, unit) {
    const wrapper = getWrapperPath();
    const opts = { timeout: 120_000, maxBuffer: 1024 * 1024 };
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
        return execFileAsync(wrapper, [action, unit], opts);
    }
    return execFileAsync('sudo', ['-n', wrapper, action, unit], opts);
}

/**
 * @param {string} unit
 * @param {'status'|'start'|'stop'|'restart'|'is-active'} action
 */
export async function runFleetSystemctl(unit, action) {
    const u = String(unit || '').trim();
    if (!allowedUnits().has(u)) {
        throw new Error(`systemd unit not in fleet registry: ${u}`);
    }
    const { stdout, stderr } = await execWrapper(action, u);
    return { stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * @param {string} coreId
 */
export async function getFleetServiceStatus(coreId) {
    const core = getFleetCore(coreId);
    if (!core) {
        throw new Error(`unknown core: ${coreId}`);
    }
    const [active, show] = await Promise.all([
        runFleetSystemctl(core.systemdUnit, 'is-active'),
        runFleetSystemctl(core.systemdUnit, 'status'),
    ]);
    return {
        coreId: core.id,
        unit: core.systemdUnit,
        active: active.stdout,
        statusText: show.stdout || show.stderr,
    };
}

/**
 * @param {string} coreId
 * @param {'start'|'stop'|'restart'} action
 */
export async function controlFleetService(coreId, action) {
    const core = getFleetCore(coreId);
    if (!core) {
        throw new Error(`unknown core: ${coreId}`);
    }
    const result = await runFleetSystemctl(core.systemdUnit, action);
    return {
        coreId: core.id,
        unit: core.systemdUnit,
        action,
        output: result.stdout || result.stderr,
    };
}

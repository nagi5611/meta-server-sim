// lib/platform-fleet-registry.js — 本番系列コア（systemd + .env）定義
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY = path.join(__dirname, '..', 'data', 'platform', 'fleet-registry.json');

/** @typedef {{
 *   id: string,
 *   label: string,
 *   systemdUnit: string,
 *   envFile: string,
 *   publicHost?: string,
 *   nginxPort?: number,
 * }} FleetCore
 */

/** @type {FleetCore[] | null} */
let cachedCores = null;

export const FLEET_EDITABLE_ENV_KEYS = [
    'PORT',
    'HOST',
    'MEDIASOUP_ANNOUNCED_IP',
    'MEDIASOUP_ANNOUNCED_LAN_IP',
    'VC_RTC_MIN_PORT',
    'VC_RTC_MAX_PORT',
    'VIDEO_VC_RTC_MIN_PORT',
    'VIDEO_VC_RTC_MAX_PORT',
    'PROXY_SERVICE_DOMAIN',
    'PROXY_DOMAIN_PORT_MAP',
];

/**
 * @param {unknown} raw
 * @returns {FleetCore[]}
 */
function normalizeRegistry(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cores)) {
        return [];
    }
    /** @type {FleetCore[]} */
    const cores = [];
    for (const c of raw.cores) {
        if (!c || typeof c !== 'object') continue;
        const id = String(c.id ?? '').trim();
        const label = String(c.label ?? '').trim();
        const systemdUnit = String(c.systemdUnit ?? '').trim();
        const envFile = String(c.envFile ?? '').trim();
        if (!id || !systemdUnit || !envFile) continue;
        cores.push({
            id,
            label: label || id,
            systemdUnit,
            envFile,
            publicHost: c.publicHost != null ? String(c.publicHost).trim() : undefined,
            nginxPort:
                c.nginxPort != null && Number.isFinite(Number(c.nginxPort))
                    ? Number(c.nginxPort)
                    : undefined,
        });
    }
    return cores;
}

export function getFleetRegistryPath() {
    return String(process.env.PLATFORM_FLEET_REGISTRY_PATH || DEFAULT_REGISTRY).trim() || DEFAULT_REGISTRY;
}

export function loadFleetCores() {
    if (cachedCores) return cachedCores;
    const registryPath = getFleetRegistryPath();
    try {
        const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
        cachedCores = normalizeRegistry(raw);
    } catch {
        cachedCores = [];
    }
    return cachedCores;
}

export function reloadFleetRegistry() {
    cachedCores = null;
    return loadFleetCores();
}

/**
 * @param {string} coreId
 * @returns {FleetCore | undefined}
 */
export function getFleetCore(coreId) {
    const id = String(coreId || '').trim();
    return loadFleetCores().find((c) => c.id === id);
}

export function isFleetOpsEnabled() {
    const flag = String(process.env.PLATFORM_FLEET_OPS_ENABLED ?? '1').trim().toLowerCase();
    if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') {
        return false;
    }
    return loadFleetCores().length > 0;
}

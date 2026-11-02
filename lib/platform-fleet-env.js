// lib/platform-fleet-env.js — 系列コア .env の読み書き（ホワイトリスト）
import fs from 'node:fs';
import { FLEET_EDITABLE_ENV_KEYS } from './platform-fleet-registry.js';

/**
 * @param {string} envPath
 * @returns {Record<string, string>}
 */
export function readEnvFile(envPath) {
    if (!fs.existsSync(envPath)) {
        return {};
    }
    const text = fs.readFileSync(envPath, 'utf8');
    /** @type {Record<string, string>} */
    const map = {};
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1);
        map[key] = value;
    }
    return map;
}

/**
 * @param {Record<string, string>} all
 * @param {string[]} keys
 */
export function pickEnvKeys(all, keys) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(all, key)) {
            out[key] = all[key];
        } else {
            out[key] = '';
        }
    }
    return out;
}

/**
 * @param {string} envPath
 * @param {Record<string, string>} updates
 * @returns {{ ok: true, changed: string[] } | { ok: false, error: string }}
 */
export function writeEnvFileUpdates(envPath, updates) {
    if (!fs.existsSync(envPath)) {
        return { ok: false, error: `env file not found: ${envPath}` };
    }

    /** @type {Record<string, string>} */
    const filtered = {};
    for (const [key, value] of Object.entries(updates)) {
        if (!FLEET_EDITABLE_ENV_KEYS.includes(key)) {
            return { ok: false, error: `key not allowed: ${key}` };
        }
        filtered[key] = String(value ?? '');
    }

    const stat = fs.statSync(envPath);
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    /** @type {string[]} */
    const changed = [];

    for (const key of Object.keys(filtered)) {
        const newVal = filtered[key];
        const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=`);
        let found = false;
        for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
                found = true;
                const oldLine = lines[i];
                const next = `${key}=${newVal}`;
                if (oldLine !== next) {
                    lines[i] = next;
                    changed.push(key);
                }
                break;
            }
        }
        if (!found) {
            lines.push(`${key}=${newVal}`);
            changed.push(key);
        }
    }

    if (changed.length === 0) {
        return { ok: true, changed: [] };
    }

    const tmp = `${envPath}.fleet.tmp.${process.pid}`;
    fs.writeFileSync(tmp, `${lines.join('\n').replace(/\n*$/, '')}\n`, 'utf8');
    fs.chmodSync(tmp, stat.mode);
    fs.renameSync(tmp, envPath);
    try {
        fs.chownSync(envPath, stat.uid, stat.gid);
    } catch {
        /* ignore on dev */
    }
    return { ok: true, changed };
}

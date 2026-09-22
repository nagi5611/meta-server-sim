// lib/admin-auth.js — 管理画面 Basic 認証（metaverse-simple 縮小版）
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { getPlatformEnv } from './platform-env-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ADMIN_CRED_DIR = path.join(PROJECT_ROOT, 'data', 'platform');
const DEV_ADMIN_CRED_FILE = '.admin-generated-password';

/** @type {boolean} */
let devCredFileWarningShown = false;

/**
 * @returns {boolean}
 */
function isNodeProduction() {
    return process.env.NODE_ENV === 'production';
}

/**
 * 開発でも ADMIN_PASSWORD を必須にする（自動生成ファイルを使わない）
 * @returns {boolean}
 */
function isAdminPasswordRequiredInDev() {
    const v = String(process.env.ADMIN_PASSWORD_REQUIRED ?? '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
}

/**
 * @returns {string}
 */
function devAdminCredPath() {
    return path.join(ADMIN_CRED_DIR, DEV_ADMIN_CRED_FILE);
}

/**
 * 認証情報ファイルを所有者のみ読み書きに制限する（ベストエフォート）
 * @param {string} credPath
 */
function restrictCredFilePermissions(credPath) {
    try {
        fs.chmodSync(credPath, 0o600);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[security] could not chmod admin credential file to 0600:', msg);
    }
}

/**
 * Unix でグループ/その他に読み取り可能な場合は警告し、可能なら 0600 に戻す
 * @param {string} credPath
 */
function warnIfCredFileTooPermissive(credPath) {
    if (process.platform === 'win32') return;
    try {
        const perm = fs.statSync(credPath).mode & 0o777;
        if ((perm & 0o077) !== 0) {
            console.warn(
                `[security] ${credPath} mode ${perm.toString(8)} is too permissive; tightening to 0600`
            );
            restrictCredFilePermissions(credPath);
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[security] could not stat admin credential file:', msg);
    }
}

/**
 * ディスク上の自動生成パスワードに依存していることを一度だけ警告する
 * @param {string} credPath
 */
function warnUsingDevCredFileOnce(credPath) {
    if (devCredFileWarningShown) return;
    devCredFileWarningShown = true;
    console.warn(
        `[security] Dev admin password loaded from ${credPath}. ` +
            'Set ADMIN_PASSWORD in .env instead of keeping secrets on disk. ' +
            'Use ADMIN_PASSWORD_REQUIRED=1 to disable this fallback. Do not commit or share the file.'
    );
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualStr(a, b) {
    const bufa = Buffer.from(String(a), 'utf8');
    const bufb = Buffer.from(String(b), 'utf8');
    if (bufa.length !== bufb.length) return false;
    return crypto.timingSafeEqual(bufa, bufb);
}

/**
 * 管理認証情報を解決する
 * @returns {{ username: string, password: string }}
 */
export function resolveAdminCredentials() {
    const username = String(getPlatformEnv('ADMIN_USERNAME') || 'admin').trim() || 'admin';
    const envPassword = String(getPlatformEnv('ADMIN_PASSWORD') ?? '').trim();

    if (envPassword.length > 0) {
        if (isNodeProduction() && envPassword.length < 16) {
            throw new Error(
                '[security] NODE_ENV=production requires ADMIN_PASSWORD min 16 characters'
            );
        }
        return { username, password: envPassword };
    }

    if (isNodeProduction()) {
        throw new Error(
            '[security] NODE_ENV=production requires ADMIN_PASSWORD in .env (min 16 characters)'
        );
    }

    if (isAdminPasswordRequiredInDev()) {
        throw new Error(
            '[security] ADMIN_PASSWORD_REQUIRED is set; configure ADMIN_PASSWORD in .env (do not rely on .admin-generated-password)'
        );
    }

    const credPath = devAdminCredPath();
    try {
        if (fs.existsSync(credPath)) {
            warnIfCredFileTooPermissive(credPath);
            const line = fs.readFileSync(credPath, 'utf8').trim();
            const colon = line.indexOf(':');
            if (colon > 0) {
                const fileUser = line.slice(0, colon).trim();
                const filePass = line.slice(colon + 1);
                if (fileUser === username && filePass.length > 0) {
                    restrictCredFilePermissions(credPath);
                    warnUsingDevCredFileOnce(credPath);
                    return { username, password: filePass };
                }
            }
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[security] could not read generated admin password file:', msg);
    }

    const generated = crypto.randomBytes(18).toString('base64url');
    try {
        fs.mkdirSync(ADMIN_CRED_DIR, { recursive: true, mode: 0o700 });
        fs.writeFileSync(credPath, `${username}:${generated}\n`, { mode: 0o600 });
        restrictCredFilePermissions(credPath);
        console.warn(
            `[security] ADMIN_PASSWORD unset; dev-only credentials written to ${credPath} (mode 0600). ` +
                'Set ADMIN_PASSWORD in .env or ADMIN_PASSWORD_REQUIRED=1 to avoid persisting secrets on disk.'
        );
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[security] could not write generated admin password file:', msg);
    }
    return { username, password: generated };
}

/**
 * @param {string} username
 * @param {string} password
 * @returns {import('express').RequestHandler}
 */
export function createBasicAuthMiddleware(username, password) {
    return function basicAuth(req, res, next) {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
            return res.status(401).send('認証が必要です');
        }

        let decoded;
        try {
            decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        } catch {
            res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
            return res.status(401).send('認証に失敗しました');
        }

        const sep = decoded.indexOf(':');
        const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
        const pass = sep >= 0 ? decoded.slice(sep + 1) : '';

        if (timingSafeEqualStr(user, username) && timingSafeEqualStr(pass, password)) {
            return next();
        }

        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
        return res.status(401).send('認証に失敗しました');
    };
}

/**
 * 管理パネル（admin.html）向け CSP
 * @returns {import('express').RequestHandler}
 */
export function adminPanelCspMiddleware(_req, res, next) {
    res.setHeader(
        'Content-Security-Policy',
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net 'sha256-gm9yYDtuo+EHIJRgcqikkiVsevwwayV7IzltiaiYAvQ='",
            "importmap 'self' https://cdn.jsdelivr.net",
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
            "img-src 'self' data: blob: https:",
            "connect-src 'self' blob: wss: ws: https:",
            "media-src 'self' blob: data: https:",
            "font-src 'self' data: https://cdn.jsdelivr.net",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'self'",
        ].join('; ')
    );
    next();
}

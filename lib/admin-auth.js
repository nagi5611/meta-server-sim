// lib/admin-auth.js — 管理画面 Basic 認証（metaverse-simple 縮小版）
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ADMIN_CRED_DIR = path.join(PROJECT_ROOT, 'data', 'platform');

/**
 * @param {string | undefined} v
 * @returns {boolean}
 */
function isNodeProduction() {
    return process.env.NODE_ENV === 'production';
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
    const username = String(process.env.ADMIN_USERNAME || 'admin').trim() || 'admin';
    const envPassword = String(process.env.ADMIN_PASSWORD ?? '').trim();

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

    const credPath = path.join(ADMIN_CRED_DIR, '.admin-generated-password');
    try {
        if (fs.existsSync(credPath)) {
            const line = fs.readFileSync(credPath, 'utf8').trim();
            const colon = line.indexOf(':');
            if (colon > 0) {
                const fileUser = line.slice(0, colon).trim();
                const filePass = line.slice(colon + 1);
                if (fileUser === username && filePass.length > 0) {
                    return { username, password: filePass };
                }
            }
        }
    } catch (e) {
        console.warn('[security] could not read generated admin password file:', e);
    }

    const generated = crypto.randomBytes(18).toString('base64url');
    try {
        fs.mkdirSync(ADMIN_CRED_DIR, { recursive: true });
        fs.writeFileSync(credPath, `${username}:${generated}\n`, { mode: 0o600 });
        console.log(
            `[security] ADMIN_PASSWORD unset; dev credentials written to ${credPath}`
        );
    } catch (e) {
        console.warn('[security] could not write generated admin password file:', e);
    }
    console.log(`[security] Dev admin user: ${username} (see data/platform/.admin-generated-password)`);
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
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; connect-src 'self' blob: wss: ws: https:; media-src 'self' blob: data: https:; font-src 'self' data: https://cdn.jsdelivr.net; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
    );
    next();
}

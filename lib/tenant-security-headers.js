// lib/tenant-security-headers.js — テナント HTML / 静的配信向けセキュリティヘッダ

/**
 * 本番では JS eval を許可しない（wasm のみ）。開発では Vite HMR 用に unsafe-eval を付与。
 * @returns {boolean}
 */
function tenantCspAllowsUnsafeEval() {
    return process.env.NODE_ENV !== 'production';
}

/**
 * テナント向け CSP 文字列を組み立てる
 * @returns {string}
 */
export function buildTenantContentSecurityPolicy() {
    const scriptSrc = ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"];
    if (tenantCspAllowsUnsafeEval()) {
        scriptSrc.splice(2, 0, "'unsafe-eval'");
    }
    return [
        "default-src 'self'",
        `script-src ${scriptSrc.join(' ')}`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' blob: wss: ws: https:",
        "media-src 'self' blob: data: https:",
        "font-src 'self' data: https://fonts.gstatic.com",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
    ].join('; ');
}

/** @type {string} */
export const TENANT_CONTENT_SECURITY_POLICY = buildTenantContentSecurityPolicy();

/**
 * テナントルート配下のレスポンスに CSP 等を付与（Vite dev の HMR / eval 互換）
 * @returns {import('express').RequestHandler}
 */
export function tenantSecurityHeadersMiddleware(_req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', buildTenantContentSecurityPolicy());
    next();
}

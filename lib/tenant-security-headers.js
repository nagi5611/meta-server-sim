// lib/tenant-security-headers.js — テナント HTML / 静的配信向けセキュリティヘッダ

/** @type {string} */
export const TENANT_CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
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

/**
 * テナントルート配下のレスポンスに CSP 等を付与（Vite dev の HMR / eval 互換）
 * @returns {import('express').RequestHandler}
 */
export function tenantSecurityHeadersMiddleware(_req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', TENANT_CONTENT_SECURITY_POLICY);
    next();
}

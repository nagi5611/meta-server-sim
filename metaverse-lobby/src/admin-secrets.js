/** @type {Set<string>} */
const warnedFallbacks = new Set();

/**
 * Test-only: clear warn-once state between tests.
 */
export function __testResetAdminSecretWarnings() {
    warnedFallbacks.clear();
}

/**
 * @param {'admin_session' | 'admin_otp'} purpose
 * @param {string} missingEnv
 * @param {string} fallbackEnv
 */
function warnAdminSecretFallback(purpose, missingEnv, fallbackEnv) {
    const key = `${purpose}:${fallbackEnv}`;
    if (warnedFallbacks.has(key)) return;
    warnedFallbacks.add(key);
    console.warn(
        `[ADMIN_SECRETS] purpose=${purpose}: ${missingEnv} is unset; using ${fallbackEnv}. ` +
            'Set dedicated secrets before removing fallback (docs/security/lobby-admin-secrets.md).',
    );
}

/**
 * Resolves the JWT signing secret for lobby admin HTTP sessions.
 * @param {Record<string, unknown>} env
 * @returns {string}
 */
export function resolveAdminSessionSecret(env) {
    const primary = String(env.LOBBY_ADMIN_SESSION_SECRET || '').trim();
    if (primary) return primary;
    const jwt = String(env.LOBBY_JWT_SECRET || '').trim();
    if (jwt) {
        warnAdminSecretFallback('admin_session', 'LOBBY_ADMIN_SESSION_SECRET', 'LOBBY_JWT_SECRET');
        return jwt;
    }
    return '';
}

/**
 * Resolves HMAC material for super-admin OTP challenges.
 * @param {Record<string, unknown>} env
 * @returns {string}
 */
export function resolveAdminOtpSecret(env) {
    const otp = String(env.ADMIN_OTP_SECRET || '').trim();
    if (otp) return otp;
    const session = String(env.LOBBY_ADMIN_SESSION_SECRET || '').trim();
    if (session) {
        warnAdminSecretFallback('admin_otp', 'ADMIN_OTP_SECRET', 'LOBBY_ADMIN_SESSION_SECRET');
        return session;
    }
    const jwt = String(env.LOBBY_JWT_SECRET || '').trim();
    if (jwt) {
        warnAdminSecretFallback('admin_otp', 'ADMIN_OTP_SECRET/LOBBY_ADMIN_SESSION_SECRET', 'LOBBY_JWT_SECRET');
        return jwt;
    }
    return '';
}
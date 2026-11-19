// Bearer tokens for Worker → sim /service routes (scoped + legacy full-access)

import crypto from 'node:crypto';

/** @typedef {'read' | 'user_write' | 'catalog_write' | 'auth' | 'kick'} LobbyServiceScope */

export const LOBBY_SERVICE_SCOPES = Object.freeze({
    READ: 'read',
    USER_WRITE: 'user_write',
    CATALOG_WRITE: 'catalog_write',
    AUTH: 'auth',
    KICK: 'kick',
});

/** @type {LobbyServiceScope[]} */
const ALL_SCOPES = Object.values(LOBBY_SERVICE_SCOPES);

let legacyFullTokenWarned = false;

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
 * @param {string | undefined} value
 * @returns {string[]}
 */
function tokenListFromEnv(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return [];
    return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Primary + optional rotation list for one env key and its _PREVIOUS sibling.
 * @param {string} baseKey
 * @returns {string[]}
 */
function envTokenChain(baseKey) {
    const tokens = [...tokenListFromEnv(process.env[baseKey])];
    const prevKey = `${baseKey}_PREVIOUS`;
    for (const t of tokenListFromEnv(process.env[prevKey])) {
        if (!tokens.includes(t)) tokens.push(t);
    }
    return tokens;
}

/**
 * @returns {{ legacyFull: string[], byScope: Map<LobbyServiceScope, string[]> }}
 */
function loadLobbyServiceTokenConfig() {
    const legacyFull = envTokenChain('LOBBY_SIM_SERVICE_TOKEN');
    /** @type {Map<LobbyServiceScope, string[]>} */
    const byScope = new Map();

    const scopeEnv = /** @type {const} */ ([
        [LOBBY_SERVICE_SCOPES.READ, 'LOBBY_SIM_SERVICE_TOKEN_READ'],
        [LOBBY_SERVICE_SCOPES.USER_WRITE, 'LOBBY_SIM_SERVICE_TOKEN_USER_WRITE'],
        [LOBBY_SERVICE_SCOPES.CATALOG_WRITE, 'LOBBY_SIM_SERVICE_TOKEN_CATALOG_WRITE'],
        [LOBBY_SERVICE_SCOPES.AUTH, 'LOBBY_SIM_SERVICE_TOKEN_AUTH'],
        [LOBBY_SERVICE_SCOPES.KICK, 'LOBBY_SIM_SERVICE_TOKEN_KICK'],
    ]);

    for (const [scope, envKey] of scopeEnv) {
        const scoped = envTokenChain(envKey);
        if (scoped.length) byScope.set(scope, scoped);
    }

    return { legacyFull, byScope };
}

/**
 * @param {import('express').Request} req
 * @returns {string}
 */
function getBearerToken(req) {
    const auth = String(req.headers.authorization || '').trim();
    const prefix = 'Bearer ';
    if (!auth.startsWith(prefix)) return '';
    return auth.slice(prefix.length).trim();
}

/**
 * @param {string} provided
 * @param {string[]} candidates
 * @returns {boolean}
 */
function matchesAnyToken(provided, candidates) {
    if (!provided || !candidates.length) return false;
    for (const expected of candidates) {
        if (timingSafeEqualStr(provided, expected)) return true;
    }
    return false;
}

/**
 * @param {string} provided
 * @param {LobbyServiceScope} requiredScope
 * @returns {boolean}
 */
function authorizeServiceToken(provided, requiredScope) {
    const { legacyFull, byScope } = loadLobbyServiceTokenConfig();
    if (!legacyFull.length && byScope.size === 0) {
        return false;
    }

    if (matchesAnyToken(provided, legacyFull)) {
        if (!legacyFullTokenWarned && byScope.size > 0) {
            legacyFullTokenWarned = true;
            console.warn(
                '[lobby-service-auth] LOBBY_SIM_SERVICE_TOKEN grants full /service access; scoped tokens are also configured — prefer scoped secrets on the Worker when possible.'
            );
        }
        return true;
    }

    const scoped = byScope.get(requiredScope) || [];
    if (matchesAnyToken(provided, scoped)) {
        return true;
    }

    return false;
}

/**
 * @returns {boolean}
 */
export function isLobbyServiceAuthConfigured() {
    const { legacyFull, byScope } = loadLobbyServiceTokenConfig();
    return legacyFull.length > 0 || byScope.size > 0;
}

/**
 * Express middleware — require Bearer token with the given scope (legacy token allows all).
 * @param {LobbyServiceScope} requiredScope
 */
export function lobbyServiceBearerAuth(requiredScope) {
    if (!ALL_SCOPES.includes(requiredScope)) {
        throw new Error(`invalid_lobby_service_scope:${requiredScope}`);
    }
    return (req, res, next) => {
        if (!isLobbyServiceAuthConfigured()) {
            return res.status(503).json({ error: 'service_token_not_configured' });
        }
        const provided = getBearerToken(req);
        if (!provided || !authorizeServiceToken(provided, requiredScope)) {
            return res.status(401).json({ error: 'unauthorized' });
        }
        next();
    };
}
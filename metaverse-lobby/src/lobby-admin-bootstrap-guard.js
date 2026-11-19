import { fetchSim } from './sim-client.js';
import { getPublicSession } from './auth-api.js';

/** Default bootstrap admin cookie lifetime (was 12h; shortened for faster privilege decay). */
export const DEFAULT_BOOTSTRAP_ADMIN_TTL_SEC = 2 * 60 * 60;

/**
 * @param {Record<string, unknown>} env
 * @returns {number}
 */
export function resolveBootstrapAdminTtlSec(env) {
    const raw = Number(env.LOBBY_ADMIN_BOOTSTRAP_TTL_SECONDS);
    if (Number.isFinite(raw) && raw >= 300 && raw <= 86_400) {
        return Math.floor(raw);
    }
    return DEFAULT_BOOTSTRAP_ADMIN_TTL_SEC;
}

/**
 * @param {'student'|'teacher'} kind
 * @param {{ lobbyRole?: string }} user
 * @returns {boolean}
 */
export function isSimLobbyAdminUser(kind, user) {
    const lobbyRole = String(user.lobbyRole || (kind === 'teacher' ? 'admin' : 'user'));
    return lobbyRole === 'admin';
}

/**
 * Confirm the public lobby JWT still authorizes bootstrap-linked admin use.
 * @param {Record<string, unknown> | null} publicSession
 * @param {Record<string, unknown>} adminSession
 * @returns {boolean}
 */
export function isBootstrapAdminPublicSessionLinked(publicSession, adminSession) {
    if (!publicSession || String(publicSession.role || '') !== 'admin') return false;
    const linkSub = String(adminSession.lobbySub || adminSession.sub || '');
    return linkSub.length > 0 && String(publicSession.sub || '') === linkSub;
}

/**
 * Re-query sim for current lobby_role before issuing a bootstrap admin session.
 * @param {Record<string, unknown> | null} publicSession
 * @param {Record<string, unknown>} env
 * @returns {Promise<{ allowed: boolean, reason: string, simChecked?: boolean, fallback?: boolean }>}
 */
export async function resolveBootstrapAdminEligibility(publicSession, env) {
    if (!publicSession || String(publicSession.role || '') !== 'admin') {
        return { allowed: false, reason: 'jwt_not_admin' };
    }
    const refMatch = /^((?:student|teacher))-(\d+)$/.exec(String(publicSession.sub || ''));
    if (!refMatch) {
        return { allowed: true, reason: 'jwt_only', simChecked: false, fallback: true };
    }
    const kind = /** @type {'student'|'teacher'} */ (refMatch[1]);
    const sim = await fetchSim(env, `/service/users/${kind}/${refMatch[2]}`);
    if (!sim.ok || !sim.data) {
        console.warn('bootstrap-from-lobby: sim lobby_role check unavailable', {
            status: sim.status,
            error: sim.data?.error,
        });
        return { allowed: true, reason: 'sim_unavailable', simChecked: false, fallback: true };
    }
    if (sim.data.banned) {
        return { allowed: false, reason: 'banned', simChecked: true };
    }
    if (!isSimLobbyAdminUser(kind, sim.data)) {
        return { allowed: false, reason: 'demoted', simChecked: true };
    }
    return { allowed: true, reason: 'sim_verified', simChecked: true };
}

/**
 * Invalidate bootstrap admin JWT when the paired public lobby session is gone or no longer admin.
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {Record<string, unknown> | null} adminSession
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function enforceBootstrapAdminContinuity(request, env, adminSession) {
    if (!adminSession?.bootstrapFromLobby) return adminSession;
    const publicSession = await getPublicSession(request, env);
    if (!isBootstrapAdminPublicSessionLinked(publicSession, adminSession)) return null;
    return adminSession;
}
/**
 * Lobby admin panel distinguishes two kinds of operator:
 *
 * - **Super admin** — signs in with the Worker secret pair
 *   `LOBBY_ADMIN_USER` + `LOBBY_ADMIN_PASSWORD` (static operator account).
 *   JWT admin sessions include `superAdmin: true`. Only super admins may
 *   promote or demote other users' `lobbyRole` (admin ↔ member).
 *
 * - **Lobby admin** — a teacher or student whose sim account has
 *   `lobbyRole: 'admin'`. They can use the admin panel for catalog, users
 *   (ban/unban, kick, password reset), announcements, etc., but not
 *   grant or revoke admin role on others.
 *
 * Bootstrap from the public lobby (`/api/admin/bootstrap-from-lobby`) copies a
 * public JWT with `role: admin`; that never sets `superAdmin`.
 */

/**
 * @param {{ superAdmin?: boolean } | null | undefined} session Verified admin JWT payload
 * @returns {boolean}
 */
export function isLobbySuperAdmin(session) {
    return Boolean(session && session.superAdmin === true);
}

/**
 * @param {Record<string, unknown>} env Worker env
 * @param {string} login Submitted login name (static path only)
 * @param {string} password Submitted password (static path only)
 * @returns {boolean} Whether static LOBBY_ADMIN_* credentials matched
 */
export function isStaticLobbyAdminLogin(env, login, password) {
    const expectUser = String(env.LOBBY_ADMIN_USER || 'admin').trim();
    const expectPass = String(env.LOBBY_ADMIN_PASSWORD || '').trim();
    if (!expectPass) return false;
    return login === expectUser && password === expectPass;
}
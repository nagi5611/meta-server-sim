import { fetchSim } from './sim-client.js';
import { isLobbySessionBanned } from './auth-api.js';

export async function resolveLobbySessionBan(session, env) {
    if (!session?.sub) return { banned: false };
    const refMatch = /^((?:student|teacher))-(\d+)$/.exec(String(session.sub || ''));
    if (refMatch) {
        const sim = await fetchSim(env, `/service/users/${refMatch[1]}/${refMatch[2]}`);
        if (sim.ok && sim.data) {
            if (sim.data.banned) return { banned: true, source: 'sim' };
            if (session.banned) return { banned: false, reauth: true, source: 'sim_lifted' };
            return { banned: false, source: 'sim' };
        }
    }
    if (isLobbySessionBanned(session)) return { banned: true, source: 'session' };
    return { banned: false };
}

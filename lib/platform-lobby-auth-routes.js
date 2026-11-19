// Public lobby user login (rate-limited at platform edge in production)

import { verifyStudent, verifyTeacher } from '../db/users.js';
import { completeLobbyPasswordReset } from './lobby-password-reset.js';
import { createLobbyRouteRateLimit } from './http-rate-limit.js';

const lobbyAuthLimit = createLobbyRouteRateLimit();

/**
 * @param {import('express').Express} app
 */
export function registerPlatformLobbyAuthRoutes(app) {
    app.post('/api/lobby/auth/login', lobbyAuthLimit, async (req, res) => {
        const username = String(req.body?.username || req.body?.email || '').trim();
        const password = String(req.body?.password || '');
        if (!username || !password) {
            return res.status(400).json({ error: 'username_and_password_required' });
        }
        try {
            let user = await verifyStudent(username, password);
            let kind = 'student';
            if (!user) {
                user = await verifyTeacher(username, password);
                kind = 'teacher';
            }
            if (!user) {
                return res.status(401).json({ error: 'invalid_credentials' });
            }
            if (user.banned) {
                return res.status(403).json({ error: 'banned' });
            }
            const lobbyRole = user.lobbyRole || (kind === 'teacher' ? 'admin' : 'user');
            const role = lobbyRole === 'admin' ? 'admin' : 'member';
            res.json({
                ok: true,
                user: {
                    userId: `${kind}-${user.id}`,
                    kind,
                    id: user.id,
                    username: user.username,
                    displayName: user.displayName,
                    role,
                    banned: Boolean(user.banned),
                    lobbyRole: user.lobbyRole || (kind === 'teacher' ? 'admin' : 'user'),
                },
            });
        } catch (err) {
            console.error('POST /api/lobby/auth/login:', err);
            res.status(500).json({ error: 'login_failed' });
        }
    });

    app.post('/api/lobby/auth/reset-password', lobbyAuthLimit, async (req, res) => {
        const token = String(req.body?.token || '').trim();
        const password = String(req.body?.password || '');
        if (!token || !password) {
            return res.status(400).json({ error: 'token_and_password_required' });
        }
        try {
            const result = await completeLobbyPasswordReset(token, password);
            res.json(result);
        } catch (err) {
            const code = err.code || 'reset_failed';
            const status = code === 'INVALID_TOKEN' || code === 'TOKEN_EXPIRED' ? 400 : 500;
            res.status(status).json({ error: code, message: err.message });
        }
    });
}
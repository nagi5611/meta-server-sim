// Public lobby user login (rate-limited at platform edge in production)

import { registerLobbyStudent, verifyStudent, verifyTeacher } from '../db/users.js';
import { completeLobbyPasswordReset } from './lobby-password-reset.js';
import { createLobbyRouteRateLimit } from './http-rate-limit.js';
import { moderateDisplayNameForJoin } from './display-name-moderation-policy.js';
import { buildLobbyAuthUser } from './platform-lobby-auth-user.js';

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
            res.json({ ok: true, user: buildLobbyAuthUser(kind, user) });
        } catch (err) {
            console.error('POST /api/lobby/auth/login:', err);
            res.status(500).json({ error: 'login_failed' });
        }
    });

    app.post('/api/lobby/auth/signup', lobbyAuthLimit, async (req, res) => {
        const email = String(req.body?.email || '').trim();
        const password = String(req.body?.password || '');
        let displayName = String(req.body?.name || req.body?.displayName || '').trim();
        if (!email || !password) {
            return res.status(400).json({ error: 'email_and_password_required' });
        }
        if (!displayName) {
            const local = email.split('@')[0]?.trim();
            displayName = local || '';
        }
        if (!displayName) {
            return res.status(400).json({ error: 'name_required' });
        }
        const moderation = await moderateDisplayNameForJoin({ displayName });
        if (!moderation.allowed) {
            return res.status(422).json({ error: 'display_name_rejected' });
        }
        try {
            const created = await registerLobbyStudent(email, password, displayName);
            res.status(201).json({
                ok: true,
                user: buildLobbyAuthUser('student', {
                    ...created,
                    banned: false,
                    lobbyRole: 'user',
                    avatarUrl: '',
                }),
            });
        } catch (err) {
            if (err.code === 'INVALID_EMAIL') {
                return res.status(400).json({ error: 'invalid_email' });
            }
            if (err.code === 'NAME_REQUIRED') {
                return res.status(400).json({ error: 'name_required' });
            }
            if (err.code === 'EMAIL_EXISTS' || err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'email_exists' });
            }
            if (err.code === 'PASSWORD_POLICY') {
                return res.status(400).json({ error: err.message, minLength: err.minLength });
            }
            console.error('POST /api/lobby/auth/signup:', err);
            res.status(500).json({ error: 'signup_failed' });
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
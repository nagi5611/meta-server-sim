// lib/tenant-user-auth-routes.js — テナント /api/auth/* ログイン

import { signSocketAuthToken } from '../../metaverse-simple/lib/socket-auth-token.js';
import { verifyStudent, verifyTeacher } from '../db/users.js';
import { notifyDiscordActivity } from './discord-activity-webhook.js';
import { setSocketAuthCookieOnResponse } from './tenant-metaverse-http-auth.js';

const SOCKET_AUTH_TOKEN_IN_JSON = process.env.SOCKET_AUTH_TOKEN_IN_JSON === '1';

/**
 * @param {import('express').Router} router
 */
export function registerTenantUserAuthRoutes(router) {
    router.post('/api/auth/student/login', async (req, res) => {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'username and password required' });
        }
        try {
            const user = await verifyStudent(username, password);
            if (!user) {
                return res.status(401).json({ success: false, error: 'invalid_credentials' });
            }
            const token = signSocketAuthToken({ role: 'student' });
            setSocketAuthCookieOnResponse(res, token);
            const body = {
                success: true,
                username: user.displayName,
                displayName: user.displayName,
                role: 'student',
            };
            if (SOCKET_AUTH_TOKEN_IN_JSON) body.socketAuthToken = token;
            notifyDiscordActivity('login', { userId: user.username, userName: user.displayName });
            res.json(body);
        } catch (err) {
            console.error('[tenant auth] student login:', err);
            res.status(503).json({ success: false, error: 'auth_unavailable' });
        }
    });

    router.post('/api/auth/teacher/login', async (req, res) => {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'username and password required' });
        }
        try {
            const user = await verifyTeacher(username, password);
            if (!user) {
                return res.status(401).json({ success: false, error: 'invalid_credentials' });
            }
            const token = signSocketAuthToken({ role: 'teacher' });
            setSocketAuthCookieOnResponse(res, token);
            const body = {
                success: true,
                username: user.displayName,
                displayName: user.displayName,
                role: 'teacher',
            };
            if (SOCKET_AUTH_TOKEN_IN_JSON) body.socketAuthToken = token;
            notifyDiscordActivity('login', { userId: user.username, userName: user.displayName });
            res.json(body);
        } catch (err) {
            console.error('[tenant auth] teacher login:', err);
            res.status(503).json({ success: false, error: 'auth_unavailable' });
        }
    });
}

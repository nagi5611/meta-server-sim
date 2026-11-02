// lib/platform-admin-users-routes.js — /admin/users/* (D1 / sqlite)

import {
    deleteStudent,
    deleteTeacher,
    getUsersDbStatus,
    listStudents,
    listTeachers,
    registerStudent,
    registerTeacher,
    updateStudent,
    updateTeacher,
} from '../db/users.js';
import { validateUserPassword } from './password-policy.js';

/**
 * @param {import('express').Express} app
 */
export function registerPlatformAdminUsersRoutes(app) {
    app.get('/admin/users/status', async (_req, res) => {
        try {
            const status = getUsersDbStatus();
            const students = await listStudents();
            const teachers = await listTeachers();
            res.json({
                ...status,
                counts: { students: students.length, teachers: teachers.length },
            });
        } catch (err) {
            console.error('GET /admin/users/status:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/admin/users/students', async (_req, res) => {
        try {
            res.json(await listStudents());
        } catch (err) {
            console.error('GET /admin/users/students:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/admin/users/teachers', async (_req, res) => {
        try {
            res.json(await listTeachers());
        } catch (err) {
            console.error('GET /admin/users/teachers:', err);
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/admin/users/student', async (req, res) => {
        const { username, password, displayName } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ error: 'username and password required' });
        }
        const pwCheck = validateUserPassword(password);
        if (!pwCheck.ok) {
            return res.status(400).json({ error: pwCheck.error, minLength: pwCheck.minLength });
        }
        try {
            const user = await registerStudent(username, password, displayName);
            res.json({
                success: true,
                user: { id: user.id, username: user.username, displayName: user.displayName },
            });
        } catch (e) {
            if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'username_exists' });
            }
            if (e.code === 'PASSWORD_POLICY') {
                return res.status(400).json({ error: e.message, minLength: e.minLength });
            }
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/admin/users/teacher', async (req, res) => {
        const { username, password, displayName } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ error: 'username and password required' });
        }
        const pwCheck = validateUserPassword(password);
        if (!pwCheck.ok) {
            return res.status(400).json({ error: pwCheck.error, minLength: pwCheck.minLength });
        }
        try {
            const user = await registerTeacher(username, password, displayName);
            res.json({
                success: true,
                user: { id: user.id, username: user.username, displayName: user.displayName },
            });
        } catch (e) {
            if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'username_exists' });
            }
            if (e.code === 'PASSWORD_POLICY') {
                return res.status(400).json({ error: e.message, minLength: e.minLength });
            }
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/admin/users/student/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
        try {
            const user = await updateStudent(id, req.body || {});
            if (!user) return res.status(404).json({ error: 'not_found' });
            res.json({
                success: true,
                user: { id: user.id, username: user.username, displayName: user.displayName },
            });
        } catch (e) {
            if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'username_exists' });
            }
            res.status(500).json({ error: e.message });
        }
    });

    app.put('/admin/users/teacher/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
        try {
            const user = await updateTeacher(id, req.body || {});
            if (!user) return res.status(404).json({ error: 'not_found' });
            res.json({
                success: true,
                user: { id: user.id, username: user.username, displayName: user.displayName },
            });
        } catch (e) {
            if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                return res.status(409).json({ error: 'username_exists' });
            }
            res.status(500).json({ error: e.message });
        }
    });

    app.delete('/admin/users/student/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
        const ok = await deleteStudent(id);
        if (!ok) return res.status(404).json({ error: 'not_found' });
        res.json({ success: true });
    });

    app.delete('/admin/users/teacher/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' });
        const ok = await deleteTeacher(id);
        if (!ok) return res.status(404).json({ error: 'not_found' });
        res.json({ success: true });
    });
}

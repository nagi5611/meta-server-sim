#!/usr/bin/env node
/**
 * ローカル users DB の email を更新（本番は METASIM_ENV_FILE 側 sqlite / D1）
 * Usage: node scripts/lobby-set-user-email.mjs student nagi nagi@mmh-virtual.jp
 */
import 'dotenv/config';
import { initUsersDb, patchLobbyUserFlags } from '../db/users.js';

const [kind, username, email] = process.argv.slice(2);
if (!kind || !username || !email) {
    console.error('Usage: node scripts/lobby-set-user-email.mjs <student|teacher> <username> <email>');
    process.exit(1);
}
await initUsersDb();
const { listStudents, listTeachers } = await import('../db/users.js');
const rows = kind === 'teacher' ? await listTeachers() : await listStudents();
const user = rows.find((u) => u.username === username);
if (!user) {
    console.error('user not found:', username);
    process.exit(2);
}
await patchLobbyUserFlags(kind, user.id, { email });
console.log(JSON.stringify({ ok: true, kind, id: user.id, username, email }));
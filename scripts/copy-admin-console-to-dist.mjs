// scripts/copy-admin-console-to-dist.mjs — Vite 後に CONSOLE 静的資産を dist へ同期
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');

function cpDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
        const s = path.join(src, name);
        const d = path.join(dst, name);
        const st = fs.statSync(s);
        if (st.isDirectory()) cpDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

const files = [
    'admin-legacy.html',
    'admin-legacy-tenant.html',
    'admin-legacy-tenant-world-edit.html',
    'admin-tenant-world-edit-body.html',
];

for (const f of files) {
    const s = path.join(PUBLIC, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(DIST, f));
}

cpDir(path.join(PUBLIC, 'admin-console'), path.join(DIST, 'admin-console'));
console.log('[copy-admin-console-to-dist] synced admin-console + legacy html');
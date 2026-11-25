// scripts/build-admin-tenant-world-edit-html.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bodyPath = path.join(ROOT, 'public', 'admin-tenant-world-edit-body.html');
const outPath = path.join(ROOT, 'public', 'admin-tenant-world-edit.html');

const body = fs
    .readFileSync(bodyPath, 'utf8')
    .replace(
        'class="admin-panel admin-panel-world-edit"',
        'class="admin-panel admin-panel-world-edit active"'
    );

const importMapJson = fs
    .readFileSync(path.join(ROOT, 'public', 'js', 'world-edit-importmap.json'), 'utf8')
    .trim();

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tenant ワールド編集</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
    <link rel="stylesheet" href="/metaverse-simple-static/css/setting.css">
    <link rel="stylesheet" href="/css/admin-tenant-world-edit.css">
    <script type="importmap">${importMapJson}</script>
</head>
<body>
    <div id="admin-chart-save-toast" class="admin-chart-save-toast" role="status" aria-live="polite" hidden></div>
    <main class="admin-main">
        <div class="header-actions" id="world-edit-topbar-actions">
            <button type="button" class="btn btn-icon" id="admin-theme-toggle" title="ダークモードに切替"><i class="bi bi-moon-fill" id="admin-theme-icon"></i></button>
            <button type="button" class="btn btn-icon" id="admin-cache-hard-reload" title="Service Worker・Cache Storage・ワールド編集のローカルキャッシュを削除し、ページを再読み込みします" aria-label="キャッシュを削除して再読み込み"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i></button>
            <a class="btn btn-secondary" id="back-to-metaverse" href="#">メタバースへ入る</a>
        </div>
        <div class="admin-panels">
${body}
        </div>
    </main>
    <div id="fds-smoke-panel-crosshair" class="fds-smoke-panel-crosshair" hidden aria-hidden="true"></div>
    <script src="/js/admin-url-sanitize.js"></script>
    <script type="module" src="/js/tenant-world-edit-bootstrap.js"></script>
    <script type="module" src="/js/admin-tenant-world-edit.js"></script>
</body>
</html>
`;

fs.writeFileSync(outPath, html, 'utf8');
console.log(`[build] wrote ${outPath} (${html.length} bytes)`);

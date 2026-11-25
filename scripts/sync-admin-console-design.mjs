// scripts/sync-admin-console-design.mjs — docs/design/admin-console → public/admin-console
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'docs', 'design', 'admin-console');
const DST = path.join(ROOT, 'public', 'admin-console');

const COPY = [
    'colors_and_type.css',
    'mt.css',
    'mt-editor.css',
    'mt-addons.css',
    'mt-data.js',
    'mt-ui.js',
    'mt-views.js',
    'mt-addons.js',
    'mt-editor.js',
    'mt-world.js',
    'mt-editor-state.js',
    'mt-app.js',
];

for (const name of COPY) {
    let text = fs.readFileSync(path.join(SRC, name), 'utf8');
    if (name === 'mt-app.js') {
        text = text.replace(
            /\/\* =+ 認証 =+ \*\/[\s\S]*?else setTimeout\(\(\) => \$\("#gUser"\)\.focus\(\), 60\);/,
            `/* ================= 認証（HTTP Basic / mt-app-boot.js） ================= */
  const gate = $("#gate"), app = $("#app");
  function enter() {
    state.authed = true;
    if (gate) gate.hidden = true;
    if (app) app.hidden = false;
    if (!state.logs.length) resetLogs();
    render();
    startLive();
    hookEditorEvents();
  }
  window.MT.enter = enter;
  const gateForm = $("#gateForm");
  if (gateForm) {
    gateForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const errEl = $("#gateErr");
      if (errEl) errEl.textContent = "フォームログインは無効です。ブラウザの HTTP Basic 認証を使用してください。";
    });
  }`
        );
        text = text.replaceAll('assets/icon-192.png', '/console/assets/icon-192.png');
    }
    if (name.endsWith('.css')) {
        text = text.replaceAll('assets/icon-192.png', '/console/assets/icon-192.png');
    }
    fs.writeFileSync(path.join(DST, name), text);
}

const iconSrc = path.join(ROOT, 'public', 'css', 'mt-console', 'assets', 'icon-192.png');
const iconDst = path.join(DST, 'assets', 'icon-192.png');
fs.mkdirSync(path.dirname(iconDst), { recursive: true });
fs.copyFileSync(iconSrc, iconDst);

console.log('[sync-admin-console-design] copied', COPY.length, 'files to public/admin-console');
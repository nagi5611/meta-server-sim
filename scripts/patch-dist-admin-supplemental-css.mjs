// scripts/patch-dist-admin-supplemental-css.mjs — ensure dist admin HTML loads /css/admin.css (sim-specific rules)
import fs from 'node:fs';
import path from 'node:path';

const SUPPLEMENTAL = '<link rel="stylesheet" href="/css/admin.css">';
const MARKER = '/metaverse-simple-static/css/admin.css';

const distDir = path.join(process.cwd(), 'dist');
const targets = ['admin.html', 'admin-tenant.html'];

for (const name of targets) {
    const filePath = path.join(distDir, name);
    if (!fs.existsSync(filePath)) continue;
    let html = fs.readFileSync(filePath, 'utf8');
    if (html.includes(SUPPLEMENTAL)) continue;
    const needle = `<link rel="stylesheet" href="${MARKER}">`;
    if (!html.includes(needle)) {
        console.warn(`patch-dist-admin-supplemental-css: skip ${name} (marker not found)`);
        continue;
    }
    html = html.replace(needle, `${needle}\n    ${SUPPLEMENTAL}`);
    fs.writeFileSync(filePath, html);
    console.log(`patch-dist-admin-supplemental-css: patched ${name}`);
}

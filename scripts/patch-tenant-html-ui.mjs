// scripts/patch-tenant-html-ui.mjs — index.html からテナント UI マークアップを移植
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const indexPath = path.resolve(projectRoot, '..', 'metaverse-simple', 'public', 'index.html');
const tenantPath = path.join(projectRoot, 'public', 'tenant.html');

const index = fs.readFileSync(indexPath, 'utf8');
const start = index.indexOf('<!-- Chat Container -->');
const mobileStart = index.indexOf('<!-- モバイル用コントロール');
const mobileEnd = index.indexOf('<!-- モバイル Easy 飛行機');
if (start < 0 || mobileStart < 0 || mobileEnd < 0) {
    console.error('markers not found in index.html');
    process.exit(1);
}
const uiBlock = index.slice(start, mobileEnd);

let tenant = fs.readFileSync(tenantPath, 'utf8');
const marker = '    <canvas id="canvas"></canvas>';
if (tenant.includes('id="menu-bar"')) {
    console.log('tenant.html already has menu-bar');
    process.exit(0);
}
tenant = tenant.replace(marker, `${uiBlock}\n${marker}\n`);
fs.writeFileSync(tenantPath, tenant);
console.log('tenant.html patched');

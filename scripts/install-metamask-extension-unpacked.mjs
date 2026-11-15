#!/usr/bin/env node
/**
 * Download official MetaMask chrome zip from GitHub releases and unzip for METAMASK_EXTENSION_PATH.
 *
 * Usage:
 *   node scripts/install-metamask-extension-unpacked.mjs [destDir] [versionTag]
 *
 * Default dest: ../metamask-chrome-unpacked (sibling of repo) or METAMASK_INSTALL_DEST
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const destDir =
    process.argv[2] ||
    process.env.METAMASK_INSTALL_DEST ||
    path.resolve(repoRoot, '..', 'metamask-chrome-unpacked');
const versionTag = process.argv[3] || process.env.METAMASK_VERSION || 'v13.56.0';
const zipName = `metamask-chrome-${versionTag.replace(/^v/, '')}.zip`;
const downloadUrl = `https://github.com/MetaMask/metamask-extension/releases/download/${versionTag}/${zipName}`;

fs.mkdirSync(destDir, { recursive: true });
const zipPath = path.join(destDir, zipName);

console.error(`[metamask-install] downloading ${downloadUrl}`);
execFileSync('curl', ['-fL', '-o', zipPath, downloadUrl], { stdio: 'inherit' });

console.error(`[metamask-install] unzip → ${destDir}`);
execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'inherit' });

const manifest = path.join(destDir, 'manifest.json');
if (!fs.existsSync(manifest)) {
    const children = fs.readdirSync(destDir, { withFileTypes: true });
    const sub = children.find((d) => d.isDirectory() && fs.existsSync(path.join(destDir, d.name, 'manifest.json')));
    if (sub) {
        const nested = path.join(destDir, sub.name);
        console.log(JSON.stringify({ ok: true, extensionPath: nested, note: 'nested unzip dir' }, null, 2));
        process.exit(0);
    }
    throw new Error(`manifest.json not found under ${destDir}`);
}

console.log(JSON.stringify({ ok: true, extensionPath: destDir, downloadUrl }, null, 2));

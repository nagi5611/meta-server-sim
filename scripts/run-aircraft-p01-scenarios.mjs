#!/usr/bin/env node
// scripts/run-aircraft-p01-scenarios.mjs — P-01 シナリオを順に実行
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['p01-straight.json', 'p01-yaw-right.json', 'p01-climb.json', 'p01-combo.json'];

for (const f of files) {
    const scenario = path.join(root, 'scenarios', 'aircraft', f);
    const code = await new Promise((resolve) => {
        const child = spawn(process.execPath, ['scripts/aircraft-scenario.mjs', scenario], {
            cwd: root,
            stdio: 'inherit',
            env: process.env,
        });
        child.on('exit', (c) => resolve(c ?? 1));
    });
    if (code !== 0) process.exit(code);
}
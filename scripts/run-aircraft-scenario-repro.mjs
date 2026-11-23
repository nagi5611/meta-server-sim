#!/usr/bin/env node
// scripts/run-aircraft-scenario-repro.mjs — 各シナリオを N 回連続実行し再現性を検証
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = process.env.AIRCRAFT_SCENARIO_ARTIFACTS || '/opt/cursor/artifacts';
const RUNS = Number(process.env.AIRCRAFT_SCENARIO_RUNS || 3);
const BASE = process.env.E2E_BASE_URL || 'https://sim.mmh-virtual.jp';

const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : [
          'p01-straight.json',
          'p01-yaw-right.json',
          'p01-climb.json',
          'p01-combo.json',
          'p01-b787-straight.json',
          'p01-b787-yaw-right.json',
          'p01-b787-climb.json',
      ];

/** @type {Record<string, { runs: { pass: boolean, reportPath: string }[] }>} */
const summary = {};

for (const f of files) {
    const scenario = path.join(root, 'scenarios', 'aircraft', f);
    summary[f] = { runs: [] };
    for (let i = 1; i <= RUNS; i++) {
        const out = path.join(ART, `repro-${f.replace('.json', '')}-run${i}.json`);
        const code = await new Promise((resolve) => {
            const child = spawn(
                process.execPath,
                ['scripts/aircraft-scenario.mjs', scenario, '--out', out],
                { cwd: root, stdio: 'inherit', env: { ...process.env, E2E_BASE_URL: BASE } },
            );
            child.on('exit', (c) => resolve(c ?? 1));
        });
        let pass = code === 0;
        try {
            const report = JSON.parse(await fs.readFile(out, 'utf8'));
            pass = Boolean(report.pass);
        } catch {
            pass = false;
        }
        summary[f].runs.push({ pass, reportPath: out });
        if (!pass) {
            console.error(`FAIL: ${f} run ${i}`);
            await fs.writeFile(
                path.join(ART, 'aircraft-scenario-repro-summary.json'),
                `${JSON.stringify(summary, null, 2)}\n`,
            );
            process.exit(1);
        }
    }
}

const outPath = path.join(ART, 'aircraft-scenario-repro-summary.json');
await fs.writeFile(outPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, outPath, files: Object.keys(summary) }, null, 2));
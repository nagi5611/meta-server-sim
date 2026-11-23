#!/usr/bin/env node
/**
 * 固定 Δt 計測 JSON 群から p01-b787-straight の deltaPosition 期待値を中央値で更新（許容 ±20%）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCENARIO_PATH = path.join(ROOT, 'scenarios/aircraft/p01-b787-straight.json');

/**
 * @param {number[]} values
 */
function median(values) {
    if (!values.length) return 0;
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const reportPaths = process.argv.slice(2).filter((p) => p.endsWith('.json'));
if (reportPaths.length < 3) {
    console.error('Need at least 3 report JSON paths');
    process.exit(2);
}

/** @type {{x:number,y:number,z:number}[]} */
const deltas = [];
for (const rp of reportPaths) {
    const d = JSON.parse(fs.readFileSync(rp, 'utf8'));
    const samples = d.samples;
    if (!Array.isArray(samples) || samples.length < 2) {
        console.error(`skip (no samples): ${rp}`);
        continue;
    }
  if (d.errors?.length) {
    console.error(`skip (errors): ${rp}`, d.errors);
    continue;
  }
    const p0 = samples[0].position;
    const p1 = samples[samples.length - 1].position;
    deltas.push({ x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z });
}

if (deltas.length < 3) {
    console.error('Fewer than 3 valid deltas');
    process.exit(1);
}

const mx = median(deltas.map((d) => d.x));
const my = median(deltas.map((d) => d.y));
const mz = median(deltas.map((d) => d.z));
const mag = Math.hypot(mx, my, mz);
const toleranceM = Math.max(0.5, mag * 0.2);

const round2 = (n) => Math.round(n * 100) / 100;
const scenario = JSON.parse(fs.readFileSync(SCENARIO_PATH, 'utf8'));
scenario.checkpoints = [
    {
        atTimeSec: scenario.steps.reduce((a, s) => a + s.durationSec, 0),
        expect: {
            deltaPosition: { x: round2(mx), y: round2(my), z: round2(mz) },
        },
        tolerance: { positionM: round2(toleranceM) },
    },
];

fs.writeFileSync(SCENARIO_PATH, `${JSON.stringify(scenario, null, 2)}\n`);
console.log(
    JSON.stringify(
        {
            reports: deltas.length,
            median: { x: mx, y: my, z: mz },
            toleranceM,
            scenarioPath: SCENARIO_PATH,
        },
        null,
        2
    )
);
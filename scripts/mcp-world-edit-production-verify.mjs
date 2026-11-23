#!/usr/bin/env node
/**
 * 本番 MCP スモーク（サーバー上で実行）。ADMIN_PASSWORD は .env から読む。
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

if (!process.env.WORLD_EDIT_MCP_BASE_URL) {
    process.env.WORLD_EDIT_MCP_BASE_URL = 'https://sim.mmh-virtual.jp';
}
if (!process.env.WORLD_EDIT_MCP_TENANT_ID) {
    process.env.WORLD_EDIT_MCP_TENANT_ID = 'P-01';
}
if (!process.env.AIRCRAFT_SCENARIO_BASE_URL) {
    process.env.AIRCRAFT_SCENARIO_BASE_URL = 'https://sim.mmh-virtual.jp';
}

import {
    resetWorldEditAdminClientForTests,
    worldEditListWorldsForMcp,
    worldEditPlaceModelForMcp,
    worldEditDeleteObjectForMcp,
    aircraftRunScenarioForMcp,
    aircraftListAirframesForMcp,
} from '../lib/world-edit-mcp-ops.js';

const ARTIFACTS = '/opt/cursor/artifacts';
const report = {
    startedAt: new Date().toISOString(),
    steps: [],
};

function step(name, ok, detail) {
    report.steps.push({ name, ok, detail });
}

async function main() {
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    resetWorldEditAdminClientForTests();

    try {
        const worlds = await worldEditListWorldsForMcp();
        step('world_edit_list_worlds', true, worlds);
    } catch (e) {
        step('world_edit_list_worlds', false, String(e));
        throw e;
    }

    try {
        const frames = await aircraftListAirframesForMcp();
        step('aircraft_list_airframes', true, { count: frames.airframes?.length });
    } catch (e) {
        step('aircraft_list_airframes', false, String(e));
    }

    const worldId = 'school';
    const position = { x: 888.777, y: 2, z: 888.777 };
    let objectIndex = -1;
    try {
        const placed = await worldEditPlaceModelForMcp(worldId, 'models/monument.glb', {
            position,
            scale: { x: 0.01, y: 0.01, z: 0.01 },
            verify: true,
        });
        objectIndex = placed.objectIndex;
        step('world_edit_place_model', placed.verified?.positionMatches === true, {
            objectIndex,
            snapshot: placed.snapshot?.path,
            verified: placed.verified,
        });
    } catch (e) {
        step('world_edit_place_model', false, String(e));
    }

    if (objectIndex >= 0) {
        try {
            await worldEditDeleteObjectForMcp(worldId, objectIndex);
            step('world_edit_delete_object', true, { objectIndex });
        } catch (e) {
            step('world_edit_delete_object', false, String(e));
        }
    }

    let attempts = 0;
    let passed = false;
    let lastReport = null;
    const scenarioPath = path.join(ROOT, 'scenarios/aircraft/p01-straight.json');
    while (attempts < 3 && !passed) {
        attempts += 1;
        try {
            lastReport = await aircraftRunScenarioForMcp(scenarioPath, {
                baseUrl: process.env.AIRCRAFT_SCENARIO_BASE_URL,
                tenantId: 'P-01',
            });
            passed = !!lastReport.pass;
            step(`aircraft_run_scenario_attempt_${attempts}`, passed, {
                pass: lastReport.pass,
                reportPath: lastReport.reportPath,
                failures: lastReport.checkpointFailures,
            });
        } catch (e) {
            step(`aircraft_run_scenario_attempt_${attempts}`, false, String(e));
        }
    }

    report.finishedAt = new Date().toISOString();
    report.aircraftLoop = { attempts, passed };
    const out = path.join(ARTIFACTS, `mcp-world-edit-production-verify-${Date.now()}.json`);
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ reportPath: out, passed: report.steps.every((s) => s.ok) }, null, 2));
    process.exit(report.steps.every((s) => s.ok) ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
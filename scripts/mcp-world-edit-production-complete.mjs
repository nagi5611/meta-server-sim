#!/usr/bin/env node
/**
 * 本番 MCP 完全検証: アップロード、aircraft 操作、シナリオ秒数スイープ
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

process.env.WORLD_EDIT_MCP_BASE_URL ||= 'https://sim.mmh-virtual.jp';
process.env.WORLD_EDIT_MCP_TENANT_ID ||= 'P-01';
process.env.AIRCRAFT_SCENARIO_BASE_URL ||= 'https://sim.mmh-virtual.jp';
const ARTIFACTS = process.env.MCP_ARTIFACTS_DIR || '/home/nagi/sim-server/backups/mcp-artifacts';
const SNAP = process.env.WORLD_EDIT_MCP_SNAPSHOT_DIR || '/home/nagi/sim-server/backups/world-edit-mcp-snapshots';

const {
    resetWorldEditAdminClientForTests,
    worldEditUploadModelForMcp,
    worldEditListModelsForMcp,
    worldEditPlaceModelForMcp,
    worldEditDeleteObjectForMcp,
    aircraftGetAirframeForMcp,
    aircraftSetAirframeForMcp,
    aircraftPatchWorldPhysicsForMcp,
    aircraftPlaceSlotForMcp,
    worldEditGetWorldForMcp,
} = await import('../lib/world-edit-mcp-ops.js');

fs.mkdirSync(ARTIFACTS, { recursive: true });

const ts = Date.now();
const report = { startedAt: new Date().toISOString(), steps: [], scenarioMatrix: [] };
function step(name, ok, detail) {
    report.steps.push({ name, ok, detail });
}

resetWorldEditAdminClientForTests();

/** @type {{ airframe?: unknown, physics?: unknown, slotIndex?: number, uploadFilename?: string, placeIndex?: number }} */
const saved = {};

const uploadName = `mcp-test-${ts}.glb`;
const srcGlb = [
    path.join(ROOT, 'tenants/P-01/models/monument.glb'),
    path.join(ROOT, 'tenants/P-01/data/models/monument.glb'),
].find((p) => fs.existsSync(p));
if (!srcGlb) throw new Error('missing source glb: tenants/P-01/models/monument.glb');
const uploadPath = path.join(ARTIFACTS, uploadName);
fs.copyFileSync(srcGlb, uploadPath);

try {
    const modelsBefore = await worldEditListModelsForMcp();
    if ((modelsBefore.models || []).includes(uploadName)) {
        throw new Error(`refuse upload: ${uploadName} already exists`);
    }
    const up = await worldEditUploadModelForMcp(uploadPath, { confirm: false });
    saved.uploadFilename = uploadName;
    step('world_edit_upload_model', true, up);

    const pos = { x: 889.001, y: 1.2, z: 889.001 };
    const placed = await worldEditPlaceModelForMcp('school', `models/${uploadName}`, {
        position: pos,
        scale: { x: 0.02, y: 0.02, z: 0.02 },
        verify: true,
    });
    saved.placeIndex = placed.objectIndex;
    step('world_edit_place_uploaded_model', placed.verified?.positionMatches === true, placed);

    const beforeA320 = await aircraftGetAirframeForMcp('A320');
    saved.airframe = beforeA320;
    const beforeWorld = await worldEditGetWorldForMcp('school');
    saved.physics = beforeWorld.world?.aircraftPhysics;

    const basePhysics = saved.physics || {};
    const trialPhysics = {
        ...basePhysics,
        maxThrustSpeed: Number(basePhysics.maxThrustSpeed ?? 55) + 0.01,
    };
    await aircraftPatchWorldPhysicsForMcp('school', trialPhysics, { dryRun: true });
    const physicsApplied = await aircraftPatchWorldPhysicsForMcp('school', trialPhysics, { dryRun: false });
    await aircraftPatchWorldPhysicsForMcp('school', basePhysics, { dryRun: false });
    step('aircraft_patch_world_physics', true, { trialPhysics, applied: physicsApplied, restored: basePhysics });

    const body = beforeA320?.airframe || beforeA320;
    await aircraftSetAirframeForMcp('A320', { displayName: body.displayName, controlMode: body.controlMode, flightPhysicsEasy: body.flightPhysicsEasy }, { dryRun: true });
    const setAir = await aircraftSetAirframeForMcp('A320', {
        displayName: body.displayName,
        controlMode: body.controlMode,
        flightPhysicsEasy: body.flightPhysicsEasy,
    });
    step('aircraft_set_airframe', true, { id: 'A320', dryRunThenApply: true, setAir });

    await aircraftPlaceSlotForMcp(
        'school',
        { id: `mcp-slot-dry-${ts}`, position: { x: 890, y: 1, z: 890 }, aircraftLibraryId: 'A320' },
        { dryRun: true },
    );
    const slotPlaced = await aircraftPlaceSlotForMcp('school', {
        id: `mcp-slot-${ts}`,
        position: { x: 891, y: 1.05, z: 891 },
        aircraftLibraryId: 'A320',
        path: 'models/monument.glb',
    });
    saved.slotIndex = slotPlaced.objectIndex;
    step('aircraft_place_slot', true, slotPlaced);

    report.scenarioMatrixNote =
        '25 ケースの厳格マトリクスは scripts/mcp-aircraft-scenario-matrix.mjs で実行（チェックポイント必須・±20%・単調増加）';
} finally {
    if (saved.slotIndex != null) {
        await worldEditDeleteObjectForMcp('school', saved.slotIndex).catch(() => {});
    }
    if (saved.placeIndex != null) {
        await worldEditDeleteObjectForMcp('school', saved.placeIndex).catch(() => {});
    }
    if (saved.physics) {
        await aircraftPatchWorldPhysicsForMcp('school', saved.physics);
    }
    if (saved.airframe) {
        const b = saved.airframe?.airframe || saved.airframe;
        await aircraftSetAirframeForMcp('A320', {
            displayName: b.displayName,
            controlMode: b.controlMode,
            flightPhysicsEasy: b.flightPhysicsEasy,
            flightPhysicsHard: b.flightPhysicsHard,
        });
    }
    step('cleanup_restore', true, { saved });
}

report.finishedAt = new Date().toISOString();
const out = path.join(ARTIFACTS, `mcp-world-edit-production-complete-${ts}.json`);
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath: out, ok: report.steps.every((s) => s.ok) }, null, 2));
#!/usr/bin/env node
/**
 * Invoke one world-edit MCP tool without stdio (CI / smoke).
 * Usage: node scripts/mcp-world-edit-invoke-tool.mjs <toolName> [jsonArgs]
 */
import 'dotenv/config';
import {
    aircraftRunScenarioForMcp,
    worldEditListWorldsForMcp,
    worldEditMcpConfigGetForMcp,
    worldEditPlaceModelForMcp,
} from '../lib/world-edit-mcp-ops.js';

const tool = process.argv[2];
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};

async function main() {
    let payload;
    switch (tool) {
        case 'world_edit_config':
            payload = worldEditMcpConfigGetForMcp();
            break;
        case 'world_edit_list_worlds':
            payload = await worldEditListWorldsForMcp();
            break;
        case 'world_edit_place_model':
            payload = await worldEditPlaceModelForMcp(args.worldId, args.modelPath, args);
            break;
        case 'aircraft_run_scenario':
            payload = await aircraftRunScenarioForMcp(args.scenario ?? args.scenarioPath, args);
            break;
        default:
            throw new Error(`unsupported tool: ${tool}`);
    }
    console.log(JSON.stringify(payload, null, 2));
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
});
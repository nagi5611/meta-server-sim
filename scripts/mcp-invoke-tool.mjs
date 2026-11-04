#!/usr/bin/env node
/**
 * Invoke one MCP tool handler logic without stdio (deploy / CI smoke).
 * Usage: node scripts/mcp-invoke-tool.mjs <toolName> [jsonArgs]
 */
import {
    fleetGetAddonEnv,
    getFleetOpsMeta,
    getFleetServiceStatus,
    isFleetOpsEnabled,
} from '../lib/platform-fleet-ops.js';
import {
    platformEnvConfigGetForMcp,
    tenantPluginsListForMcp,
} from '../lib/platform-admin-mcp-ops.js';

const tool = process.argv[2];
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};

async function main() {
    let payload;
    switch (tool) {
        case 'fleet_list_cores':
            if (!isFleetOpsEnabled()) throw new Error('fleet ops disabled');
            payload = getFleetOpsMeta();
            break;
        case 'fleet_service_status':
            payload = await getFleetServiceStatus(String(args.coreId || 'metasim'));
            break;
        case 'fleet_addon_env_get':
            payload = await fleetGetAddonEnv(String(args.coreId || 'metasim'));
            break;
        case 'platform_env_config_get':
            payload = platformEnvConfigGetForMcp();
            break;
        case 'tenant_plugins_list':
            payload = tenantPluginsListForMcp(String(args.tenantId || 'P-01'));
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

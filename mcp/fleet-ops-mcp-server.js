#!/usr/bin/env node
/**
 * MetaSim Fleet Ops MCP server (stdio).
 * Exposes systemd + cross-core .env tools for Cursor / MCP clients.
 *
 * Env:
 *   PLATFORM_FLEET_REGISTRY_PATH — fleet-registry.json
 *   PLATFORM_FLEET_SYSTEMCTL_WRAPPER — platform-fleet-systemctl.sh
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
    controlFleetService,
    fleetGetEnv,
    fleetSetEnv,
    fleetGetAddonEnv,
    fleetSetAddonEnv,
    getFleetOpsMeta,
    getFleetServiceStatus,
    isFleetOpsEnabled,
} from '../lib/platform-fleet-ops.js';
import {
    platformEnvConfigGetForMcp,
    platformEnvConfigSetForMcp,
    tenantPluginsListForMcp,
    tenantPluginSetEnabledForMcp,
    tenantPluginConfigGetForMcp,
    tenantPluginConfigSetForMcp,
} from '../lib/platform-admin-mcp-ops.js';

const server = new Server(
    {
        name: 'metasim-fleet-ops',
        version: '1.1.0',
    },
    {
        capabilities: {
            tools: {},
        },
    },
);

const TOOLS = [
    {
        name: 'fleet_list_cores',
        description:
            'List registered meta family cores (meta, metair, metasim, metapre, metadogo) with systemd units and env paths.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'fleet_service_status',
        description: 'Get systemd status for a core id.',
        inputSchema: {
            type: 'object',
            properties: { coreId: { type: 'string' } },
            required: ['coreId'],
        },
    },
    {
        name: 'fleet_service_control',
        description: 'start, stop, or restart a core systemd service.',
        inputSchema: {
            type: 'object',
            properties: {
                coreId: { type: 'string' },
                action: { type: 'string', enum: ['start', 'stop', 'restart'] },
            },
            required: ['coreId', 'action'],
        },
    },
    {
        name: 'fleet_env_get',
        description:
            'Read editable env keys (PORT, MEDIASOUP_*, RTC ports, PROXY_*) for a core.',
        inputSchema: {
            type: 'object',
            properties: { coreId: { type: 'string' } },
            required: ['coreId'],
        },
    },
    {
        name: 'fleet_env_set',
        description:
            'Update whitelisted .env keys for a core. Requires restart for most keys to take effect.',
        inputSchema: {
            type: 'object',
            properties: {
                coreId: { type: 'string' },
                updates: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['coreId', 'updates'],
        },
    },
    {
        name: 'fleet_addon_env_get',
        description:
            'Read ADDON_* and TENANT_*_ADDON_* keys from a core .env (追加編集点: plugin env overlay).',
        inputSchema: {
            type: 'object',
            properties: { coreId: { type: 'string' } },
            required: ['coreId'],
        },
    },
    {
        name: 'fleet_addon_env_set',
        description:
            'Update ADDON_* / TENANT_*_ADDON_* keys in core .env. Restart core after change.',
        inputSchema: {
            type: 'object',
            properties: {
                coreId: { type: 'string' },
                updates: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['coreId', 'updates'],
        },
    },
    {
        name: 'platform_env_config_get',
        description:
            'Read MetaSim platform env-config.json editable keys (管理画面 env-config と同じ追加編集点).',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'platform_env_config_set',
        description:
            'Update env-config.json values (non-locked, non-secret). Returns requiresRestart keys.',
        inputSchema: {
            type: 'object',
            properties: {
                updates: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['updates'],
        },
    },
    {
        name: 'tenant_plugins_list',
        description: 'List tenant plugins with enable state for admin (tenantId e.g. P-01).',
        inputSchema: {
            type: 'object',
            properties: { tenantId: { type: 'string' } },
            required: ['tenantId'],
        },
    },
    {
        name: 'tenant_plugin_set_enabled',
        description: 'Enable or disable a tenant plugin. Reload/restart required to apply hooks.',
        inputSchema: {
            type: 'object',
            properties: {
                tenantId: { type: 'string' },
                pluginId: { type: 'string' },
                enabled: { type: 'boolean' },
            },
            required: ['tenantId', 'pluginId', 'enabled'],
        },
    },
    {
        name: 'tenant_plugin_config_get',
        description: 'Read plugin config KV from tenant_plugins.db for a tenant/plugin.',
        inputSchema: {
            type: 'object',
            properties: {
                tenantId: { type: 'string' },
                pluginId: { type: 'string' },
            },
            required: ['tenantId', 'pluginId'],
        },
    },
    {
        name: 'tenant_plugin_config_set',
        description: 'Write plugin config KV (DB). Reload/restart required.',
        inputSchema: {
            type: 'object',
            properties: {
                tenantId: { type: 'string' },
                pluginId: { type: 'string' },
                updates: { type: 'object', additionalProperties: { type: 'string' } },
            },
            required: ['tenantId', 'pluginId', 'updates'],
        },
    },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const fleetOnly = name.startsWith('fleet_');
    if (fleetOnly && !isFleetOpsEnabled()) {
        return {
            content: [{ type: 'text', text: 'Fleet ops disabled or empty registry.' }],
            isError: true,
        };
    }

    try {
        let payload;
        switch (name) {
            case 'fleet_list_cores':
                payload = getFleetOpsMeta();
                break;
            case 'fleet_service_status':
                payload = await getFleetServiceStatus(String(args?.coreId ?? ''));
                break;
            case 'fleet_service_control':
                payload = await controlFleetService(
                    String(args?.coreId ?? ''),
                    /** @type {'start'|'stop'|'restart'} */ (String(args?.action ?? '')),
                );
                break;
            case 'fleet_env_get':
                payload = await fleetGetEnv(String(args?.coreId ?? ''));
                break;
            case 'fleet_env_set':
                payload = await fleetSetEnv(String(args?.coreId ?? ''), args?.updates ?? {});
                break;
            case 'fleet_addon_env_get':
                payload = await fleetGetAddonEnv(String(args?.coreId ?? ''));
                break;
            case 'fleet_addon_env_set':
                payload = await fleetSetAddonEnv(String(args?.coreId ?? ''), args?.updates ?? {});
                break;
            case 'platform_env_config_get':
                payload = platformEnvConfigGetForMcp();
                break;
            case 'platform_env_config_set':
                payload = platformEnvConfigSetForMcp(args?.updates ?? {});
                break;
            case 'tenant_plugins_list':
                payload = tenantPluginsListForMcp(String(args?.tenantId ?? ''));
                break;
            case 'tenant_plugin_set_enabled':
                payload = tenantPluginSetEnabledForMcp(
                    String(args?.tenantId ?? ''),
                    String(args?.pluginId ?? ''),
                    !!args?.enabled,
                );
                break;
            case 'tenant_plugin_config_get':
                payload = tenantPluginConfigGetForMcp(
                    String(args?.tenantId ?? ''),
                    String(args?.pluginId ?? ''),
                );
                break;
            case 'tenant_plugin_config_set':
                payload = tenantPluginConfigSetForMcp(
                    String(args?.tenantId ?? ''),
                    String(args?.pluginId ?? ''),
                    args?.updates ?? {},
                );
                break;
            default:
                throw new Error(`unknown tool: ${name}`);
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        };
    } catch (e) {
        return {
            content: [
                {
                    type: 'text',
                    text: e instanceof Error ? e.message : String(e),
                },
            ],
            isError: true,
        };
    }
});

const transport = new StdioServerTransport();
await server.connect(transport);

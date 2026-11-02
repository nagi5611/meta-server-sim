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
    getFleetOpsMeta,
    getFleetServiceStatus,
    isFleetOpsEnabled,
} from '../lib/platform-fleet-ops.js';

const server = new Server(
    {
        name: 'metasim-fleet-ops',
        version: '1.0.0',
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
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!isFleetOpsEnabled()) {
        return {
            content: [{ type: 'text', text: 'Fleet ops disabled or empty registry.' }],
            isError: true,
        };
    }

    const { name, arguments: args } = request.params;
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

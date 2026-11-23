#!/usr/bin/env node
import 'dotenv/config';
import { resolveAdminCredentials } from '../lib/admin-auth.js';
import { WorldEditAdminHttpClient } from '../lib/world-edit-mcp-admin-http.js';
import { getWorldEditMcpConfig } from '../lib/world-edit-mcp-config.js';

const cfg = getWorldEditMcpConfig();
const { username, password } = resolveAdminCredentials();
const client = new WorldEditAdminHttpClient({
    baseUrl: cfg.baseUrl,
    username,
    password,
    tenantId: cfg.tenantId,
});

await client.refreshCsrf();
const cookieNames = Object.keys(client.cookies);
const worlds = await client.getWorlds();
const worldId = worlds.school ? 'school' : Object.keys(worlds)[0];
const world = worlds[worldId];
const models = Array.isArray(world.models) ? world.models : [];

const res = await client.patchWorld(worldId, { models });
console.log(
    JSON.stringify(
        {
            ok: true,
            cookieNames,
            csrfTokenLen: client.csrfToken.length,
            worldId,
            modelCount: models.length,
            patchResult: res,
        },
        null,
        2,
    ),
);
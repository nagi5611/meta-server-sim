// lib/world-edit-mcp-config.js — MCP ワールド編集の接続設定（環境変数）

/**
 * @returns {{
 *   baseUrl: string,
 *   tenantId: string,
 *   username: string,
 *   password: string,
 *   snapshotDir: string,
 *   allowProductionWrites: boolean,
 *   scenarioBaseUrl: string,
 * }}
 */
export function getWorldEditMcpConfig() {
    const baseUrl = String(
        process.env.WORLD_EDIT_MCP_BASE_URL ||
            process.env.BROWSER_METAMASK_BASE_URL ||
            'http://127.0.0.1:3002',
    )
        .trim()
        .replace(/\/$/, '');

    const tenantId = String(process.env.WORLD_EDIT_MCP_TENANT_ID || process.env.E2E_TENANT_ID || 'P-01').trim();

    const username = String(
        process.env.WORLD_EDIT_MCP_ADMIN_USERNAME || process.env.ADMIN_USERNAME || 'admin',
    ).trim();

    const password = String(
        process.env.WORLD_EDIT_MCP_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '',
    ).trim();

    const snapshotDir = String(
        process.env.WORLD_EDIT_MCP_SNAPSHOT_DIR || '/opt/cursor/artifacts/world-edit-snapshots',
    ).trim();

    const allowProductionWrites =
        String(process.env.WORLD_EDIT_MCP_ALLOW_WRITES || '1').trim().toLowerCase() !== '0';

    const scenarioBaseUrl = String(
        process.env.AIRCRAFT_SCENARIO_BASE_URL || process.env.E2E_BASE_URL || baseUrl.replace(/:3002$/, ':3003'),
    )
        .trim()
        .replace(/\/$/, '');

    return {
        baseUrl,
        tenantId,
        username,
        password,
        snapshotDir,
        allowProductionWrites,
        scenarioBaseUrl,
    };
}

/**
 * @param {() => { password: string }} [resolveCreds]
 * @returns {string}
 */
export function resolveWorldEditMcpPassword(resolveCreds) {
    const cfg = getWorldEditMcpConfig();
    if (cfg.password.length > 0) return cfg.password;
    if (resolveCreds) {
        const { password } = resolveCreds();
        if (password.length > 0) return password;
    }
    throw new Error(
        'WORLD_EDIT_MCP_ADMIN_PASSWORD or ADMIN_PASSWORD is required for admin HTTP API',
    );
}
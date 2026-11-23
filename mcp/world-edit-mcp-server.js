#!/usr/bin/env node
/**
 * MetaSim World Edit MCP server (stdio).
 * 管理画面ワールド編集と同じ HTTP Admin API を利用する。
 *
 * Env: WORLD_EDIT_MCP_BASE_URL, WORLD_EDIT_MCP_TENANT_ID,
 *      WORLD_EDIT_MCP_ADMIN_USERNAME, WORLD_EDIT_MCP_ADMIN_PASSWORD
 */
import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
    aircraftGetAirframeForMcp,
    aircraftListAirframesForMcp,
    aircraftPatchWorldPhysicsForMcp,
    aircraftPlaceSlotForMcp,
    aircraftRunScenarioForMcp,
    aircraftSetAirframeForMcp,
    worldEditAddObjectForMcp,
    worldEditDeleteObjectForMcp,
    worldEditGetObjectForMcp,
    worldEditGetWorldForMcp,
    worldEditListModelsForMcp,
    worldEditListObjectsForMcp,
    worldEditListObjectTypesForMcp,
    worldEditListSnapshotsForMcp,
    worldEditListWorldsForMcp,
    worldEditMcpConfigGetForMcp,
    worldEditPlaceModelForMcp,
    worldEditRestoreSnapshotForMcp,
    worldEditUpdateObjectForMcp,
    worldEditUploadModelForMcp,
} from '../lib/world-edit-mcp-ops.js';

const server = new Server(
    { name: 'metasim-world-edit', version: '1.0.0' },
    { capabilities: { tools: {} } },
);

const DRY_RUN = { type: 'boolean', description: 'true なら書き込みせずプレビューのみ' };

const TOOLS = [
    {
        name: 'world_edit_config',
        description: '接続先 URL・テナント ID・スナップショットディレクトリを表示。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'world_edit_list_worlds',
        description: 'テナントのワールド ID 一覧。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'world_edit_get_world',
        description: '1 ワールドの worlds.json オブジェクト全体を取得。',
        inputSchema: {
            type: 'object',
            properties: { worldId: { type: 'string' } },
            required: ['worldId'],
        },
    },
    {
        name: 'world_edit_list_object_types',
        description: '配置可能なオブジェクト種類とパラメータスキーマ。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'world_edit_list_objects',
        description: 'ワールド内 models[] の一覧（インデックス付き）。',
        inputSchema: {
            type: 'object',
            properties: { worldId: { type: 'string' } },
            required: ['worldId'],
        },
    },
    {
        name: 'world_edit_get_object',
        description: 'models[objectIndex] を取得。',
        inputSchema: {
            type: 'object',
            properties: { worldId: { type: 'string' }, objectIndex: { type: 'integer' } },
            required: ['worldId', 'objectIndex'],
        },
    },
    {
        name: 'world_edit_add_object',
        description: '種類 + パラメータで models に追加（保存は patch）。dry_run 可。',
        inputSchema: {
            type: 'object',
            properties: {
                worldId: { type: 'string' },
                type: { type: 'string', enum: ['model', 'teleporter', 'aircraft'] },
                params: { type: 'object' },
                dry_run: DRY_RUN,
            },
            required: ['worldId', 'type', 'params'],
        },
    },
    {
        name: 'world_edit_update_object',
        description: 'models[objectIndex] を部分更新。',
        inputSchema: {
            type: 'object',
            properties: {
                worldId: { type: 'string' },
                objectIndex: { type: 'integer' },
                patch: { type: 'object' },
                dry_run: DRY_RUN,
            },
            required: ['worldId', 'objectIndex', 'patch'],
        },
    },
    {
        name: 'world_edit_delete_object',
        description: 'models[objectIndex] を削除。',
        inputSchema: {
            type: 'object',
            properties: {
                worldId: { type: 'string' },
                objectIndex: { type: 'integer' },
                dry_run: DRY_RUN,
            },
            required: ['worldId', 'objectIndex'],
        },
    },
    {
        name: 'world_edit_place_model',
        description: 'GLB をワールドに配置し、必要なら位置一致を検証。',
        inputSchema: {
            type: 'object',
            properties: {
                worldId: { type: 'string' },
                modelPath: { type: 'string' },
                position: { type: 'object' },
                rotation: { type: 'object' },
                scale: {},
                verify: { type: 'boolean' },
                dry_run: DRY_RUN,
            },
            required: ['worldId', 'modelPath', 'position'],
        },
    },
    {
        name: 'world_edit_list_models',
        description: 'テナント利用可能なモデルファイル名一覧。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'world_edit_upload_model',
        description: 'ローカルファイルを POST /upload でアップロード（R2/ローカルはサーバー設定に従う）。',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string' },
                confirmOverwrite: { type: 'boolean' },
                dry_run: DRY_RUN,
            },
            required: ['filePath'],
        },
    },
    {
        name: 'world_edit_list_snapshots',
        description: '保存前に取った worlds スナップショット一覧。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'world_edit_restore_snapshot',
        description: 'スナップショット JSON から worlds 全体を復元。',
        inputSchema: {
            type: 'object',
            properties: { snapshotPath: { type: 'string' }, dry_run: DRY_RUN },
            required: ['snapshotPath'],
        },
    },
    {
        name: 'aircraft_list_airframes',
        description: '機体タグ（DB）一覧。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
        name: 'aircraft_get_airframe',
        description: '機体タグ 1 件（推力・旋回など flightPhysics 含む）。',
        inputSchema: {
            type: 'object',
            properties: { airframeId: { type: 'string' } },
            required: ['airframeId'],
        },
    },
    {
        name: 'aircraft_set_airframe',
        description: 'PUT /addons/aircraft/airframes/:id で機体パラメータ更新。',
        inputSchema: {
            type: 'object',
            properties: {
                airframeId: { type: 'string' },
                body: { type: 'object' },
                dry_run: DRY_RUN,
            },
            required: ['airframeId', 'body'],
        },
    },
    {
        name: 'aircraft_patch_world_physics',
        description: 'worlds.json の aircraftPhysics（ワールド共通）を patch。',
        inputSchema: {
            type: 'object',
            properties: {
                worldId: { type: 'string' },
                aircraftPhysics: { type: 'object' },
                dry_run: DRY_RUN,
            },
            required: ['worldId', 'aircraftPhysics'],
        },
    },
    {
        name: 'aircraft_place_slot',
        description: '飛行機スロット付きモデルをワールドに追加。',
        inputSchema: {
            type: 'object',
            properties: {
                worldId: { type: 'string' },
                slot: { type: 'object' },
                dry_run: DRY_RUN,
            },
            required: ['worldId', 'slot'],
        },
    },
    {
        name: 'aircraft_run_scenario',
        description:
            'bc-b0586736 / PR#102 形式の飛行シナリオをブラウザで再生し、位置・姿勢のズレをレポート（__tenantE2E.runAircraftScenario）。',
        inputSchema: {
            type: 'object',
            properties: {
                scenario: { type: 'object' },
                scenarioPath: { type: 'string' },
                baseUrl: { type: 'string' },
                tenantId: { type: 'string' },
                teleportNearSlot: { type: 'boolean' },
            },
            additionalProperties: false,
        },
    },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        let payload;
        const dryRun = !!args?.dry_run;
        switch (name) {
            case 'world_edit_config':
                payload = worldEditMcpConfigGetForMcp();
                break;
            case 'world_edit_list_worlds':
                payload = await worldEditListWorldsForMcp();
                break;
            case 'world_edit_get_world':
                payload = await worldEditGetWorldForMcp(String(args?.worldId ?? ''));
                break;
            case 'world_edit_list_object_types':
                payload = worldEditListObjectTypesForMcp();
                break;
            case 'world_edit_list_objects':
                payload = await worldEditListObjectsForMcp(String(args?.worldId ?? ''));
                break;
            case 'world_edit_get_object':
                payload = await worldEditGetObjectForMcp(
                    String(args?.worldId ?? ''),
                    Number(args?.objectIndex),
                );
                break;
            case 'world_edit_add_object':
                payload = await worldEditAddObjectForMcp(
                    String(args?.worldId ?? ''),
                    String(args?.type ?? ''),
                    args?.params ?? {},
                    { dryRun },
                );
                break;
            case 'world_edit_update_object':
                payload = await worldEditUpdateObjectForMcp(
                    String(args?.worldId ?? ''),
                    Number(args?.objectIndex),
                    args?.patch ?? {},
                    { dryRun },
                );
                break;
            case 'world_edit_delete_object':
                payload = await worldEditDeleteObjectForMcp(
                    String(args?.worldId ?? ''),
                    Number(args?.objectIndex),
                    { dryRun },
                );
                break;
            case 'world_edit_place_model':
                payload = await worldEditPlaceModelForMcp(
                    String(args?.worldId ?? ''),
                    String(args?.modelPath ?? ''),
                    {
                        position: args?.position,
                        rotation: args?.rotation,
                        scale: args?.scale,
                        dryRun,
                        verify: args?.verify !== false,
                    },
                );
                break;
            case 'world_edit_list_models':
                payload = await worldEditListModelsForMcp();
                break;
            case 'world_edit_upload_model':
                payload = await worldEditUploadModelForMcp(String(args?.filePath ?? ''), {
                    dryRun,
                    confirm: !!args?.confirmOverwrite,
                });
                break;
            case 'world_edit_list_snapshots':
                payload = worldEditListSnapshotsForMcp();
                break;
            case 'world_edit_restore_snapshot':
                payload = await worldEditRestoreSnapshotForMcp(String(args?.snapshotPath ?? ''), {
                    dryRun,
                });
                break;
            case 'aircraft_list_airframes':
                payload = await aircraftListAirframesForMcp();
                break;
            case 'aircraft_get_airframe':
                payload = await aircraftGetAirframeForMcp(String(args?.airframeId ?? ''));
                break;
            case 'aircraft_set_airframe':
                payload = await aircraftSetAirframeForMcp(
                    String(args?.airframeId ?? ''),
                    args?.body ?? {},
                    { dryRun },
                );
                break;
            case 'aircraft_patch_world_physics':
                payload = await aircraftPatchWorldPhysicsForMcp(
                    String(args?.worldId ?? ''),
                    args?.aircraftPhysics ?? {},
                    { dryRun },
                );
                break;
            case 'aircraft_place_slot':
                payload = await aircraftPlaceSlotForMcp(String(args?.worldId ?? ''), args?.slot ?? {}, {
                    dryRun,
                });
                break;
            case 'aircraft_run_scenario': {
                const scenarioOrPath = args?.scenario ?? args?.scenarioPath;
                if (!scenarioOrPath) throw new Error('scenario or scenarioPath required');
                payload = await aircraftRunScenarioForMcp(scenarioOrPath, {
                    baseUrl: args?.baseUrl,
                    tenantId: args?.tenantId,
                    teleportNearSlot: args?.teleportNearSlot,
                });
                break;
            }
            default:
                throw new Error(`unknown tool: ${name}`);
        }
        return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    } catch (e) {
        return {
            content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
            isError: true,
        };
    }
});

const transport = new StdioServerTransport();
await server.connect(transport);
// addons/matsuyama-flights/server/main.js — 松山空港発着（テナントプラグイン）
import { HOOKS } from '../../../lib/hook-registry.js';
import {
    DEFAULT_TIMETABLE_URL,
    fetchMatsuyamaAirportBoard,
} from '../lib/airport-timetable-client.js';
import { fetchBackupBoard } from '../lib/backup-board.js';
import { jstTodayYmd } from '../lib/flight-date-jst.js';

const LAYOUT_WARN_MSG =
    '[matsuyama-flights] ⚠️ 松山空港公式サイトのレイアウト変更を検知しました。ODPT/Jetstar バックアップに切り替えます。';

const FETCH_WARN_MSG =
    '[matsuyama-flights] ⚠️ 松山空港公式サイトの取得に失敗しました。ODPT/Jetstar バックアップに切り替えます。';

/**
 * @returns {import('../../../lib/hook-registry.js').HookRegistry['constructor'] extends never ? never : object}
 */
function emptyBoard() {
    return {
        ok: false,
        airport: 'MYJ',
        serviceDate: null,
        dataSource: null,
        layoutAlert: false,
        updatedAt: null,
        departures: [],
        arrivals: [],
        error: '初期化中',
    };
}

/** @type {Map<string, { cachedBoard: object, pollTimer: ReturnType<typeof setInterval>|null, resolvedAirportId: string|null }>} */
const tenantRuntime = new Map();

/**
 * @param {string} tenantId
 */
function getRuntime(tenantId) {
    let rt = tenantRuntime.get(tenantId);
    if (!rt) {
        rt = {
            cachedBoard: emptyBoard(),
            pollTimer: null,
            resolvedAirportId: null,
        };
        tenantRuntime.set(tenantId, rt);
    }
    return rt;
}

/**
 * @param {unknown} v
 * @param {number} fallback
 */
function numConfig(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * @param {Record<string, unknown>} config
 * @param {string[]} keys
 * @returns {string}
 */
function configStr(config, keys) {
    for (const k of keys) {
        const v = config[k];
        if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
}

/**
 * @param {unknown} v
 * @param {boolean} [defaultOn]
 */
function configEnabled(v, defaultOn = true) {
    if (v === undefined || v === null || String(v).trim() === '') return defaultOn;
    if (v === false || v === 0) return false;
    const s = String(v).trim().toLowerCase();
    if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
    return true;
}

/**
 * meta-server 互換の ADDON_MATSUYAMA_FLIGHTS_* を ctx.config に重ねる
 * @param {Record<string, unknown>} config
 * @returns {Record<string, unknown>}
 */
function mergeGlobalAddonEnv(config) {
    /** @type {Record<string, unknown>} */
    const out = { ...config };
    const envKeys = [
        ['poll_interval_ms', 'ADDON_MATSUYAMA_FLIGHTS_POLL_INTERVAL_MS'],
        ['pollIntervalMs', 'ADDON_MATSUYAMA_FLIGHTS_POLL_INTERVAL_MS'],
        ['airport_iata', 'ADDON_MATSUYAMA_FLIGHTS_AIRPORT_IATA'],
        ['airportIata', 'ADDON_MATSUYAMA_FLIGHTS_AIRPORT_IATA'],
        ['timetable_url', 'ADDON_MATSUYAMA_FLIGHTS_TIMETABLE_URL'],
        ['timetableUrl', 'ADDON_MATSUYAMA_FLIGHTS_TIMETABLE_URL'],
        ['backup_enabled', 'ADDON_MATSUYAMA_FLIGHTS_BACKUP_ENABLED'],
        ['backupEnabled', 'ADDON_MATSUYAMA_FLIGHTS_BACKUP_ENABLED'],
        ['odpt_consumer_key', 'ADDON_MATSUYAMA_FLIGHTS_ODPT_CONSUMER_KEY'],
        ['odptConsumerKey', 'ADDON_MATSUYAMA_FLIGHTS_ODPT_CONSUMER_KEY'],
        ['jetstar_enabled', 'ADDON_MATSUYAMA_FLIGHTS_JETSTAR_ENABLED'],
        ['jetstarEnabled', 'ADDON_MATSUYAMA_FLIGHTS_JETSTAR_ENABLED'],
        ['jetstar_destination', 'ADDON_MATSUYAMA_FLIGHTS_JETSTAR_DESTINATION'],
        ['jetstarDestination', 'ADDON_MATSUYAMA_FLIGHTS_JETSTAR_DESTINATION'],
    ];
    for (const [key, envName] of envKeys) {
        const v = process.env[envName];
        if (v != null && String(v).trim() !== '') {
            out[key] = String(v).trim();
        }
    }
    return out;
}

/**
 * @param {object} ctx
 * @param {string[]} reasons
 */
function warnLayoutChange(ctx, reasons) {
    ctx.logger.error(LAYOUT_WARN_MSG);
    for (const r of reasons) {
        ctx.logger.error(`[matsuyama-flights]   理由: ${r}`);
    }
}

/**
 * @param {object} ctx
 * @param {string} message
 */
function warnFetchFailure(ctx, message) {
    ctx.logger.error(FETCH_WARN_MSG);
    ctx.logger.error(`[matsuyama-flights]   理由: ${message}`);
}

/**
 * @param {object} ctx
 * @param {{ cachedBoard: object, resolvedAirportId: string|null }} rt
 * @param {string} airportIata
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function applyBackupBoard(ctx, rt, airportIata, key) {
    const backupOn = configEnabled(
        ctx.config.backup_enabled ?? ctx.config.backupEnabled ?? ctx.config.backupenabled,
        true
    );
    if (!backupOn) {
        rt.cachedBoard = {
            ...rt.cachedBoard,
            ok: false,
            error: 'レイアウト変更検知・バックアップ無効',
            layoutAlert: true,
        };
        return false;
    }

    const backup = await fetchBackupBoard({
        consumerKey: key,
        airportIata,
        airportId: rt.resolvedAirportId,
        config: ctx.config,
    });
    if (backup.airportId) rt.resolvedAirportId = backup.airportId;

    if (!backup.ok) {
        rt.cachedBoard = {
            ...rt.cachedBoard,
            ok: false,
            airport: airportIata,
            dataSource: 'backup',
            layoutAlert: true,
            error: backup.error || 'Backup fetch failed',
            updatedAt: rt.cachedBoard.updatedAt,
        };
        return false;
    }

    rt.cachedBoard = {
        ok: true,
        airport: airportIata,
        serviceDate: jstTodayYmd(),
        dataSource: 'backup',
        layoutAlert: true,
        updatedAt: new Date().toISOString(),
        departures: backup.departures,
        arrivals: backup.arrivals,
    };
    ctx.logger.info(
        `board updated (backup): ${backup.departures.length} departures, ${backup.arrivals.length} arrivals`
    );
    return true;
}

/**
 * @param {object} ctx
 * @param {{ cachedBoard: object, resolvedAirportId: string|null }} rt
 */
async function refreshBoard(ctx, rt) {
    const airportIata = configStr(ctx.config, ['airport_iata', 'airportIata', 'airportiata']) || 'MYJ';
    const timetableUrl =
        configStr(ctx.config, ['timetable_url', 'timetableUrl', 'timetableurl'])
        || DEFAULT_TIMETABLE_URL;
    const odptKey = configStr(ctx.config, ['odpt_consumer_key', 'odptConsumerKey', 'odptconsumerkey']);

    try {
        const airport = await fetchMatsuyamaAirportBoard({ url: timetableUrl });

        if (airport.layoutValid) {
            rt.cachedBoard = {
                ok: true,
                airport: airportIata,
                serviceDate: jstTodayYmd(),
                dataSource: 'airport',
                layoutAlert: false,
                updatedAt: new Date().toISOString(),
                departures: airport.departures,
                arrivals: airport.arrivals,
            };
            ctx.logger.info(
                `board updated (airport): ${airport.departures.length} departures, ${airport.arrivals.length} arrivals`
            );
            return;
        }

        warnLayoutChange(ctx, airport.layoutReasons);

        if (await applyBackupBoard(ctx, rt, airportIata, odptKey)) {
            return;
        }

        if (!odptKey) {
            ctx.logger.warn(
                '[matsuyama-flights] バックアップには ODPT キーが必要です（未設定のため空港 HTML のみ）'
            );
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.logger.warn('airport timetable fetch failed:', msg);

        if (odptKey) {
            warnFetchFailure(ctx, msg);
            if (await applyBackupBoard(ctx, rt, airportIata, odptKey)) {
                return;
            }
        }

        rt.cachedBoard = {
            ...rt.cachedBoard,
            ok: false,
            error: msg,
            updatedAt: rt.cachedBoard.updatedAt,
        };
    }
}

/**
 * @param {{ cachedBoard: object }} rt
 */
function createBoardHandler(rt) {
    return (_req, res) => {
        const b = rt.cachedBoard;
        if (!b.ok && b.error) {
            res.status(503).json(b);
            return;
        }
        res.json(b);
    };
}

export default {
    /**
     * @param {import('../../../lib/tenant-plugin-loader.js').PluginRegisterContext & { config: Record<string, unknown> }} ctx
     */
    async register(ctx) {
        const merged = mergeGlobalAddonEnv(ctx.config);
        const config = { ...ctx, config: merged };
        const rt = getRuntime(ctx.tenantId);
        const pollMs = numConfig(
            merged.poll_interval_ms ?? merged.pollIntervalMs ?? merged.pollintervalms,
            60_000
        );

        const onBoard = createBoardHandler(rt);

        ctx.mountHttp((router) => {
            router.get('/board', onBoard);
        });

        ctx.hooks.on(HOOKS.AFTER_TENANT_ROUTES_MOUNTED, (payload) => {
            if (payload.tenantId !== ctx.tenantId) return;
            payload.tenantRouter.get('/api/addons/matsuyama-flights/board', onBoard);
        });

        ctx.hooks.on(HOOKS.SHUTDOWN, () => {
            if (rt.pollTimer) {
                clearInterval(rt.pollTimer);
                rt.pollTimer = null;
            }
            tenantRuntime.delete(ctx.tenantId);
        });

        await refreshBoard(config, rt);
        if (rt.pollTimer) clearInterval(rt.pollTimer);
        rt.pollTimer = setInterval(() => {
            refreshBoard(config, rt).catch((e) => ctx.logger.warn('poll error', e));
        }, pollMs);

        ctx.logger.info('registered (airport timetable primary)');
    },
};
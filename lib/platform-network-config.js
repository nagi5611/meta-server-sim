// lib/platform-network-config.js — 系列サーバー / ポートマップ / ナビリンク（env-config + data/platform 統合）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { parseMetaversePortalLinks, markCurrentPortalLink } from './metaverse-portal-links.js';
import { getPlatformEnv } from './platform-env-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'data', 'platform');
const CONFIG_PATH = path.join(CONFIG_DIR, 'network-config.json');

/** @type {import('./platform-network-config.js').NetworkConfigFile | null} */
let cachedFileConfig = null;

/**
 * @typedef {{ label: string, url: string, current?: boolean }} PortalLink
 * @typedef {{ label: string, host: string, port: number, secure?: boolean, path?: string, bindService?: boolean }} ServerEntry
 * @typedef {{ tenantId: string, url: string }} TenantAccessEntry
 * @typedef {{
 *   portalLinks: PortalLink[],
 *   servers: ServerEntry[],
 *   tenantAccessUrls: TenantAccessEntry[],
 * }} NetworkConfigStructural
 * @typedef {NetworkConfigStructural & {
 *   proxyServiceDomain: string,
 *   useReverseProxy: boolean,
 *   trustProxy: boolean,
 *   requireSecureHttp: boolean,
 * }} NetworkConfigFile
 */

/**
 * @param {unknown} v
 * @returns {boolean}
 */
export function isTruthyConfig(v) {
    const s = String(v ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/** 開発時 Vite は TLS なし — localhost の https URL はブラウザで開けない */
const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * 本番以外では localhost の https を http に揃える（Vite dev 用）
 * @param {string} url
 * @returns {string}
 */
export function toBrowserPublicUrl(url) {
    const raw = String(url || '').trim();
    if (!raw || process.env.NODE_ENV === 'production') return raw;
    try {
        const u = new URL(raw);
        if (
            u.protocol === 'https:' &&
            LOCAL_DEV_HOSTS.has(u.hostname.toLowerCase())
        ) {
            u.protocol = 'http:';
            return u.href;
        }
    } catch {
        /* ignore */
    }
    return raw;
}

/**
 * @param {string | undefined} raw
 * @returns {{ map: Map<string, number>, errors: string[] }}
 */
export function parseProxyDomainPortMapSafe(raw) {
    const map = new Map();
    const errors = /** @type {string[]} */ ([]);
    if (!raw || typeof raw !== 'string') return { map, errors };

    const parts = raw.split(/[\r\n,]+/).map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
        const eq = part.indexOf('=');
        if (eq <= 0) {
            errors.push(`無効な行: ${part}`);
            continue;
        }
        const host = part.slice(0, eq).trim().toLowerCase();
        const portStr = part.slice(eq + 1).trim();
        const port = parseInt(portStr, 10);
        if (!host || !Number.isFinite(port) || port < 1 || port > 65535) {
            errors.push(`無効な host/port: ${part}`);
            continue;
        }
        if (map.has(host) && map.get(host) !== port) {
            errors.push(`host "${host}" のポートが競合しています`);
            continue;
        }
        map.set(host, port);
    }
    return { map, errors };
}

/**
 * @param {ServerEntry} entry
 * @returns {string}
 */
export function serverEntryToUrl(entry) {
    const host = String(entry.host || '').trim().toLowerCase();
    const port = Number(entry.port);
    const secure = !!entry.secure;
    const scheme = secure ? 'https' : 'http';
    const pathPart = String(entry.path || '').trim();
    const normalizedPath =
        pathPart && pathPart !== '/'
            ? pathPart.startsWith('/') ? pathPart : `/${pathPart}`
            : '';
    const defaultPort = secure ? 443 : 80;
    const portSuffix =
        Number.isFinite(port) && port >= 1 && port <= 65535 && port !== defaultPort
            ? `:${port}`
            : '';
    const base = `${scheme}://${host}${portSuffix}`;
    if (!normalizedPath) return base;
    return `${base.replace(/\/$/, '')}${normalizedPath}`;
}

/**
 * @param {unknown} entry
 * @returns {ServerEntry | null}
 */
function normalizeServerEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const label = String(entry.label ?? '').trim();
    const host = String(entry.host ?? '').trim().toLowerCase();
    const port = parseInt(String(entry.port ?? ''), 10);
    if (!label || !host || !Number.isFinite(port) || port < 1 || port > 65535) return null;
    const pathRaw = entry.path != null ? String(entry.path).trim() : '';
    return {
        label,
        host,
        port,
        secure: !!entry.secure,
        path: pathRaw || undefined,
        bindService: !!entry.bindService,
    };
}

/**
 * @param {unknown} entry
 * @returns {TenantAccessEntry | null}
 */
function normalizeTenantAccessEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const tenantId = String(entry.tenantId ?? '').trim();
    const url = String(entry.url ?? '').trim();
    if (!tenantId || !url) return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return { tenantId, url: parsed.href };
    } catch {
        return null;
    }
}

/**
 * @returns {NetworkConfigStructural}
 */
function emptyNetworkConfigStructural() {
    return {
        portalLinks: [],
        servers: [],
        tenantAccessUrls: [],
    };
}

/**
 * 環境変数からスカラー設定を取得する
 * @returns {{ proxyServiceDomain: string, useReverseProxy: boolean, trustProxy: boolean, requireSecureHttp: boolean }}
 */
function buildScalarFlagsFromPlatformEnv() {
    return {
        proxyServiceDomain: String(getPlatformEnv('PROXY_SERVICE_DOMAIN') || '').trim().toLowerCase(),
        useReverseProxy: isTruthyConfig(getPlatformEnv('USE_REVERSE_PROXY')),
        trustProxy: isTruthyConfig(getPlatformEnv('TRUST_PROXY')),
        requireSecureHttp: isTruthyConfig(getPlatformEnv('REQUIRE_SECURE_HTTP')),
    };
}

/**
 * @param {unknown} raw
 * @returns {NetworkConfigStructural}
 */
function normalizeNetworkConfigFile(raw) {
    const base = emptyNetworkConfigStructural();
    if (!raw || typeof raw !== 'object') return base;

    const portalLinks = Array.isArray(raw.portalLinks)
        ? parseMetaversePortalLinks(
              raw.portalLinks
                  .map((l) => {
                      if (!l || typeof l !== 'object') return '';
                      const label = String(l.label ?? '').trim();
                      const url = String(l.url ?? '').trim();
                      if (!label || !url) return '';
                      return `${label}|${url}`;
                  })
                  .filter(Boolean)
                  .join('\n')
          )
        : [];

    const servers = Array.isArray(raw.servers)
        ? raw.servers.map(normalizeServerEntry).filter(Boolean)
        : [];

    const tenantAccessUrls = Array.isArray(raw.tenantAccessUrls)
        ? raw.tenantAccessUrls.map(normalizeTenantAccessEntry).filter(Boolean)
        : [];

    return {
        portalLinks,
        servers,
        tenantAccessUrls,
    };
}

/**
 * 環境変数から構造データの初期値を組み立てる
 * @returns {NetworkConfigStructural}
 */
function buildNetworkConfigFromEnv() {
    const envPortal = parseMetaversePortalLinks(getPlatformEnv('METAVERSE_PORTAL_LINKS'));
    const { map } = parseProxyDomainPortMapSafe(getPlatformEnv('PROXY_DOMAIN_PORT_MAP'));
    const servers = [...map.entries()].map(([host, port]) => ({
        label: host,
        host,
        port,
        secure: isTruthyConfig(getPlatformEnv('REQUIRE_SECURE_HTTP')),
    }));

    return {
        portalLinks: envPortal,
        servers,
        tenantAccessUrls: [],
    };
}

/**
 * ファイル設定を読み込む（無ければ null）
 */
export function loadNetworkConfigFromDisk() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return null;
        const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return normalizeNetworkConfigFile(raw);
    } catch (e) {
        console.warn('[network-config] failed to read config file:', e);
        return null;
    }
}

/**
 * 有効な設定（構造データはファイル優先、スカラーは常に環境変数）
 * @returns {NetworkConfigFile}
 */
export function getEffectiveNetworkConfig() {
    if (!cachedFileConfig) {
        const fromDisk = loadNetworkConfigFromDisk();
        const fromEnv = buildNetworkConfigFromEnv();
        const structural = fromDisk
            ? {
                  portalLinks:
                      fromDisk.portalLinks.length > 0 ? fromDisk.portalLinks : fromEnv.portalLinks,
                  servers: fromDisk.servers.length > 0 ? fromDisk.servers : fromEnv.servers,
                  tenantAccessUrls: fromDisk.tenantAccessUrls,
              }
            : fromEnv;
        cachedFileConfig = {
            ...structural,
            ...buildScalarFlagsFromPlatformEnv(),
        };
    } else {
        Object.assign(cachedFileConfig, buildScalarFlagsFromPlatformEnv());
    }
    return cachedFileConfig;
}

/**
 * キャッシュを破棄して再読み込み
 */
export function reloadNetworkConfig() {
    cachedFileConfig = null;
    return getEffectiveNetworkConfig();
}

/**
 * ナビ用 portal リンク（portalLinks 優先、無ければ servers から生成）
 * @returns {PortalLink[]}
 */
export function getPortalLinks() {
    const cfg = getEffectiveNetworkConfig();
    if (cfg.portalLinks.length > 0) {
        return cfg.portalLinks.map((l) => ({
            ...l,
            url: toBrowserPublicUrl(l.url),
        }));
    }
    return cfg.servers.map((s) => ({
        label: s.label,
        url: toBrowserPublicUrl(serverEntryToUrl(s)),
    }));
}

/**
 * 公開用系列サーバー行を選ぶ（同一 host が複数あるとき 3001 固定を避ける）
 * @param {ServerEntry[]} servers
 * @param {string} [proxyServiceDomain]
 * @returns {ServerEntry | null}
 */
export function pickPublicServerEntry(servers, proxyServiceDomain = '') {
    if (!Array.isArray(servers) || servers.length === 0) return null;
    const domain = String(proxyServiceDomain || '').trim().toLowerCase();
    return (
        servers.find((x) => /vite|公開/i.test(x.label) && !x.bindService) ||
        servers.find((x) => !x.bindService && x.secure && x.port === 3003) ||
        servers.find((x) => x.host === domain && !x.bindService) ||
        servers.find((x) => !x.bindService) ||
        servers[servers.length - 1]
    );
}

/**
 * @param {string} tenantId
 * @returns {string | null}
 */
export function getTenantPublicUrl(tenantId) {
    const id = String(tenantId || '').trim();
    if (!id) return null;
    const cfg = getEffectiveNetworkConfig();
    const hit = cfg.tenantAccessUrls.find((t) => t.tenantId === id);
    if (hit) return toBrowserPublicUrl(hit.url);

    const server = pickPublicServerEntry(cfg.servers, cfg.proxyServiceDomain);
    if (server) {
        const base = toBrowserPublicUrl(serverEntryToUrl(server)).replace(/\/$/, '');
        return `${base}/${id}/`;
    }
    return `/${id}/`;
}

/**
 * Tenant 作成時のネットワーク行をランタイム設定へマージする（即時 API 反映用）
 * @param {{
 *   tenantAccessUrl: { tenantId: string, url: string },
 *   portalLink: { label: string, url: string },
 *   server?: ServerEntry,
 * }} entries
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function mergeTenantNetworkEntries(entries) {
    const tenantRow = normalizeTenantAccessEntry(entries?.tenantAccessUrl);
    if (!tenantRow) {
        return { ok: false, error: 'tenant access url is invalid' };
    }

    const portalLabel = String(entries?.portalLink?.label ?? '').trim();
    const portalUrl = String(entries?.portalLink?.url ?? '').trim();
    if (!portalLabel || !portalUrl) {
        return { ok: false, error: 'portal link is invalid' };
    }
    try {
        const parsed = new URL(portalUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { ok: false, error: 'portal link url is invalid' };
        }
    } catch {
        return { ok: false, error: 'portal link url is invalid' };
    }

    const cfg = getEffectiveNetworkConfig();

    const urlIdx = cfg.tenantAccessUrls.findIndex((t) => t.tenantId === tenantRow.tenantId);
    if (urlIdx >= 0) cfg.tenantAccessUrls[urlIdx] = tenantRow;
    else cfg.tenantAccessUrls.push(tenantRow);

    const portalHref = new URL(portalUrl).href;
    if (!cfg.portalLinks.some((l) => l.url === portalHref)) {
        cfg.portalLinks.push({ label: portalLabel, url: portalHref });
    }

    const server = entries?.server ? normalizeServerEntry(entries.server) : null;
    if (server) {
        const pathNorm = String(server.path || '').trim();
        const dup = cfg.servers.some(
            (s) =>
                s.host === server.host &&
                s.port === server.port &&
                String(s.path || '').trim() === pathNorm &&
                s.label === server.label
        );
        if (!dup) {
            cfg.servers.push(server);
        }
    }

    return { ok: true };
}

/**
 * @returns {Map<string, number>}
 */
export function getProxyDomainPortMap() {
    const cfg = getEffectiveNetworkConfig();
    const map = new Map();

    const env = parseProxyDomainPortMapSafe(getPlatformEnv('PROXY_DOMAIN_PORT_MAP'));
    for (const [h, p] of env.map.entries()) {
        map.set(h, p);
    }

    if (map.size === 0) {
        for (const s of cfg.servers) {
            if (s.bindService) {
                map.set(s.host, s.port);
            }
        }
    }

    if (map.size === 0 && cfg.proxyServiceDomain) {
        const bindMatch = cfg.servers.find(
            (s) => s.host === cfg.proxyServiceDomain && s.bindService
        );
        if (bindMatch) {
            map.set(bindMatch.host, bindMatch.port);
        }
    }

    return map;
}

/**
 * 開発時 SOCKET_CORS_ORIGINS 未設定の既定（Vite + Node 直アクセス）
 * @returns {string[]}
 */
export function getDefaultDevSocketCorsOrigins() {
    const nodePort = parseInt(String(getPlatformEnv('PORT') || '3002'), 10) || 3002;
    const vitePort = parseInt(String(process.env.VITE_DEV_PORT || '3003'), 10) || 3003;
    /** @type {string[]} */
    const origins = [];
    for (const host of ['localhost', '127.0.0.1']) {
        origins.push(`http://${host}:${nodePort}`);
        origins.push(`http://${host}:${vitePort}`);
    }
    return origins;
}

/**
 * Socket.io CORS 用オリジン（.env + 系列サーバー公開 URL から組み立て）
 * @param {NetworkConfigFile} cfg
 * @returns {string[]}
 */
function buildSocketCorsOrigins(cfg) {
    const origins = new Set();
    for (const raw of String(getPlatformEnv('SOCKET_CORS_ORIGINS') || '').split(/[\r\n,]+/)) {
        const o = raw.trim();
        if (o) origins.add(o);
    }
    for (const s of cfg.servers) {
        if (s.bindService) continue;
        const entryUrl = serverEntryToUrl(s);
        if (!entryUrl) continue;
        try {
            const u = new URL(entryUrl);
            origins.add(`${u.protocol}//${u.host}`);
            if (u.protocol === 'https:') origins.add(`http://${u.host}`);
            else if (u.protocol === 'http:') origins.add(`https://${u.host}`);
        } catch {
            /* ignore */
        }
    }
    const list = [...origins];
    if (list.length === 0 && process.env.NODE_ENV !== 'production') {
        return getDefaultDevSocketCorsOrigins();
    }
    return list;
}

/**
 * 起動用設定（不正 .env でもプロセスを落とさない）
 * @returns {{
 *   port: number,
 *   host: string,
 *   useReverseProxy: boolean,
 *   requireSecureHttp: boolean,
 *   trustProxy: boolean | number | string,
 *   proxyDomainPortMap: Map<string, number>,
 *   proxyServiceDomain: string,
 *   socketCorsOrigins: string[],
 *   warnings: string[],
 *   configPath: string,
 *   configSource: 'file' | 'env' | 'mixed',
 * }}
 */
export function resolveServerBootConfig() {
    const warnings = /** @type {string[]} */ ([]);
    const fromDisk = loadNetworkConfigFromDisk();
    const cfg = getEffectiveNetworkConfig();
    const configSource = fromDisk ? (cfg.servers.length ? 'file' : 'mixed') : 'env';

    const portRaw = getPlatformEnv('PORT');
    let port =
        portRaw !== undefined && portRaw !== ''
            ? parseInt(portRaw, 10)
            : 3002;
    if (Number.isNaN(port)) {
        warnings.push('PORT が数値ではないため 3002 を使用します');
        port = 3002;
    }

    const host = String(getPlatformEnv('HOST') || '0.0.0.0').trim() || '0.0.0.0';
    const proxyDomainPortMap = getProxyDomainPortMap();
    let useReverseProxy = cfg.useReverseProxy;
    let proxyServiceDomain = cfg.proxyServiceDomain;

    if (useReverseProxy && proxyServiceDomain) {
        if (proxyDomainPortMap.size === 0) {
            warnings.push(
                'USE_REVERSE_PROXY が有効ですがサーバー一覧が空です。通常モードで起動します。'
            );
            useReverseProxy = false;
        } else if (!proxyDomainPortMap.has(proxyServiceDomain)) {
            warnings.push(
                `PROXY_SERVICE_DOMAIN "${proxyServiceDomain}" がサーバー一覧にありません。通常モードで起動します。`
            );
            useReverseProxy = false;
        } else {
            const mappedPort = proxyDomainPortMap.get(proxyServiceDomain);
            if (
                portRaw !== undefined &&
                portRaw !== '' &&
                parseInt(portRaw, 10) !== mappedPort
            ) {
                warnings.push(
                    `PORT (${portRaw}) と ${proxyServiceDomain} のマップ (${mappedPort}) が不一致。マップのポートを使用します。`
                );
            }
            port = mappedPort ?? port;
        }
    }

    const envMapErrors = parseProxyDomainPortMapSafe(getPlatformEnv('PROXY_DOMAIN_PORT_MAP')).errors;
    for (const err of envMapErrors) {
        warnings.push(`.env PROXY_DOMAIN_PORT_MAP: ${err}`);
    }

    const socketCorsOrigins = buildSocketCorsOrigins(cfg);
    if (socketCorsOrigins.length === 0 && process.env.NODE_ENV === 'production') {
        warnings.push(
            'SOCKET_CORS_ORIGINS が未設定のため Socket.io はクロスオリジン接続を拒否します。本番では許可オリジンを列挙してください。'
        );
    }

    let trustProxy = false;
    if (cfg.trustProxy || useReverseProxy) {
        const tpRaw = String(getPlatformEnv('TRUST_PROXY') ?? '').trim();
        const tpLower = tpRaw.toLowerCase();
        if (cfg.trustProxy || tpLower !== '0' && tpLower !== 'false' && tpLower !== 'off' && tpLower !== 'no') {
            if (tpRaw === '' || tpLower === '1' || tpLower === 'true' || tpLower === 'yes' || tpLower === 'on' || cfg.trustProxy) {
                trustProxy = 1;
            } else if (/^\d+$/.test(tpRaw)) {
                trustProxy = parseInt(tpRaw, 10);
            } else {
                trustProxy = tpRaw;
            }
        }
    }

    return {
        port,
        host,
        useReverseProxy,
        requireSecureHttp: cfg.requireSecureHttp,
        trustProxy,
        proxyDomainPortMap,
        proxyServiceDomain,
        socketCorsOrigins,
        warnings,
        configPath: CONFIG_PATH,
        configSource,
    };
}

/**
 * @param {unknown} payload
 * @returns {{ ok: true, config: NetworkConfigFile } | { ok: false, errors: string[] }}
 */
export function validateNetworkConfigPayload(payload) {
    const errors = /** @type {string[]} */ ([]);
    const normalized = normalizeNetworkConfigFile(payload);

    if (normalized.servers.length === 0 && normalized.portalLinks.length === 0) {
        errors.push('系列サーバーまたはナビリンクを 1 件以上設定してください');
    }

    const hosts = new Set();
    const bindServiceHosts = new Map();
    for (const s of normalized.servers) {
        if (s.bindService) {
            const prevPort = bindServiceHosts.get(s.host);
            if (prevPort != null && prevPort !== s.port) {
                errors.push(`bindService の host "${s.host}" でポートが競合しています`);
            }
            bindServiceHosts.set(s.host, s.port);
        }
        hosts.add(s.host);
    }

    const useReverseProxy = isTruthyConfig(getPlatformEnv('USE_REVERSE_PROXY'));
    const proxyServiceDomain = String(getPlatformEnv('PROXY_SERVICE_DOMAIN') || '').trim().toLowerCase();
    if (useReverseProxy && proxyServiceDomain) {
        if (!hosts.has(proxyServiceDomain)) {
            errors.push('PROXY_SERVICE_DOMAIN が系列サーバー一覧にありません');
        }
    }

    const tenantIds = new Set();
    for (const t of normalized.tenantAccessUrls) {
        if (tenantIds.has(t.tenantId)) errors.push(`Tenant URL が重複: ${t.tenantId}`);
        tenantIds.add(t.tenantId);
    }

    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, config: normalized };
}

/**
 * @param {NetworkConfigFile} config
 */
export function saveNetworkConfigToDisk(config) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const payload = {
        portalLinks: config.portalLinks.map((l) => ({ label: l.label, url: l.url })),
        servers: config.servers,
        tenantAccessUrls: config.tenantAccessUrls,
    };
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    cachedFileConfig = {
        ...payload,
        ...buildScalarFlagsFromPlatformEnv(),
    };
}

/**
 * @param {import('express').Request} req
 * @returns {import('./metaverse-portal-links.js').PortalLink[]}
 */
export function getPortalLinksForRequest(req) {
    return markCurrentPortalLink(getPortalLinks(), req);
}

/**
 * 管理 API 用の表示オブジェクト
 */
export function getNetworkConfigForAdmin() {
    const cfg = getEffectiveNetworkConfig();
    const boot = resolveServerBootConfig();
    const portRaw = getPlatformEnv('PORT');
    return {
        portalLinks: cfg.portalLinks.map((l) => ({
            label: l.label,
            url: toBrowserPublicUrl(l.url),
        })),
        tenantAccessUrls: cfg.tenantAccessUrls.map((t) => ({
            tenantId: t.tenantId,
            url: toBrowserPublicUrl(t.url),
        })),
        servers: cfg.servers.map((s) => ({
            ...s,
            url: toBrowserPublicUrl(serverEntryToUrl(s)),
        })),
        effectivePort: boot.port,
        configPath: CONFIG_PATH,
        configExists: fs.existsSync(CONFIG_PATH),
        bootWarnings: boot.warnings,
        needsRestartForPort:
            boot.useReverseProxy &&
            portRaw !== undefined &&
            portRaw !== '' &&
            String(boot.port) !== String(portRaw),
    };
}

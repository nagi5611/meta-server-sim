// lib/platform-env-schema.js — 管理パネル環境変数スキーマ（.env.example 準拠）

/** @typedef {'server'|'proxy'|'socket'|'portal'|'admin'|'storage'} EnvGroup */

/**
 * @typedef {{
 *   key: string,
 *   group: EnvGroup,
 *   label: string,
 *   description?: string,
 *   multiline?: boolean,
 *   restartRequired: boolean,
 *   defaultValue?: string,
 *   secret?: boolean,
 * }} EnvVarDefinition
 */

/** @type {EnvVarDefinition[]} */
export const PLATFORM_ENV_DEFINITIONS = [
    {
        key: 'PORT',
        group: 'server',
        label: 'HTTP ポート',
        restartRequired: true,
        defaultValue: '3002',
    },
    {
        key: 'HOST',
        group: 'server',
        label: 'バインドホスト',
        restartRequired: true,
        defaultValue: '0.0.0.0',
    },
    {
        key: 'USE_REVERSE_PROXY',
        group: 'proxy',
        label: 'リバースプロキシモード',
        description: '1 / true / yes / on で有効',
        restartRequired: true,
    },
    {
        key: 'TRUST_PROXY',
        group: 'proxy',
        label: 'Trust proxy',
        description: '1 / true / yes / on で有効',
        restartRequired: true,
    },
    {
        key: 'REQUIRE_SECURE_HTTP',
        group: 'proxy',
        label: 'HTTPS 必須',
        restartRequired: true,
    },
    {
        key: 'PROXY_DOMAIN_PORT_MAP',
        group: 'proxy',
        label: 'host=port マップ',
        description: '改行またはカンマ区切り。例: sim.example.com=3002',
        multiline: true,
        restartRequired: true,
    },
    {
        key: 'PROXY_SERVICE_DOMAIN',
        group: 'proxy',
        label: 'このサーバーのドメイン',
        restartRequired: true,
    },
    {
        key: 'SOCKET_CORS_ORIGINS',
        group: 'socket',
        label: 'Socket.io CORS オリジン',
        description:
            '改行またはカンマ区切り。本番未設定時は CORS 拒否。開発未設定時は localhost の Node/Vite ポート',
        multiline: true,
        restartRequired: true,
    },
    {
        key: 'TENANT_SOCKET_SECRET',
        group: 'socket',
        label: 'テナント Socket join シークレット',
        description:
            '未設定で制限なし。設定時は auth の joinToken/socketSecret が一致する接続のみ（管理ワンタイム token は除外）。tenant.json の socketSecret があれば優先',
        restartRequired: true,
    },
    {
        key: 'METAVERSE_PORTAL_LINKS',
        group: 'portal',
        label: '系列ナビリンク',
        description: 'label|url を改行またはカンマ区切り。network-config の portalLinks が空のとき使用',
        multiline: true,
        restartRequired: false,
    },
    {
        key: 'ADMIN_USERNAME',
        group: 'admin',
        label: '管理画面ユーザー名',
        restartRequired: true,
        defaultValue: 'admin',
    },
    {
        key: 'ADMIN_PASSWORD',
        group: 'admin',
        label: '管理画面パスワード',
        description: '本番では 16 文字以上。.env のみ（env-config.json には保存しません）',
        restartRequired: true,
        secret: true,
    },
    {
        key: 'STORAGE_BACKEND',
        group: 'storage',
        label: 'ストレージバックエンド',
        description: 'local または r2',
        restartRequired: false,
        defaultValue: 'local',
    },
    {
        key: 'R2_ACCESS_KEY_ID',
        group: 'storage',
        label: 'R2 Access Key ID',
        description: '.env のみ（env-config.json には保存しません）',
        restartRequired: false,
        secret: true,
    },
    {
        key: 'R2_SECRET_ACCESS_KEY',
        group: 'storage',
        label: 'R2 Secret Access Key',
        description: '.env のみ（env-config.json には保存しません）',
        restartRequired: false,
        secret: true,
    },
    {
        key: 'R2_ACCOUNT_ID',
        group: 'storage',
        label: 'R2 Account ID',
        description: '.env のみ（env-config.json には保存しません）',
        restartRequired: false,
        secret: true,
    },
    {
        key: 'R2_BUCKET_NAME',
        group: 'storage',
        label: 'R2 バケット名',
        restartRequired: false,
        defaultValue: 'metaverse-files',
    },
    {
        key: 'R2_KEY_PREFIX',
        group: 'storage',
        label: 'R2 キープレフィックス',
        restartRequired: false,
        defaultValue: 'metaverse',
    },
];

/** @type {Map<string, EnvVarDefinition>} */
export const PLATFORM_ENV_BY_KEY = new Map(
    PLATFORM_ENV_DEFINITIONS.map((def) => [def.key, def])
);

/** .env のみ（管理パネルファイルに保存しない） */
export const ENV_META_ONLY_KEYS = new Set([
    'ADMIN_ENV_SECRET_LEVEL',
    'ADMIN_ENV_MASK_KEYS',
    'ENV_CONFIG_ENCRYPTION_KEY',
]);

/**
 * env-config.json に平文保存してはいけない機密キー
 * @param {string} key
 * @returns {boolean}
 */
export function isEnvFileSecret(key) {
    const def = PLATFORM_ENV_BY_KEY.get(key);
    return def?.secret === true;
}

/** @type {Record<EnvGroup, string>} */
export const ENV_GROUP_LABELS = {
    server: 'サーバー',
    proxy: 'リバースプロキシ',
    socket: 'Socket.io',
    portal: 'ナビリンク（環境変数）',
    admin: '管理認証',
    storage: 'R2 ストレージ',
};

/**
 * @param {string} key
 * @returns {EnvVarDefinition | undefined}
 */
export function getEnvDefinition(key) {
    return PLATFORM_ENV_BY_KEY.get(key);
}

/**
 * @returns {Set<string>}
 */
export function getRestartRequiredKeys() {
    return new Set(
        PLATFORM_ENV_DEFINITIONS.filter((d) => d.restartRequired).map((d) => d.key)
    );
}

const DEFAULT_JEV_API_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_JEV_MODEL = 'jev-latest';
const DEFAULT_JEV_REJECT_THRESHOLD = 0.7;
const DEFAULT_JEV_TIMEOUT_MS = 8000;

const DEFAULT_POLICY = `みんなでメタ ロビー参加用「表示名」ポリシー（要約）:
ヘイト・ハラスメント、重度の暴言・差別、露骨な性的表現、他者への攻撃や脅迫を想起させる名前、スパム・宣伝目的の名前、意味のない記号や文字の羂列だけの名前は拒否する。
一般的なニックネーム、プレイヤー名、名前＋番号、無害な短い呼び名は許可する。`;

const DEFAULT_REJECT_QUESTION =
    'この pending_message は、state に記載のポリシーに照らしてロビー参加用の表示名を拒否すべきか。';

function isTruthyFlag(v) {
    const s = String(v ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

/**
 * @param {Record<string, unknown>} env Worker bindings / vars / secrets
 */
export function getLobbyDisplayNameModerationConfig(env) {
    const enabled = isTruthyFlag(env.LOBBY_DISPLAY_NAME_MOD_ENABLED ?? '1');
    const apiKey = String(
        env.LOBBY_JEV_API_KEY || env.JEV_API_KEY || env.TYPESAFE_API_KEY || '',
    ).trim();

    const thresholdRaw = env.LOBBY_JEV_REJECT_THRESHOLD;
    let rejectThreshold = DEFAULT_JEV_REJECT_THRESHOLD;
    if (thresholdRaw !== undefined && thresholdRaw !== null && String(thresholdRaw).trim() !== '') {
        const parsed = Number.parseFloat(String(thresholdRaw));
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
            rejectThreshold = parsed;
        }
    }

    const apiUrl = String(env.LOBBY_JEV_API_URL || DEFAULT_JEV_API_URL).trim() || DEFAULT_JEV_API_URL;
    const model = String(env.LOBBY_JEV_MODEL || DEFAULT_JEV_MODEL).trim() || DEFAULT_JEV_MODEL;
    const timeoutMs = Math.max(
        1000,
        Number.parseInt(String(env.LOBBY_JEV_TIMEOUT_MS || DEFAULT_JEV_TIMEOUT_MS), 10) ||
            DEFAULT_JEV_TIMEOUT_MS,
    );

    return {
        enabled: enabled && apiKey.length > 0,
        apiKey,
        apiUrl,
        model,
        rejectThreshold,
        timeoutMs,
        rejectQuestion: String(env.LOBBY_JEV_REJECT_QUESTION || DEFAULT_REJECT_QUESTION).trim(),
        policyText: String(env.LOBBY_JEV_DISPLAY_NAME_POLICY || DEFAULT_POLICY).trim(),
    };
}
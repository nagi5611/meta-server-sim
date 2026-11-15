// lib/chat-moderation-config.js — ScienceSub 向け Jev + Gemini 検閲パイプライン設定（ENV のみ）

/**
 * @param {unknown} v
 */
function isTruthyFlag(v) {
    const s = String(v ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

const DEFAULT_JEV_REJECT_QUESTION =
    'この pending_message は、state に記載のポリシーに照らしてチャット送信を拒否すべきか。';

const DEFAULT_JEV_POLICY_HINT = `サイエンスサブ向けチャットポリシー（要約）:
ヘイト・ハラスメント、重度の暴言・差別、露骨な性的表現、他者への暴力的脅し、違法行為の具体的教唆、個人情報の悪意ある晒し、スパム・宣伝・無意味な連投は拒否する。
一般的な会話・ゲーム内の軽い冗談・意見は許可する。`;

/**
 * @returns {{
 *   pipeline: 'jev-gemini' | 'gemini-only',
 *   jev: {
 *     enabled: boolean,
 *     apiKey: string,
 *     model: string,
 *     apiUrl: string,
 *     timeoutMs: number,
 *     rejectThreshold: number,
 *     rejectQuestion: string,
 *     policyText: string,
 *   },
 * }}
 */
export function getChatModerationPipelineConfig() {
    const pipelineRaw = String(process.env.CHAT_MOD_PIPELINE || 'jev-gemini').trim().toLowerCase();
    const pipeline = pipelineRaw === 'gemini-only' ? 'gemini-only' : 'jev-gemini';

    const enabled =
        pipeline === 'jev-gemini' && isTruthyFlag(process.env.CHAT_MOD_JEV_ENABLED ?? '1');
    const apiKey = String(process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY || '').trim();

    const thresholdRaw = process.env.CHAT_MOD_JEV_REJECT_THRESHOLD;
    const rejectThreshold =
        thresholdRaw === undefined || thresholdRaw === ''
            ? Number.NaN
            : Number.parseFloat(String(thresholdRaw));

    return {
        pipeline,
        jev: {
            enabled,
            apiKey,
            model: String(process.env.CHAT_MOD_JEV_MODEL || 'jev-latest').trim() || 'jev-latest',
            apiUrl: String(process.env.CHAT_MOD_JEV_API_URL || 'https://api.typesafe.ai/v1/systemone').trim(),
            timeoutMs: Math.max(
                1000,
                Number.parseInt(String(process.env.CHAT_MOD_JEV_TIMEOUT_MS || '8000'), 10) || 8000,
            ),
            rejectThreshold,
            rejectQuestion: String(process.env.CHAT_MOD_JEV_REJECT_QUESTION || DEFAULT_JEV_REJECT_QUESTION).trim(),
            policyText: String(process.env.CHAT_MOD_JEV_POLICY_TEXT || DEFAULT_JEV_POLICY_HINT).trim(),
        },
    };
}

/**
 * @param {number} threshold
 */
export function assertValidJevRejectThreshold(threshold) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error(
            'CHAT_MOD_JEV_REJECT_THRESHOLD must be a number between 0 and 1 (set in environment, not hardcoded)',
        );
    }
}

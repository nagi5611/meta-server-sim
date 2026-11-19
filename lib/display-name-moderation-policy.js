// lib/display-name-moderation-policy.js — 表示名 Jev + Gemini モデレーション（ロビー sim 連携・テナントゲスト）
import { getChatModerationPipelineConfig } from './chat-moderation-config.js';
import { scoreJevChatReject, shouldRejectFromJevNoul } from './chat-moderation-jev.js';
import { moderateUsername } from './chat-moderation-gemini.js';
import { getPlatformEnv } from './platform-env-config.js';

const DEFAULT_DISPLAY_NAME_POLICY = `みんなでメタ ロビー参加用「表示名」ポリシー（要約）:
ヘイト・ハラスメント、重度の暴言・差別、露骨な性的表現、他者への攻撃や脅迫を想起させる名前、スパム・宣伝目的の名前、意味のない記号や文字の羂列だけの名前は拒否する。
一般的なニックネーム、プレイヤー名、名前＋番号、無害な短い呼び名は許可する。`;

const DEFAULT_DISPLAY_NAME_REJECT_QUESTION =
    'この pending_message は、state に記載のポリシーに照らしてロビー参加用の表示名を拒否すべきか。';

/**
 * @typedef {{ allowed: boolean, inappropriate?: boolean, skipped?: boolean, moderationError?: boolean, reason_ja?: string, jev_noul?: number }} DisplayNameModerationResult
 */

/**
 * @param {{ displayName: string, fetchJev?: typeof fetch }} params
 * @returns {Promise<DisplayNameModerationResult>}
 */
export async function moderateDisplayNameForJoin(params) {
    const trimmed = String(params.displayName || '').trim();
    if (!trimmed) return { allowed: true, skipped: true };

    const cfg = getChatModerationPipelineConfig();
    const jevOn =
        cfg.pipeline === 'jev-gemini' && cfg.jev.enabled && cfg.jev.apiKey.length > 0;
    const geminiKey = String(getPlatformEnv('GEMINI_API_KEY') || '').trim();
    if (!jevOn && !geminiKey) return { allowed: true, skipped: true };

    const policyText = String(
        process.env.DISPLAY_NAME_JEV_POLICY_TEXT || DEFAULT_DISPLAY_NAME_POLICY,
    ).trim();
    const rejectQuestion = String(
        process.env.DISPLAY_NAME_JEV_REJECT_QUESTION || DEFAULT_DISPLAY_NAME_REJECT_QUESTION,
    ).trim();

    if (jevOn) {
        try {
            const { noul } = await scoreJevChatReject({
                messageText: trimmed,
                fetchImpl: params.fetchJev,
                overrides: {
                    policyText,
                    rejectQuestion,
                },
            });
            if (!shouldRejectFromJevNoul(noul, cfg.jev.rejectThreshold)) {
                return { allowed: true, inappropriate: false, jev_noul: noul };
            }
            if (geminiKey) {
                const detail = await moderateUsername({
                    apiKey: geminiKey,
                    modelFromEnv: getPlatformEnv('GEMINI_MODEL'),
                    displayName: trimmed,
                });
                if (detail.inappropriate) {
                    return {
                        allowed: false,
                        inappropriate: true,
                        reason_ja:
                            detail.reason_ja ||
                            '表示名がポリシーに適合しません。別の名前をお試しください。',
                        jev_noul: noul,
                    };
                }
                return { allowed: true, inappropriate: false, jev_noul: noul };
            }
            return {
                allowed: false,
                inappropriate: true,
                reason_ja: '表示名がポリシーに適合しません。別の名前をお試しください。',
                jev_noul: noul,
            };
        } catch (err) {
            console.warn('[NAME_MOD] platform Jev moderation failed:', err?.message || err);
            if (!geminiKey) {
                return { allowed: true, skipped: true, moderationError: true };
            }
        }
    }

    if (geminiKey) {
        try {
            const detail = await moderateUsername({
                apiKey: geminiKey,
                modelFromEnv: getPlatformEnv('GEMINI_MODEL'),
                displayName: trimmed,
            });
            if (detail.inappropriate) {
                return {
                    allowed: false,
                    inappropriate: true,
                    reason_ja:
                        detail.reason_ja || '表示名がポリシーに適合しません。別の名前をお試しください。',
                };
            }
            return { allowed: true, inappropriate: false };
        } catch (err) {
            console.warn('[NAME_MOD] platform Gemini moderation failed:', err?.message || err);
            return { allowed: true, skipped: true, moderationError: true };
        }
    }

    return { allowed: true, skipped: true };
}
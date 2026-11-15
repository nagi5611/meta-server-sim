// lib/chat-moderation.js — Jev 一発判定 → NG 時のみ Gemini 詳細（ScienceSub チャット検閲）
import { getChatModerationPipelineConfig } from './chat-moderation-config.js';
import {
    extractPendingChatText,
    scoreJevChatReject,
    shouldRejectFromJevNoul,
} from './chat-moderation-jev.js';
import {
    moderateChatMessageGemini,
    moderateUsername,
    getModerationSystemPromptsForAdmin,
    buildEffectiveChatModerationInstruction,
    buildEffectiveUsernameModerationInstruction,
} from './chat-moderation-gemini.js';

export {
    moderateUsername,
    getModerationSystemPromptsForAdmin,
    buildEffectiveChatModerationInstruction,
    buildEffectiveUsernameModerationInstruction,
};

/**
 * @typedef {{ inappropriate: boolean, absolute_broadcast_block: boolean, reason_ja?: string, moderation_stage?: string, jev_noul?: number }} ModerationResult
 */

/**
 * チャット文脈と送信予定1行をモデレートする
 * @param {{ apiKey: string, model?: string, historyTableText: string, pendingLine: string, fetchJev?: typeof fetch }} params
 * @returns {Promise<ModerationResult>}
 */
export async function moderateChatMessage(params) {
    const cfg = getChatModerationPipelineConfig();
    const useJev =
        cfg.pipeline === 'jev-gemini' && cfg.jev.enabled && cfg.jev.apiKey.length > 0;

    if (!useJev) {
        const result = await moderateChatMessageGemini(params);
        return { ...result, moderation_stage: 'gemini_only' };
    }

    const messageText = extractPendingChatText(params.pendingLine);
    const { noul } = await scoreJevChatReject({
        messageText,
        fetchImpl: params.fetchJev,
    });

    if (!shouldRejectFromJevNoul(noul, cfg.jev.rejectThreshold)) {
        return {
            inappropriate: false,
            absolute_broadcast_block: false,
            reason_ja: '',
            moderation_stage: 'jev_pass',
            jev_noul: noul,
        };
    }

    if (!params.apiKey) {
        throw new Error('GEMINI_API_KEY is required when Jev flags reject for detail moderation');
    }

    const detail = await moderateChatMessageGemini(params);
    return {
        ...detail,
        moderation_stage: 'jev_reject_gemini_detail',
        jev_noul: noul,
    };
}

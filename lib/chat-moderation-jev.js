// lib/chat-moderation-jev.js — TypeSafe Jev 一発判定（単一投稿のみ state、履歴は詰めない）
import {
    assertValidJevRejectThreshold,
    getChatModerationPipelineConfig,
} from './chat-moderation-config.js';

/**
 * pendingLine（時刻 | socketId | 本文）から本文のみ抽出
 * @param {string} pendingLine
 */
export function extractPendingChatText(pendingLine) {
    const raw = String(pendingLine ?? '').trim();
    if (!raw) return '';
    const parts = raw.split('|').map((p) => p.trim());
    if (parts.length >= 3) {
        return parts.slice(2).join('|').trim();
    }
    return raw;
}

/**
 * Jev state: 単一 pending_message のみ（相互汚染防止）
 * @param {string} messageText
 * @param {string} policyText
 */
export function buildJevModerationState(messageText, policyText) {
    return {
        policy: String(policyText || '').trim(),
        pending_message: String(messageText || '').trim(),
    };
}

/**
 * @param {number} noul reject=true の確率
 * @param {number} rejectThreshold
 */
export function shouldRejectFromJevNoul(noul, rejectThreshold) {
    assertValidJevRejectThreshold(rejectThreshold);
    const p = Number(noul);
    if (!Number.isFinite(p)) {
        throw new Error('Jev noul is not a finite number');
    }
    return p >= rejectThreshold;
}

/**
 * @param {unknown} body
 * @param {string} questionKey
 */
export function parseJevNoulAnswer(body, questionKey = 'should_reject') {
    if (!body || typeof body !== 'object') {
        throw new Error('Jev response body is not an object');
    }
    /** @type {Record<string, unknown>} */
    const root = /** @type {Record<string, unknown>} */ (body);
    const answers = root.answers && typeof root.answers === 'object' ? root.answers : root;
    const entry = answers[questionKey];
    if (!entry || typeof entry !== 'object') {
        throw new Error(`Jev missing answer for question: ${questionKey}`);
    }
    const noul = /** @type {{ noul?: number }} */ (entry).noul;
    if (typeof noul !== 'number' || !Number.isFinite(noul)) {
        throw new Error('Jev noul missing or invalid');
    }
    return Math.min(1, Math.max(0, noul));
}

/**
 * @param {{
 *   messageText: string,
 *   fetchImpl?: typeof fetch,
 *   overrides?: Partial<ReturnType<typeof getChatModerationPipelineConfig>['jev']>,
 * }} params
 * @returns {Promise<{ noul: number, model?: string }>}
 */
export async function scoreJevChatReject(params) {
    const cfg = getChatModerationPipelineConfig();
    const jev = { ...cfg.jev, ...params.overrides };
    if (!jev.apiKey) {
        throw new Error('TYPESAFE_API_KEY (or JEV_API_KEY) is not set');
    }
    assertValidJevRejectThreshold(jev.rejectThreshold);

    const state = buildJevModerationState(params.messageText, jev.policyText);
    const payload = {
        model: jev.model,
        state,
        questions: {
            should_reject: {
                type: 'noul',
                instructions: jev.rejectQuestion,
            },
        },
    };

    const fetchImpl = params.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), jev.timeoutMs);

    try {
        const res = await fetchImpl(jev.apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${jev.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`Jev HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        const body = JSON.parse(text);
        const noul = parseJevNoulAnswer(body);
        const model =
            typeof body.model === 'string'
                ? body.model
                : typeof body?.metadata?.model === 'string'
                  ? body.metadata.model
                  : undefined;
        return { noul, model };
    } finally {
        clearTimeout(timer);
    }
}

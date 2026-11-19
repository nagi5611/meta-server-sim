/**
 * @param {string} displayName
 * @param {string} policyText
 */
export function buildJevDisplayNameState(displayName, policyText) {
    const safe = String(displayName || '')
        .replace(/\|/g, '｜')
        .replace(/\r?\n/g, ' ')
        .trim();
    return {
        policy: String(policyText || '').trim(),
        pending_message: safe,
    };
}

/**
 * @param {unknown} body
 * @param {string} [questionKey]
 */
export function parseJevNoulAnswer(body, questionKey = 'should_reject') {
    if (!body || typeof body !== 'object') {
        throw new Error('Jev response body is not an object');
    }
    const root = /** @type {Record<string, unknown>} */ (body);
    const answers = root.answers && typeof root.answers === 'object' ? root.answers : root;
    const entry = /** @type {Record<string, unknown>} */ (answers)[questionKey];
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
 * @param {number} noul
 * @param {number} rejectThreshold
 */
export function shouldRejectFromJevNoul(noul, rejectThreshold) {
    const p = Number(noul);
    const t = Number(rejectThreshold);
    if (!Number.isFinite(p) || !Number.isFinite(t) || t < 0 || t > 1) {
        throw new Error('Invalid Jev noul or reject threshold');
    }
    return p >= t;
}

/**
 * @param {{
 *   displayName: string,
 *   cfg: ReturnType<typeof import('./display-name-moderation-config.js').getLobbyDisplayNameModerationConfig>,
 *   fetchImpl?: typeof fetch,
 * }} params
 */
export async function scoreJevDisplayNameReject(params) {
    const { displayName, cfg, fetchImpl = fetch } = params;
    if (!cfg.apiKey) {
        throw new Error('LOBBY_JEV_API_KEY (or JEV_API_KEY) is not set');
    }

    const state = buildJevDisplayNameState(displayName, cfg.policyText);
    const payload = {
        model: cfg.model,
        state,
        questions: {
            should_reject: {
                type: 'noul',
                instructions: cfg.rejectQuestion,
            },
        },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
        const res = await fetchImpl(cfg.apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${cfg.apiKey}`,
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
        return { noul };
    } finally {
        clearTimeout(timer);
    }
}
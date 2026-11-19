import { ANNOUNCEMENT_LOCALES, normalizeAnnouncementLocale } from './announcement-i18n.js';

/** Gemini 3 Flash Lite family — stable id per Google AI docs (user-facing "3.0 Flash Lite"). */
export const DEFAULT_ANNOUNCEMENT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

const TRANSLATION_TIMEOUT_MS = 25_000;

const LOCALE_LABEL = {
    ja: 'Japanese',
    'zh-CN': 'Simplified Chinese',
    'zh-TW': 'Traditional Chinese (Taiwan)',
    en: 'English',
};

/**
 * @typedef {{ title: string, body: string }} AnnText
 * @typedef {Record<string, AnnText>} AnnI18nMap
 */

/**
 * @param {AnnI18nMap} base
 * @param {string} sourceLocale
 * @param {string} title
 * @param {string} body
 * @returns {AnnI18nMap}
 */
export function sourceOnlyAnnouncementI18n(sourceLocale, title, body) {
    const loc = normalizeAnnouncementLocale(sourceLocale);
    return { [loc]: { title, body } };
}

/**
 * @param {{
 *   apiKey?: string,
 *   model?: string,
 *   sourceLocale: string,
 *   title: string,
 *   body: string,
 *   fetchImpl?: typeof fetch,
 * }} params
 * @returns {Promise<{ i18n: AnnI18nMap, translated: boolean }>}
 */
export async function translateAnnouncementFields(params) {
    const { apiKey, model, title, body, fetchImpl = fetch } = params;
    const sourceLocale = normalizeAnnouncementLocale(params.sourceLocale);
    const trimmedTitle = String(title || '').trim();
    const trimmedBody = String(body || '').trim();

    if (!String(apiKey || '').trim()) {
        return { i18n: sourceOnlyAnnouncementI18n(sourceLocale, trimmedTitle, trimmedBody), translated: false };
    }

    const targets = ANNOUNCEMENT_LOCALES.filter((l) => l !== sourceLocale);
    if (!targets.length) {
        return {
            i18n: sourceOnlyAnnouncementI18n(sourceLocale, trimmedTitle, trimmedBody),
            translated: false,
        };
    }

    const modelName =
        String(model || DEFAULT_ANNOUNCEMENT_GEMINI_MODEL).trim() || DEFAULT_ANNOUNCEMENT_GEMINI_MODEL;
    const targetList = targets.map((l) => `${l} (${LOCALE_LABEL[l]})`).join(', ');
    const titleOnly = !trimmedBody;

    const systemInstruction = titleOnly
        ? `You translate lobby announcement titles (single line, no body text).
Source language locale code: ${sourceLocale}.
Target locale codes: ${targetList}.
Output JSON only, matching the response schema.
For each target locale, provide a natural title translation. Do not add disclaimers. Keep proper nouns unchanged.`
        : `You translate lobby announcement title and body text.
Source language locale code: ${sourceLocale}.
Target locale codes: ${targetList}.
Output JSON only, matching the response schema.
For each target locale, provide natural translations preserving tone and line breaks in body.
Do not add disclaimers. Keep proper nouns and URLs unchanged.`;

    const userText = JSON.stringify(
        titleOnly
            ? { sourceLocale, title: trimmedTitle, targetLocales: targets }
            : { sourceLocale, title: trimmedTitle, body: trimmedBody, targetLocales: targets },
    );

    const localeSchema = (code) =>
        titleOnly
            ? {
                  type: 'OBJECT',
                  properties: { title: { type: 'STRING' } },
                  required: ['title'],
              }
            : {
                  type: 'OBJECT',
                  properties: {
                      title: { type: 'STRING' },
                      body: { type: 'STRING' },
                  },
                  required: ['title', 'body'],
              };

    const responseSchema = {
        type: 'OBJECT',
        properties: {
            translations: {
                type: 'OBJECT',
                description: titleOnly
                    ? 'Keys are locale codes; values hold title in that language.'
                    : 'Keys are locale codes; values hold title and body in that language.',
                properties: Object.fromEntries(targets.map((code) => [code, localeSchema(code)])),
                required: targets,
            },
        },
        required: ['translations'],
    };

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;

    const bodyPayload = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            responseSchema,
        },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRANSLATION_TIMEOUT_MS);

    try {
        const res = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-goog-api-key': String(apiKey).trim(),
            },
            body: JSON.stringify(bodyPayload),
            signal: controller.signal,
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn('[ANN_TR] Gemini HTTP', res.status, errText.slice(0, 200));
            return {
                i18n: sourceOnlyAnnouncementI18n(sourceLocale, trimmedTitle, trimmedBody),
                translated: false,
            };
        }
        const data = await res.json();
        const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawJson) {
            console.warn('[ANN_TR] empty Gemini response');
            return {
                i18n: sourceOnlyAnnouncementI18n(sourceLocale, trimmedTitle, trimmedBody),
                translated: false,
            };
        }
        const parsed = JSON.parse(rawJson);
        const translations = parsed?.translations;
        if (!translations || typeof translations !== 'object') {
            return {
                i18n: sourceOnlyAnnouncementI18n(sourceLocale, trimmedTitle, trimmedBody),
                translated: false,
            };
        }

        /** @type {AnnI18nMap} */
        const i18n = {
            [sourceLocale]: { title: trimmedTitle, body: trimmedBody },
        };
        let anyTranslated = false;
        for (const code of ANNOUNCEMENT_LOCALES) {
            if (code === sourceLocale) continue;
            const part = translations[code];
            const tTitle =
                typeof part?.title === 'string' && part.title.trim() ? part.title.trim() : trimmedTitle;
            const tBody = titleOnly
                ? ''
                : typeof part?.body === 'string' && part.body.trim()
                  ? part.body.trim()
                  : trimmedBody;
            i18n[code] = { title: tTitle, body: tBody };
            if (tTitle !== trimmedTitle || (!titleOnly && tBody !== trimmedBody)) anyTranslated = true;
        }
        return { i18n, translated: anyTranslated };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('apiKey') && !msg.includes('GEMINI')) {
            console.warn('[ANN_TR] translate failed:', msg);
        }
        return {
            i18n: sourceOnlyAnnouncementI18n(sourceLocale, trimmedTitle, trimmedBody),
            translated: false,
        };
    } finally {
        clearTimeout(timer);
    }
}
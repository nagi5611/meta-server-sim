// lib/gemini-generate-content.js — Gemini generateContent（AI Studio SDK / Cloudflare / AI Gateway）

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getCloudflareAccountId, getCloudflareApiToken } from './d1/d1-config.js';
import {
    getGeminiAiGatewayBaseUrl,
    getGeminiApiProvider,
    normalizeAiStudioModelId,
    resolveGeminiModelNames,
} from './gemini-api-runtime.js';

/**
 * @param {unknown} payload
 * @returns {{ promptFeedback?: object, text: string, raw: unknown }}
 */
export function parseGeminiGeneratePayload(payload) {
    const inner = payload?.result != null && payload?.success != null ? payload.result : payload;
    const promptFeedback = inner?.promptFeedback;
    const parts = inner?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
        ? parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('')
        : '';
    return { promptFeedback, text, raw: inner };
}

/**
 * @param {string} systemInstruction
 */
function systemInstructionToGeminiParts(systemInstruction) {
    const text = String(systemInstruction || '').trim();
    if (!text) return undefined;
    return { parts: [{ text }] };
}

/**
 * @param {{
 *   model: string,
 *   systemInstruction: string,
 *   contents: object[],
 *   generationConfig: object,
 *   timeoutMs: number,
 *   fetchImpl?: typeof fetch,
 * }} p
 */
async function cloudflareWorkersAiGenerate(p) {
    const accountId = getCloudflareAccountId();
    const token = getCloudflareApiToken();
    if (!accountId || !token) {
        throw new Error('Cloudflare Workers AI is not configured (CLOUDFLARE_API_TOKEN and account id)');
    }
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`;
    const input = {
        contents: p.contents,
        generationConfig: p.generationConfig,
    };
    const sys = systemInstructionToGeminiParts(p.systemInstruction);
    if (sys) input.systemInstruction = sys;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), p.timeoutMs);
    try {
        const res = await (p.fetchImpl || fetch)(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ model: p.model, input }),
            signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success === false) {
            const msg =
                data?.errors?.map((e) => e.message).filter(Boolean).join('; ') ||
                res.statusText ||
                'Cloudflare AI request failed';
            throw new Error(msg);
        }
        return parseGeminiGeneratePayload(data);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * @param {{
 *   aiStudioModel: string,
 *   apiKey: string,
 *   systemInstruction: string,
 *   contents: object[],
 *   generationConfig: object,
 *   timeoutMs: number,
 *   fetchImpl?: typeof fetch,
 * }} p
 */
async function aiGatewayGenerate(p) {
    const base = getGeminiAiGatewayBaseUrl();
    const token = getCloudflareApiToken();
    if (!base || !token) {
        throw new Error('AI Gateway is not configured (GEMINI_AI_GATEWAY_ID, account id, CLOUDFLARE_API_TOKEN)');
    }
    const modelPath = encodeURIComponent(normalizeAiStudioModelId(p.aiStudioModel));
    const endpoint = `${base}/v1beta/models/${modelPath}:generateContent`;
    const body = {
        systemInstruction: systemInstructionToGeminiParts(p.systemInstruction),
        contents: p.contents,
        generationConfig: p.generationConfig,
    };

    const headers = {
        'content-type': 'application/json',
        'cf-aig-authorization': `Bearer ${token}`,
    };
    const studioKey = String(p.apiKey || '').trim();
    if (studioKey) {
        headers['x-goog-api-key'] = studioKey;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), p.timeoutMs);
    try {
        const res = await (p.fetchImpl || fetch)(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg =
                data?.error?.message ||
                data?.errors?.map((e) => e.message).filter(Boolean).join('; ') ||
                res.statusText;
            throw new Error(msg);
        }
        return parseGeminiGeneratePayload(data);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * @param {{
 *   apiKey?: string,
 *   modelFromEnv?: string,
 *   systemInstruction: string,
 *   contents: object[],
 *   generationConfig: object,
 *   timeoutMs: number,
 *   fetchImpl?: typeof fetch,
 * }} params
 * @returns {Promise<{ promptFeedback?: object, text: string, raw: unknown }>}
 */
export async function geminiGenerateContent(params) {
    const provider = getGeminiApiProvider();
    const { cloudflareModel, aiStudioModel } = resolveGeminiModelNames({
        modelFromEnv: params.modelFromEnv,
        provider,
    });
    const contents = params.contents;
    const generationConfig = params.generationConfig;
    const timeoutMs = params.timeoutMs;

    if (provider === 'cloudflare') {
        return cloudflareWorkersAiGenerate({
            model: cloudflareModel,
            systemInstruction: params.systemInstruction,
            contents,
            generationConfig,
            timeoutMs,
            fetchImpl: params.fetchImpl,
        });
    }

    if (provider === 'ai-gateway') {
        return aiGatewayGenerate({
            aiStudioModel,
            apiKey: params.apiKey || '',
            systemInstruction: params.systemInstruction,
            contents,
            generationConfig,
            timeoutMs,
            fetchImpl: params.fetchImpl,
        });
    }

    const apiKey = String(params.apiKey || '').trim();
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is required when GEMINI_API_PROVIDER=ai-studio');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: aiStudioModel,
        systemInstruction: params.systemInstruction,
        generationConfig,
    });
    const result = await model.generateContent(
        { contents },
        { timeout: timeoutMs },
    );
    const response = result.response;
    const pf = response.promptFeedback;
    return {
        promptFeedback: pf,
        text: response.text(),
        raw: response,
    };
}
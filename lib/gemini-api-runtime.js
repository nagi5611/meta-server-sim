// lib/gemini-api-runtime.js — Gemini 呼び出し先（AI Studio / Cloudflare Workers AI）の解決

import { getCloudflareAccountId, getCloudflareApiToken } from './d1/d1-config.js';
import { getPlatformEnv } from './platform-env-config.js';

/** Cloudflare AI Gateway / Workers AI カタログ上の 3.5 Flash Lite */
export const GEMINI_CF_DEFAULT_MODEL = 'google/gemini-3.5-flash-lite';

/** Google AI Studio 直叩き時の既定（フォールバック用） */
export const GEMINI_AI_STUDIO_DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';

/**
 * @returns {'ai-studio' | 'cloudflare' | 'ai-gateway'}
 */
export function getGeminiApiProvider() {
    const raw = String(
        getPlatformEnv('GEMINI_API_PROVIDER') || process.env.GEMINI_API_PROVIDER || 'ai-studio',
    )
        .trim()
        .toLowerCase();
    if (raw === 'cloudflare' || raw === 'workers-ai' || raw === 'cf' || raw === 'workers_ai') {
        return 'cloudflare';
    }
    if (raw === 'ai-gateway' || raw === 'gateway' || raw === 'aig') {
        return 'ai-gateway';
    }
    return 'ai-studio';
}

/**
 * @param {{ modelFromEnv?: string, provider?: ReturnType<typeof getGeminiApiProvider> }} [opts]
 */
export function resolveGeminiModelNames(opts = {}) {
    const provider = opts.provider || getGeminiApiProvider();
    const envModel = String(
        opts.modelFromEnv || getPlatformEnv('GEMINI_MODEL') || process.env.GEMINI_MODEL || '',
    ).trim();

    if (provider === 'cloudflare' || provider === 'ai-gateway') {
        const cfModel = String(
            getPlatformEnv('GEMINI_CF_MODEL') || process.env.GEMINI_CF_MODEL || '',
        ).trim();
        const cloudflareModel =
            cfModel ||
            (envModel.startsWith('google/') ? envModel : '') ||
            GEMINI_CF_DEFAULT_MODEL;
        return {
            cloudflareModel,
            aiStudioModel:
                envModel && !envModel.startsWith('google/')
                    ? envModel
                    : GEMINI_AI_STUDIO_DEFAULT_MODEL,
        };
    }

    return {
        cloudflareModel: GEMINI_CF_DEFAULT_MODEL,
        aiStudioModel: envModel || GEMINI_AI_STUDIO_DEFAULT_MODEL,
    };
}

/**
 * AI Gateway（Google AI Studio プロキシ）のベース URL（末尾スラッシュなし）
 * @returns {string}
 */
export function getGeminiAiGatewayBaseUrl() {
    const accountId = getCloudflareAccountId();
    const gatewayId = String(
        getPlatformEnv('GEMINI_AI_GATEWAY_ID') || process.env.GEMINI_AI_GATEWAY_ID || '',
    ).trim();
    if (!accountId || !gatewayId) return '';
    return `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/google-ai-studio`;
}

/**
 * Cloudflare 経由で Gemini を使えるか（アカウント ID + API トークン）
 * @returns {boolean}
 */
export function isCloudflareGeminiConfigured() {
    return Boolean(getCloudflareAccountId() && getCloudflareApiToken());
}

/**
 * Google AI Studio 直叩き用キーが設定されているか
 * @returns {boolean}
 */
export function isAiStudioGeminiConfigured() {
    return Boolean(String(getPlatformEnv('GEMINI_API_KEY') || process.env.GEMINI_API_KEY || '').trim());
}

/**
 * 現在の provider 設定で Gemini 機能を利用可能か
 * @returns {boolean}
 */
export function isGeminiConfigured() {
    const provider = getGeminiApiProvider();
    if (provider === 'cloudflare') {
        return isCloudflareGeminiConfigured();
    }
    if (provider === 'ai-gateway') {
        return isCloudflareGeminiConfigured() && Boolean(getGeminiAiGatewayBaseUrl());
    }
    return isAiStudioGeminiConfigured();
}

/**
 * AI Studio モデル ID を AI Gateway / generateContent パス用に正規化
 * @param {string} aiStudioModel
 * @returns {string}
 */
export function normalizeAiStudioModelId(aiStudioModel) {
    const m = String(aiStudioModel || '').trim();
    if (!m) return GEMINI_AI_STUDIO_DEFAULT_MODEL;
    return m.startsWith('models/') ? m.slice('models/'.length) : m;
}
// lib/tenant-chat-socket.js — テナント向けチャット・絵文字・UI ロケール Socket.io ハンドラ

import { moderateChatMessage } from '../../metaverse-simple/lib/chat-moderation.js';
import { translateChatMessage } from '../../metaverse-simple/lib/chat-translation.js';
import { findNgPhraseMatch } from '../../metaverse-simple/lib/chat-ng-words.js';
import {
    getListenerTargetLocales,
    normalizeUiLocale,
} from '../../metaverse-simple/lib/ui-locale.js';
import { getPlatformEnv } from './platform-env-config.js';

const CHAT_USER_MIN_INTERVAL_MS = 1000;
const CHAT_ROOM_MAX_PER_WINDOW = 5;
const CHAT_ROOM_WINDOW_MS = 1000;
const CHAT_POINT_TTL_MS = 12 * 60 * 60 * 1000;
const CHAT_MUTE_DURATION_MS = 6 * 60 * 60 * 1000;
const CHAT_POINTS_THRESHOLD_MUTE = 10;
const CHAT_APPROVED_MAX_AGE_MS = 60 * 60 * 1000;
const CHAT_APPROVED_MAX_ENTRIES = 300;
const MAX_CHAT_LOGS_PER_ROOM = 500;

const CHAT_ALERT_FULL_BLOCK =
    'チャット警告。今のチャットをブロックしました。理由は以下のとおりです。\n\n';
const CHAT_ALERT_WARN_SHARE =
    'チャット警告。他のユーザーには警告表示付きで表示されます。理由は以下のとおりです。\n\n';

/** @type {Map<string, number>} */
const chatUserLastSuccessAt = new Map();
/** @type {Map<string, Array<{ ts: number, id: number }>>} */
const chatRoomRecentSlots = new Map();
let chatRoomSlotSeq = 0;
/** @type {Map<string, Array<{timestamp:number,senderId:string,senderName:string,message:string}>>} */
const chatApprovedByRoom = new Map();
/** @type {Map<string, { pointAt: number[], muteUntil: number }>} */
const chatModerationBySocket = new Map();
/** @type {Set<string>} */
const chatModerationInFlight = new Set();
/** @type {Map<string, Array<{timestamp: number, senderName: string, message: string, senderId?: string}>>} */
const chatLogs = new Map();

/**
 * @param {string} tenantId
 * @param {string} worldId
 * @returns {string}
 */
function buildChatRoomKey(tenantId, worldId) {
    return `${tenantId}:${worldId}`;
}

/**
 * @param {unknown} callback
 * @param {object} payload
 */
function chatReplyAck(callback, payload) {
    if (typeof callback === 'function') {
        try {
            callback(payload);
        } catch {
            /* ignore */
        }
    }
}

/**
 * @param {string} roomKey
 * @param {number} now
 * @returns {Array<{ ts: number, id: number }>}
 */
function pruneChatRoomSlots(roomKey, now) {
    let arr = chatRoomRecentSlots.get(roomKey);
    if (!arr) return [];
    const cutoff = now - CHAT_ROOM_WINDOW_MS;
    arr = arr.filter((e) => e.ts >= cutoff);
    chatRoomRecentSlots.set(roomKey, arr);
    return arr;
}

/**
 * @param {string} roomKey
 * @param {number} now
 * @returns {number|null}
 */
function reserveChatRoomSlot(roomKey, now) {
    const arr = pruneChatRoomSlots(roomKey, now);
    if (arr.length >= CHAT_ROOM_MAX_PER_WINDOW) {
        return null;
    }
    const id = ++chatRoomSlotSeq;
    arr.push({ ts: now, id });
    chatRoomRecentSlots.set(roomKey, arr);
    return id;
}

/**
 * @param {string} roomKey
 * @param {number|null} slotId
 */
function releaseChatRoomSlot(roomKey, slotId) {
    if (slotId == null) return;
    const arr = chatRoomRecentSlots.get(roomKey);
    if (!arr || arr.length === 0) return;
    const idx = arr.findIndex((e) => e.id === slotId);
    if (idx >= 0) arr.splice(idx, 1);
}

/**
 * @param {string} roomKey
 * @param {number} now
 * @returns {string}
 */
function getApprovedHistoryTableText(roomKey, now) {
    const arr = chatApprovedByRoom.get(roomKey);
    if (!arr || arr.length === 0) return '';
    const cutoff = now - CHAT_APPROVED_MAX_AGE_MS;
    const filtered = arr.filter((e) => e.timestamp >= cutoff).slice(-CHAT_APPROVED_MAX_ENTRIES);
    return filtered
        .map((e) => {
            const t = new Date(e.timestamp).toISOString();
            const safeMsg = String(e.message).replace(/\|/g, '｜').replace(/\r?\n/g, ' ');
            return `${t} | ${e.senderId} | ${safeMsg}`;
        })
        .join('\n');
}

/**
 * @param {string} roomKey
 * @param {{timestamp:number,senderId:string,senderName:string,message:string}} entry
 * @param {number} now
 */
function appendApprovedChat(roomKey, entry, now) {
    if (!chatApprovedByRoom.has(roomKey)) {
        chatApprovedByRoom.set(roomKey, []);
    }
    const arr = chatApprovedByRoom.get(roomKey);
    arr.push(entry);
    const cutoff = now - CHAT_APPROVED_MAX_AGE_MS;
    let kept = arr.filter((e) => e.timestamp >= cutoff);
    if (kept.length > CHAT_APPROVED_MAX_ENTRIES) {
        kept = kept.slice(-CHAT_APPROVED_MAX_ENTRIES);
    }
    chatApprovedByRoom.set(roomKey, kept);
}

/**
 * @param {string} socketId
 * @param {number} now
 */
function registerChatInappropriate(socketId, now) {
    let m = chatModerationBySocket.get(socketId);
    if (!m) {
        m = { pointAt: [], muteUntil: 0 };
        chatModerationBySocket.set(socketId, m);
    }
    m.pointAt = m.pointAt.filter((t) => now - t < CHAT_POINT_TTL_MS);
    m.pointAt.push(now);
    m.pointAt = m.pointAt.filter((t) => now - t < CHAT_POINT_TTL_MS);
    if (m.pointAt.length > CHAT_POINTS_THRESHOLD_MUTE) {
        m.muteUntil = now + CHAT_MUTE_DURATION_MS;
    }
    return { activePoints: m.pointAt.length, mutedNow: m.muteUntil > now };
}

/**
 * @param {string} socketId
 * @param {number} now
 * @returns {boolean}
 */
function isChatMuted(socketId, now) {
    const m = chatModerationBySocket.get(socketId);
    if (!m) return false;
    return m.muteUntil > now;
}

/**
 * @param {string} roomKey
 * @param {string} senderName
 * @param {string} message
 * @param {string} [senderId]
 */
function addChatLog(roomKey, senderName, message, senderId) {
    if (!chatLogs.has(roomKey)) {
        chatLogs.set(roomKey, []);
    }
    const logs = chatLogs.get(roomKey);
    const row = {
        timestamp: Date.now(),
        senderName,
        message,
    };
    if (senderId) row.senderId = senderId;
    logs.push(row);
    if (logs.length > MAX_CHAT_LOGS_PER_ROOM) {
        logs.shift();
    }
}

/**
 * 受信者の uiLocale に応じて translatedMessage を付与して chat-receive を送る（送信者は常に原文）
 * @param {import('socket.io').Server} ioServer
 * @param {import('socket.io').Socket} senderSocket
 * @param {{ players: Map<string, { uiLocale?: string }> }} roomState
 * @param {string} worldRoomId
 * @param {Record<string, unknown>} chatData
 * @param {Partial<Record<'ja' | 'en' | 'zh' | 'ko' | 'zh-tw', string>>} translationsByLocale
 * @param {Record<string, unknown>} [selfChatData]
 */
function emitChatToRoomWithLocale(
    ioServer,
    senderSocket,
    roomState,
    worldRoomId,
    chatData,
    translationsByLocale,
    selfChatData,
) {
    const senderId = senderSocket.id;
    const originalMessage = typeof chatData.message === 'string' ? chatData.message : '';
    const senderLocale = normalizeUiLocale(senderSocket.data?.uiLocale);

    senderSocket.emit('chat-my-message', selfChatData != null ? selfChatData : chatData);

    for (const [id, p] of roomState.players) {
        if (id === senderId) continue;
        const targetSocket = ioServer.sockets.sockets.get(id);
        if (!targetSocket) continue;
        const listenerLocale = normalizeUiLocale(p.uiLocale);
        const translated = translationsByLocale[listenerLocale];

        let payload = chatData;
        if (listenerLocale !== senderLocale && translated && translated !== originalMessage) {
            payload = { ...chatData, translatedMessage: translated };
        }
        targetSocket.emit('chat-receive', payload);
    }

    void worldRoomId;
}

/**
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server} io
 * @param {{ id: string }} tenant
 * @param {{
 *   getRoomState: (tenantId: string, worldId: string) => { players: Map<string, object> },
 *   getPlayerDisplayName: (player: object) => string,
 * }} deps
 */
export function registerTenantChatSocketHandlers(socket, io, tenant, deps) {
    const tenantId = tenant.id;

    socket.on('chat-message', async (message, callback) => {
        const now = Date.now();
        const ack = (payload) => chatReplyAck(callback, payload);

        if (chatModerationInFlight.has(socket.id)) {
            ack({ ok: false, code: 'in_flight', message: '処理中のチャットがあります。' });
            return;
        }

        const worldId = socket.data.currentRoom;
        if (!worldId) {
            ack({ ok: false, code: 'no_room', message: 'ルームに参加していません。' });
            return;
        }

        const roomState = deps.getRoomState(tenantId, worldId);
        const player = roomState.players.get(socket.id);
        const chatRoomKey = buildChatRoomKey(tenantId, worldId);

        if (!player || message == null || String(message).trim().length === 0) {
            ack({ ok: false, code: 'invalid', message: '無効なメッセージです。' });
            return;
        }

        const text = String(message).trim();
        const displayName = deps.getPlayerDisplayName(player);

        const literalNg = findNgPhraseMatch(text);
        if (literalNg) {
            ack({
                ok: false,
                code: 'ng_word',
                message: '禁止語リストに該当する表現が含まれています。',
            });
            console.warn(`[CHAT_MOD] blocked literal ng_word socket=${socket.id} hit=${literalNg}`);
            return;
        }

        if (isChatMuted(socket.id, now)) {
            ack({ ok: false, code: 'muted', message: 'チャットは一時的に利用できません。' });
            return;
        }

        const lastOk = chatUserLastSuccessAt.get(socket.id) || 0;
        if (now - lastOk < CHAT_USER_MIN_INTERVAL_MS) {
            ack({ ok: false, code: 'user_rate', message: '送信間隔が短すぎます。' });
            return;
        }

        const roomSlotId = reserveChatRoomSlot(chatRoomKey, now);
        if (roomSlotId == null) {
            ack({ ok: false, code: 'room_rate', message: '送信できませんでした' });
            return;
        }

        const apiKey = String(getPlatformEnv('GEMINI_API_KEY') || '').trim();
        if (!apiKey) {
            console.error('[CHAT_MOD] GEMINI_API_KEY is not set; rejecting chat');
            ack({
                ok: false,
                code: 'moderation_config',
                message: 'チャット検証が利用できません。しばらくしてから再度お試しください。',
            });
            releaseChatRoomSlot(chatRoomKey, roomSlotId);
            return;
        }

        chatModerationInFlight.add(socket.id);
        try {
            const historyTableText =
                getApprovedHistoryTableText(chatRoomKey, now) ||
                '(過去の通過済みチャットはありません)';
            const pendingLine = `${new Date(now).toISOString()} | ${socket.id} | ${text.replace(/\|/g, '｜').replace(/\r?\n/g, ' ')}`;

            const senderLocale = normalizeUiLocale(player.uiLocale);
            const targetLocales = getListenerTargetLocales(roomState, socket.id, senderLocale);

            const moderationPromise = moderateChatMessage({
                apiKey,
                model: getPlatformEnv('GEMINI_MODEL'),
                historyTableText,
                pendingLine,
            });

            const translationPromises = targetLocales.map((locale) =>
                translateChatMessage({
                    apiKey,
                    model: getPlatformEnv('GEMINI_MODEL'),
                    text,
                    targetLocale: locale,
                }).then((result) => ({ locale, ...result })),
            );

            let moderation;
            let translationResults;
            try {
                [moderation, translationResults] = await Promise.all([
                    moderationPromise,
                    translationPromises.length > 0
                        ? Promise.all(translationPromises)
                        : Promise.resolve([]),
                ]);
            } catch (modErr) {
                console.error('[CHAT_MOD] API error:', modErr);
                releaseChatRoomSlot(chatRoomKey, roomSlotId);
                ack({
                    ok: false,
                    code: 'moderation_error',
                    message: 'チャットの検証に失敗しました。しばらくしてから再度お試しください。',
                });
                return;
            }

            /** @type {Partial<Record<'ja' | 'en' | 'zh' | 'ko' | 'zh-tw', string>>} */
            const translationsByLocale = {};
            for (const { locale, translated, skipped } of translationResults) {
                if (
                    !skipped &&
                    typeof translated === 'string' &&
                    translated.trim() &&
                    translated !== text
                ) {
                    translationsByLocale[locale] = translated.trim();
                }
            }

            if (moderation.inappropriate) {
                const reason =
                    (moderation.reason_ja && String(moderation.reason_ja).trim()) ||
                    '不適切な内容の可能性があります。';
                const absoluteBlock = moderation.absolute_broadcast_block === true;
                const { activePoints, mutedNow } = registerChatInappropriate(socket.id, now);
                const muteTail =
                    activePoints > CHAT_POINTS_THRESHOLD_MUTE
                        ? '\n\n（警告が多いため、しばらくチャットできません。）'
                        : '';

                const noBroadcastToOthers =
                    absoluteBlock || activePoints > CHAT_POINTS_THRESHOLD_MUTE;

                if (noBroadcastToOthers) {
                    socket.emit('admin-alert', {
                        message: CHAT_ALERT_FULL_BLOCK + reason + muteTail,
                    });
                    ack({ ok: false, code: 'inappropriate', message: reason });
                    console.warn(
                        `[CHAT_MOD] blocked socket=${socket.id} points=${activePoints} absolute=${absoluteBlock} muted=${mutedNow}`,
                    );
                    return;
                }

                socket.emit('admin-alert', {
                    message: CHAT_ALERT_WARN_SHARE + reason,
                });

                const chatDataBase = {
                    senderId: socket.id,
                    senderName: displayName,
                    message: text,
                    timestamp: now,
                };
                const chatDataOthers = { ...chatDataBase, moderationWarning: true };
                const chatDataSelf = { ...chatDataBase, moderationWarning: false };

                console.log(`[CHAT] ${displayName}: ${text} (moderation warning to others)`);
                addChatLog(chatRoomKey, displayName, text, socket.id);
                appendApprovedChat(
                    chatRoomKey,
                    {
                        timestamp: now,
                        senderId: socket.id,
                        senderName: displayName,
                        message: text,
                    },
                    now,
                );

                chatUserLastSuccessAt.set(socket.id, now);

                emitChatToRoomWithLocale(
                    io,
                    socket,
                    roomState,
                    worldId,
                    chatDataOthers,
                    translationsByLocale,
                    chatDataSelf,
                );

                ack({ ok: true });
                return;
            }

            const chatData = {
                senderId: socket.id,
                senderName: displayName,
                message: text,
                timestamp: now,
            };

            console.log(`[CHAT] ${displayName}: ${text}`);
            addChatLog(chatRoomKey, displayName, text, socket.id);
            appendApprovedChat(
                chatRoomKey,
                {
                    timestamp: now,
                    senderId: socket.id,
                    senderName: displayName,
                    message: text,
                },
                now,
            );

            chatUserLastSuccessAt.set(socket.id, now);

            emitChatToRoomWithLocale(io, socket, roomState, worldId, chatData, translationsByLocale);
            ack({ ok: true });
        } finally {
            chatModerationInFlight.delete(socket.id);
        }
    });

    socket.on('send-emoji', (data) => {
        const worldId = socket.data.currentRoom;
        if (!worldId) return;

        const roomState = deps.getRoomState(tenantId, worldId);
        const player = roomState.players.get(socket.id);

        if (!player || !data || !data.emoji) return;

        const displayName = deps.getPlayerDisplayName(player);
        console.log(`[EMOJI] ${displayName}: ${data.emoji}`);

        io.to(worldId).emit('emoji-broadcast', {
            playerId: socket.id,
            playerName: displayName,
            emoji: data.emoji,
        });
    });

    socket.on('set-ui-locale', (locale) => {
        const worldId = socket.data.currentRoom;
        if (!worldId) return;

        const roomState = deps.getRoomState(tenantId, worldId);
        const player = roomState.players.get(socket.id);
        if (!player) return;

        const normalized = normalizeUiLocale(locale);
        player.uiLocale = normalized;
        socket.data.uiLocale = normalized;
    });
}

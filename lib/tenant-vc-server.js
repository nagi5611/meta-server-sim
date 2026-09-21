// lib/tenant-vc-server.js — テナント向け音声 VC Socket.io ハンドラ

import {
    buildVcRoomId,
    getIceServers,
    getOrCreateVCRouter,
    MAX_ACTIVE_PRODUCERS_PER_ROOM,
    mediasoupConfig,
    parseWorldIdFromVcRoom,
} from './tenant-mediasoup-core.js';

/**
 * @typedef {object} TenantVcPeer
 * @property {string} roomId VC ルーム ID（tenantId:worldId）
 * @property {import('mediasoup').types.WebRtcTransport | null} sendTransport
 * @property {import('mediasoup').types.WebRtcTransport | null} recvTransport
 * @property {Map<string, import('mediasoup').types.Producer>} producers
 * @property {Map<string, import('mediasoup').types.Consumer>} consumers
 */

/**
 * @param {string} tenantId
 * @returns {{
 *   vcPeers: Map<string, TenantVcPeer>,
 *   cleanupVCPeer: (socketId: string, io: import('socket.io').Server) => Promise<void>,
 *   emitVcRoomChanged: (socket: import('socket.io').Socket, worldId: string) => void,
 * }}
 */
export function createTenantVcState(tenantId) {
    /** @type {Map<string, TenantVcPeer>} */
    const vcPeers = new Map();

    /**
     * @param {string} socketId
     * @param {import('socket.io').Server} io
     */
    async function cleanupVCPeer(socketId, io) {
        const peer = vcPeers.get(socketId);
        if (!peer) return;

        console.log(`[VC] Cleaning up peer: ${socketId}`);

        const worldRoomId = parseWorldIdFromVcRoom(peer.roomId, tenantId);
        const producerIds = Array.from(peer.producers.keys());
        if (worldRoomId && producerIds.length > 0) {
            for (const producerId of producerIds) {
                io.to(worldRoomId).emit('vc-producer-closed', { producerId });
            }
        }

        for (const [producerId, producer] of peer.producers) {
            try {
                producer.close();
            } catch (error) {
                console.error(`[VC] Error closing producer ${producerId}:`, error);
            }
        }

        for (const [consumerId, consumer] of peer.consumers) {
            try {
                consumer.close();
            } catch (error) {
                console.error(`[VC] Error closing consumer ${consumerId}:`, error);
            }
        }

        if (peer.sendTransport) {
            try {
                peer.sendTransport.close();
            } catch (error) {
                console.error('[VC] Error closing send transport:', error);
            }
        }
        if (peer.recvTransport) {
            try {
                peer.recvTransport.close();
            } catch (error) {
                console.error('[VC] Error closing recv transport:', error);
            }
        }

        vcPeers.delete(socketId);
    }

    /**
     * @param {import('socket.io').Socket} socket
     * @param {string} worldId
     */
    function emitVcRoomChanged(socket, worldId) {
        socket.emit('vc-room-changed', { roomId: worldId });
    }

    return { vcPeers, cleanupVCPeer, emitVcRoomChanged };
}

/**
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server} io
 * @param {{ id: string }} tenant
 * @param {ReturnType<typeof createTenantVcState>} state
 * @param {{
 *   getWorldRoomId: (socket: import('socket.io').Socket) => string | null | undefined,
 *   isValidWorld: (worldId: string) => boolean,
 *   getCaptionDeps?: () => {
 *     captionsRuntimeReady: () => boolean,
 *     captionsNotifySpeaker: (io: import('socket.io').Server, vcRoomId: string, socketId: string) => void,
 *     captionsCloseSession: (socketId: string) => void,
 *   } | null,
 * }} deps
 */
export function registerTenantVcSocketHandlers(socket, io, tenant, state, deps) {
    const { vcPeers, cleanupVCPeer } = state;
    const tenantId = tenant.id;

    socket.on('vc-join', async ({ roomId: worldId }, callback) => {
        try {
            if (!worldId || typeof worldId !== 'string' || !deps.isValidWorld(worldId)) {
                return callback({ error: 'invalid_room' });
            }
            const vcRoomId = buildVcRoomId(tenantId, worldId);
            const router = await getOrCreateVCRouter(vcRoomId);

            if (!vcPeers.has(socket.id)) {
                vcPeers.set(socket.id, {
                    roomId: vcRoomId,
                    sendTransport: null,
                    recvTransport: null,
                    producers: new Map(),
                    consumers: new Map(),
                });
            } else {
                const peer = vcPeers.get(socket.id);
                if (peer) peer.roomId = vcRoomId;
            }

            console.log(`[VC] ${socket.id} joined VC room: ${vcRoomId} (world: ${worldId})`);

            callback({
                rtpCapabilities: router.rtpCapabilities,
                iceServers: await getIceServers(),
            });
        } catch (error) {
            console.error('[VC] Error joining room:', error);
            callback({ error: error.message });
        }
    });

    socket.on('vc-create-transport', async ({ direction }, callback) => {
        try {
            const peer = vcPeers.get(socket.id);
            if (!peer) {
                throw new Error('Peer not found');
            }

            const router = await getOrCreateVCRouter(peer.roomId);
            const transport = await router.createWebRtcTransport({
                ...mediasoupConfig.webRtcTransport,
                enableUdp: true,
                enableTcp: true,
                preferUdp: true,
            });

            if (direction === 'send') {
                peer.sendTransport = transport;
            } else {
                peer.recvTransport = transport;
            }

            transport.on('icestatechange', (iceState) => {
                console.log(
                    `[VC] ${direction} transport ${transport.id} ICE state: ${iceState} (peer: ${socket.id})`,
                );
            });

            transport.on('iceselectedtuplechange', (tuple) => {
                console.log(
                    `[VC] ${direction} transport ${transport.id} ICE selected tuple: ${tuple.protocol} ${tuple.ip}:${tuple.port} (peer: ${socket.id})`,
                );
            });

            transport.on('dtlsstatechange', (dtlsState) => {
                console.log(
                    `[VC] ${direction} transport ${transport.id} DTLS state: ${dtlsState} (peer: ${socket.id})`,
                );
                if (dtlsState === 'failed' || dtlsState === 'closed') {
                    console.error(`[VC] ❌ ${direction} transport DTLS FAILED for ${socket.id}`);
                }
            });

            transport.on('sctpstatechange', (sctpState) => {
                console.log(
                    `[VC] ${direction} transport ${transport.id} SCTP state: ${sctpState} (peer: ${socket.id})`,
                );
            });

            console.log(`[VC] Created ${direction} transport for ${socket.id}`, {
                transportId: transport.id,
                iceCandidates: transport.iceCandidates.map(
                    (c) => `${c.protocol} ${c.ip}:${c.port} (${c.type})`,
                ),
            });

            callback({
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            });
        } catch (error) {
            console.error('[VC] Error creating transport:', error);
            callback({ error: error.message });
        }
    });

    socket.on('vc-connect-transport', async ({ transportId, dtlsParameters }, callback) => {
        try {
            const peer = vcPeers.get(socket.id);
            if (!peer) {
                throw new Error('Peer not found');
            }

            const transport =
                peer.sendTransport?.id === transportId ? peer.sendTransport : peer.recvTransport;
            if (!transport) {
                throw new Error('Transport not found');
            }

            await transport.connect({ dtlsParameters });
            console.log(`[VC] Transport ${transportId} connected for ${socket.id}`);

            callback({ success: true });
        } catch (error) {
            console.error('[VC] Error connecting transport:', error);
            callback({ error: error.message });
        }
    });

    socket.on('vc-set-mic', async ({ enabled }, callback) => {
        try {
            const peer = vcPeers.get(socket.id);
            if (!peer) {
                throw new Error('Peer not found');
            }

            const worldRoomId = parseWorldIdFromVcRoom(peer.roomId, tenantId);
            const captionDeps = deps.getCaptionDeps?.() ?? null;

            if (enabled) {
                const activeProducers = Array.from(vcPeers.values()).filter(
                    (p) => p.roomId === peer.roomId && p.producers.size > 0,
                ).length;

                if (activeProducers >= MAX_ACTIVE_PRODUCERS_PER_ROOM) {
                    console.log(
                        `[VC] Mic denied for ${socket.id}: max ${MAX_ACTIVE_PRODUCERS_PER_ROOM} active`,
                    );
                    callback({
                        denied: true,
                        reason: `同時マイクONは最大${MAX_ACTIVE_PRODUCERS_PER_ROOM}人までです`,
                    });
                    return;
                }

                callback({ allowed: true });

                if (captionDeps?.captionsRuntimeReady()) {
                    captionDeps.captionsNotifySpeaker(io, peer.roomId, socket.id);
                }
            } else {
                if (peer.sendTransport) {
                    for (const [producerId, producer] of peer.producers) {
                        producer.close();
                        peer.producers.delete(producerId);

                        if (worldRoomId) {
                            socket.to(worldRoomId).emit('vc-producer-closed', { producerId });
                        }
                    }

                    peer.sendTransport.close();
                    peer.sendTransport = null;
                }

                console.log(`[VC] Mic OFF for ${socket.id}, sendTransport closed`);
                callback({ success: true });

                captionDeps?.captionsCloseSession(socket.id);
            }
        } catch (error) {
            console.error('[VC] Error setting mic:', error);
            callback({ error: error.message });
        }
    });

    socket.on('vc-produce-audio', async ({ transportId, rtpParameters, loopback }, callback) => {
        try {
            const peer = vcPeers.get(socket.id);
            if (!peer) {
                throw new Error('Peer not found');
            }

            if (!peer.sendTransport) {
                throw new Error('Send transport not found');
            }

            const producer = await peer.sendTransport.produce({
                kind: 'audio',
                rtpParameters,
            });

            peer.producers.set(producer.id, producer);

            producer.on('transportclose', () => {
                peer.producers.delete(producer.id);
            });

            console.log(
                `[VC] Audio producer created for ${socket.id}: ${producer.id}${loopback ? ' (loopback)' : ''}`,
            );

            if (loopback) {
                io.to(socket.id).emit('vc-new-producer', {
                    producerId: producer.id,
                    peerId: socket.id,
                });
                console.log('[VC] → Sent vc-new-producer (loopback) to self');
            } else {
                const notifiedPeers = [];
                for (const [peerId, peerData] of vcPeers) {
                    if (
                        peerId !== socket.id &&
                        peerData.roomId === peer.roomId &&
                        peerData.recvTransport
                    ) {
                        io.to(peerId).emit('vc-new-producer', {
                            producerId: producer.id,
                            peerId: socket.id,
                        });
                        notifiedPeers.push(peerId);
                        console.log(`[VC] → Sent vc-new-producer to ${peerId}`);
                    }
                }
                console.log(`[VC] Notified ${notifiedPeers.length} peers about new producer`);
            }

            callback({ producerId: producer.id });
        } catch (error) {
            console.error('[VC] Error producing audio:', error);
            callback({ error: error.message });
        }
    });

    socket.on('vc-set-speaker', async ({ enabled }, callback) => {
        try {
            const peer = vcPeers.get(socket.id);
            if (!peer) {
                throw new Error('Peer not found');
            }

            if (!enabled) {
                if (peer.recvTransport) {
                    for (const [consumerId, consumer] of peer.consumers) {
                        consumer.close();
                        peer.consumers.delete(consumerId);
                    }

                    peer.recvTransport.close();
                    peer.recvTransport = null;
                }

                console.log(`[VC] Speaker OFF for ${socket.id}, recvTransport closed`);
                callback({ success: true });
            } else {
                console.log(`[VC] Speaker ON for ${socket.id}, notifying about existing producers...`);

                const existingProducers = [];
                for (const [peerId, peerData] of vcPeers) {
                    if (
                        peerId !== socket.id &&
                        peerData.roomId === peer.roomId &&
                        peerData.producers.size > 0
                    ) {
                        for (const [producerId] of peerData.producers) {
                            existingProducers.push({ producerId, peerId });
                        }
                    }
                }

                console.log(`[VC] Found ${existingProducers.length} existing producers for ${socket.id}`);

                callback({
                    success: true,
                    existingProducers,
                });
            }
        } catch (error) {
            console.error('[VC] Error setting speaker:', error);
            callback({ error: error.message });
        }
    });

    socket.on('vc-consume', async ({ producerId, rtpCapabilities }, callback) => {
        try {
            console.log(`[VC] ${socket.id} requested to consume producer: ${producerId}`);

            const peer = vcPeers.get(socket.id);
            if (!peer || !peer.recvTransport) {
                console.error(`[VC] Peer or recv transport not found for ${socket.id}`);
                throw new Error('Peer or recv transport not found');
            }

            const router = await getOrCreateVCRouter(peer.roomId);

            if (!router.canConsume({ producerId, rtpCapabilities })) {
                console.error(`[VC] Cannot consume producer ${producerId} for ${socket.id}`);
                throw new Error('Cannot consume');
            }

            console.log(`[VC] Creating consumer for ${socket.id}...`);
            const consumer = await peer.recvTransport.consume({
                producerId,
                rtpCapabilities,
                paused: true,
            });

            peer.consumers.set(consumer.id, consumer);

            consumer.on('transportclose', () => {
                console.log(`[VC] Consumer ${consumer.id} transport closed`);
                peer.consumers.delete(consumer.id);
            });

            consumer.on('producerclose', () => {
                console.log(`[VC] Consumer ${consumer.id} producer closed`);
                peer.consumers.delete(consumer.id);
                socket.emit('vc-consumer-closed', { consumerId: consumer.id });
            });

            console.log(
                `[VC] ✅ Consumer created for ${socket.id}: ${consumer.id} (kind: ${consumer.kind})`,
            );

            callback({
                consumerId: consumer.id,
                producerId,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
            });
        } catch (error) {
            console.error('[VC] ❌ Error consuming:', error);
            callback({ error: error.message });
        }
    });

    socket.on('vc-consumer-resume', async ({ consumerId }, callback) => {
        try {
            console.log(`[VC] ${socket.id} requested to resume consumer: ${consumerId}`);

            const peer = vcPeers.get(socket.id);
            if (!peer) {
                console.error(`[VC] Peer not found for ${socket.id}`);
                throw new Error('Peer not found');
            }

            const consumer = peer.consumers.get(consumerId);
            if (!consumer) {
                console.error(`[VC] Consumer ${consumerId} not found for ${socket.id}`);
                throw new Error('Consumer not found');
            }

            await consumer.resume();
            console.log(`[VC] ✅ Consumer resumed: ${consumerId} for ${socket.id}`);

            callback({ success: true });
        } catch (error) {
            console.error('[VC] ❌ Error resuming consumer:', error);
            callback({ error: error.message });
        }
    });

    socket.on('vc-leave', async (_data, callback) => {
        try {
            await cleanupVCPeer(socket.id, io);
            if (callback) callback({ success: true });
        } catch (error) {
            console.error('[VC] Error leaving:', error);
            if (callback) callback({ error: error.message });
        }
    });
}

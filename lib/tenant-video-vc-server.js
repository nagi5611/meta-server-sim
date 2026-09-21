// lib/tenant-video-vc-server.js — テナント向けビデオ VC Socket.io ハンドラ

import {
    buildVcRoomId,
    getIceServers,
    getOrCreateVideoVCRouter,
    parseWorldIdFromVcRoom,
    VIDEO_VC_MAX_PRODUCERS_PER_ROOM,
    videoVcMediasoupConfig,
} from './tenant-mediasoup-core.js';

/**
 * @typedef {object} TenantVideoVcPeer
 * @property {string} roomId VC ルーム ID（tenantId:worldId）
 * @property {import('mediasoup').types.WebRtcTransport | null} sendTransport
 * @property {import('mediasoup').types.WebRtcTransport | null} recvTransport
 * @property {Map<string, import('mediasoup').types.Producer>} producers
 * @property {Map<string, import('mediasoup').types.Consumer>} consumers
 */

/**
 * @param {string} tenantId
 * @returns {{
 *   videoVcPeers: Map<string, TenantVideoVcPeer>,
 *   cleanupVideoVCPeer: (socketId: string, io: import('socket.io').Server) => Promise<void>,
 *   emitVideoVcRoomChanged: (socket: import('socket.io').Socket, worldId: string) => void,
 * }}
 */
export function createTenantVideoVcState(tenantId) {
    /** @type {Map<string, TenantVideoVcPeer>} */
    const videoVcPeers = new Map();

    /**
     * @param {string} socketId
     * @param {import('socket.io').Server} io
     */
    async function cleanupVideoVCPeer(socketId, io) {
        const peer = videoVcPeers.get(socketId);
        if (!peer) return;

        console.log(`[Video VC] Cleaning up peer: ${socketId}`);

        const worldRoomId = parseWorldIdFromVcRoom(peer.roomId, tenantId);
        const producerIds = Array.from(peer.producers.keys());
        if (worldRoomId && producerIds.length > 0) {
            for (const producerId of producerIds) {
                io.to(worldRoomId).emit('video-vc-producer-closed', { producerId });
            }
        }

        for (const [producerId, producer] of peer.producers) {
            try {
                producer.close();
            } catch (e) {
                console.error(`[Video VC] Error closing producer ${producerId}:`, e);
            }
        }
        for (const [consumerId, consumer] of peer.consumers) {
            try {
                consumer.close();
            } catch (e) {
                console.error(`[Video VC] Error closing consumer ${consumerId}:`, e);
            }
        }
        if (peer.sendTransport) {
            try {
                peer.sendTransport.close();
            } catch (e) {
                console.error('[Video VC] Error closing send transport:', e);
            }
        }
        if (peer.recvTransport) {
            try {
                peer.recvTransport.close();
            } catch (e) {
                console.error('[Video VC] Error closing recv transport:', e);
            }
        }

        videoVcPeers.delete(socketId);
    }

    /**
     * @param {import('socket.io').Socket} socket
     * @param {string} worldId
     */
    function emitVideoVcRoomChanged(socket, worldId) {
        socket.emit('video-vc-room-changed', { roomId: worldId });
    }

    return { videoVcPeers, cleanupVideoVCPeer, emitVideoVcRoomChanged };
}

/**
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server} io
 * @param {{ id: string }} tenant
 * @param {ReturnType<typeof createTenantVideoVcState>} state
 * @param {{
 *   getWorldRoomId: (socket: import('socket.io').Socket) => string | null | undefined,
 *   isValidWorld: (worldId: string) => boolean,
 * }} deps
 */
export function registerTenantVideoVcSocketHandlers(socket, io, tenant, state, deps) {
    const { videoVcPeers, cleanupVideoVCPeer } = state;
    const tenantId = tenant.id;

    socket.on('video-vc-join', async ({ roomId: worldIdArg }, callback) => {
        try {
            const worldId = worldIdArg || deps.getWorldRoomId(socket);
            if (!worldId || typeof worldId !== 'string' || !deps.isValidWorld(worldId)) {
                return callback({ error: 'invalid_room' });
            }
            const vcRoomId = buildVcRoomId(tenantId, worldId);
            const router = await getOrCreateVideoVCRouter(vcRoomId);

            if (videoVcPeers.has(socket.id)) {
                await cleanupVideoVCPeer(socket.id, io);
            }
            videoVcPeers.set(socket.id, {
                roomId: vcRoomId,
                sendTransport: null,
                recvTransport: null,
                producers: new Map(),
                consumers: new Map(),
            });

            console.log(`[Video VC] ${socket.id} joined room: ${vcRoomId} (world: ${worldId})`);
            callback({
                rtpCapabilities: router.rtpCapabilities,
                iceServers: await getIceServers(),
            });
        } catch (error) {
            console.error('[Video VC] Error joining:', error);
            callback({ error: error.message });
        }
    });

    socket.on('video-vc-create-transport', async ({ direction }, callback) => {
        try {
            const peer = videoVcPeers.get(socket.id);
            if (!peer) throw new Error('Peer not found');

            const router = await getOrCreateVideoVCRouter(peer.roomId);
            const transport = await router.createWebRtcTransport({
                ...videoVcMediasoupConfig.webRtcTransport,
                enableUdp: true,
                enableTcp: true,
                preferUdp: true,
            });

            if (direction === 'send') peer.sendTransport = transport;
            else peer.recvTransport = transport;

            transport.on('icestatechange', (iceState) => {
                console.log(
                    `[Video VC] ${direction} transport ${transport.id} ICE state: ${iceState} (peer: ${socket.id})`,
                );
            });
            transport.on('dtlsstatechange', (dtlsState) => {
                if (dtlsState === 'failed' || dtlsState === 'closed') {
                    console.error(`[Video VC] ${direction} transport DTLS failed for ${socket.id}`);
                }
            });

            callback({
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            });
        } catch (error) {
            console.error('[Video VC] Error creating transport:', error);
            callback({ error: error.message });
        }
    });

    socket.on('video-vc-connect-transport', async ({ transportId, dtlsParameters }, callback) => {
        try {
            const peer = videoVcPeers.get(socket.id);
            if (!peer) throw new Error('Peer not found');
            const transport =
                peer.sendTransport?.id === transportId ? peer.sendTransport : peer.recvTransport;
            if (!transport) throw new Error('Transport not found');
            await transport.connect({ dtlsParameters });
            console.log(`[Video VC] Transport ${transportId} connected for ${socket.id}`);
            callback({ success: true });
        } catch (error) {
            console.error('[Video VC] Error connecting transport:', error);
            callback({ error: error.message });
        }
    });

    socket.on('video-vc-set-video', async ({ enabled }, callback) => {
        try {
            const peer = videoVcPeers.get(socket.id);
            if (!peer) throw new Error('Peer not found');

            const worldRoomId = parseWorldIdFromVcRoom(peer.roomId, tenantId);

            if (enabled) {
                const activeProducers = Array.from(videoVcPeers.values()).filter(
                    (p) => p.roomId === peer.roomId && p.producers.size > 0,
                ).length;
                if (activeProducers >= VIDEO_VC_MAX_PRODUCERS_PER_ROOM) {
                    callback({
                        denied: true,
                        reason: `同時ビデオONは最大${VIDEO_VC_MAX_PRODUCERS_PER_ROOM}人までです`,
                    });
                    return;
                }
                callback({ allowed: true });
            } else {
                if (peer.sendTransport) {
                    for (const [producerId, producer] of peer.producers) {
                        producer.close();
                        peer.producers.delete(producerId);
                        if (worldRoomId) {
                            io.to(worldRoomId).emit('video-vc-producer-closed', { producerId });
                        }
                    }
                    peer.sendTransport.close();
                    peer.sendTransport = null;
                }
                callback({ success: true });
            }
        } catch (error) {
            console.error('[Video VC] Error setting video:', error);
            callback({ error: error.message });
        }
    });

    socket.on('video-vc-produce-video', async ({ transportId, rtpParameters }, callback) => {
        try {
            const peer = videoVcPeers.get(socket.id);
            if (!peer) throw new Error('Peer not found');
            if (!peer.sendTransport) throw new Error('Send transport not found');

            const producer = await peer.sendTransport.produce({ kind: 'video', rtpParameters });
            peer.producers.set(producer.id, producer);
            producer.on('transportclose', () => peer.producers.delete(producer.id));

            for (const [peerId, peerData] of videoVcPeers) {
                if (
                    peerId !== socket.id &&
                    peerData.roomId === peer.roomId &&
                    peerData.recvTransport
                ) {
                    io.to(peerId).emit('video-vc-new-producer', {
                        producerId: producer.id,
                        peerId: socket.id,
                        kind: 'video',
                    });
                }
            }
            callback({ producerId: producer.id });
        } catch (error) {
            console.error('[Video VC] Error producing video:', error);
            callback({ error: error.message });
        }
    });

    socket.on('video-vc-produce-audio', async ({ transportId, rtpParameters }, callback) => {
        try {
            const peer = videoVcPeers.get(socket.id);
            if (!peer) throw new Error('Peer not found');
            if (!peer.sendTransport) throw new Error('Send transport not found');

            const producer = await peer.sendTransport.produce({ kind: 'audio', rtpParameters });
            peer.producers.set(producer.id, producer);
            producer.on('transportclose', () => peer.producers.delete(producer.id));

            for (const [peerId, peerData] of videoVcPeers) {
                if (
                    peerId !== socket.id &&
                    peerData.roomId === peer.roomId &&
                    peerData.recvTransport
                ) {
                    io.to(peerId).emit('video-vc-new-producer', {
                        producerId: producer.id,
                        peerId: socket.id,
                        kind: 'audio',
                    });
                }
            }
            callback({ producerId: producer.id });
        } catch (error) {
            console.error('[Video VC] Error producing audio:', error);
            callback({ error: error.message });
        }
    });

    socket.on('video-vc-set-recv', async ({ enabled }, callback) => {
        try {
            const peer = videoVcPeers.get(socket.id);
            if (!peer) throw new Error('Peer not found');

            if (!enabled) {
                if (peer.recvTransport) {
                    for (const [consumerId, consumer] of peer.consumers) {
                        consumer.close();
                        peer.consumers.delete(consumerId);
                    }
                    peer.recvTransport.close();
                    peer.recvTransport = null;
                }
                callback({ success: true });
            } else {
                const existingProducers = [];
                for (const [peerId, peerData] of videoVcPeers) {
                    if (
                        peerId !== socket.id &&
                        peerData.roomId === peer.roomId &&
                        peerData.producers.size > 0
                    ) {
                        for (const [producerId, producer] of peerData.producers) {
                            existingProducers.push({ producerId, peerId, kind: producer.kind });
                        }
                    }
                }
                callback({ success: true, existingProducers });
            }
        } catch (error) {
            console.error('[Video VC] Error setting recv:', error);
            callback({ error: error.message });
        }
    });

    socket.on('video-vc-consume', async ({ producerId, rtpCapabilities }, callback) => {
        try {
            const peer = videoVcPeers.get(socket.id);
            if (!peer || !peer.recvTransport) throw new Error('Peer or recv transport not found');

            const router = await getOrCreateVideoVCRouter(peer.roomId);
            if (!router.canConsume({ producerId, rtpCapabilities })) throw new Error('Cannot consume');

            const consumer = await peer.recvTransport.consume({
                producerId,
                rtpCapabilities,
                paused: true,
            });
            peer.consumers.set(consumer.id, consumer);
            consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
            consumer.on('producerclose', () => {
                peer.consumers.delete(consumer.id);
                socket.emit('video-vc-consumer-closed', { consumerId: consumer.id });
            });

            callback({
                consumerId: consumer.id,
                producerId,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
            });
        } catch (error) {
            console.error('[Video VC] Error consuming:', error);
            callback({ error: error.message });
        }
    });

    socket.on('video-vc-consumer-resume', async ({ consumerId }, callback) => {
        try {
            const peer = videoVcPeers.get(socket.id);
            if (!peer) throw new Error('Peer not found');
            const consumer = peer.consumers.get(consumerId);
            if (!consumer) throw new Error('Consumer not found');
            await consumer.resume();
            callback({ success: true });
        } catch (error) {
            console.error('[Video VC] Error resuming consumer:', error);
            callback({ error: error.message });
        }
    });

    socket.on('video-vc-leave', async (_data, callback) => {
        try {
            await cleanupVideoVCPeer(socket.id, io);
            if (callback) callback({ success: true });
        } catch (error) {
            console.error('[Video VC] Error leaving:', error);
            if (callback) callback({ error: error.message });
        }
    });
}

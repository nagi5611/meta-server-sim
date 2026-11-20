// addons/matsuyama-flights/client/three-shared.js — メタバース本体と同一の Three.js を使う
/**
 * @returns {typeof import('three')}
 */
export function getSharedThree() {
    const THREE = globalThis.__metaverseSharedThree;
    if (!THREE) {
        throw new Error('[matsuyama-flights] __metaverseSharedThree is not set (tenant-metaverse-app)');
    }
    return THREE;
}
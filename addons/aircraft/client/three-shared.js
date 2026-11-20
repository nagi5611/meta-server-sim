// addons/aircraft/client/three-shared.js — メタバース本体と同一の Three.js

/**
 * @returns {typeof import('three')}
 */
export function getSharedThree() {
    const THREE = globalThis.__metaverseSharedThree;
    if (!THREE) {
        throw new Error('[aircraft] __metaverseSharedThree is not set (load tenant-metaverse-app first)');
    }
    return THREE;
}
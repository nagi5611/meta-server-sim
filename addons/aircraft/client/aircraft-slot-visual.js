// addons/aircraft/client/aircraft-slot-visual.js — ライブラリ GLB なしでも視認できる簡易機体メッシュ
import { getSharedThree } from './three-shared.js';

const VISUAL_NAME = 'sim-aircraft-visual';

/**
 * ロッド1 等のプレースホルダを隠し、-Z 前進の簡易機体を付与する
 * @param {import('three').Object3D} root
 */
export function attachProceduralAircraftVisual(root) {
    if (!root) return;
    const THREE = getSharedThree();
    if (root.getObjectByName(VISUAL_NAME)) return;

    root.traverse((obj) => {
        if (obj.isMesh && obj.name !== VISUAL_NAME) {
            obj.visible = false;
        }
    });

    const body = new THREE.Group();
    body.name = VISUAL_NAME;
    body.userData.simAircraftVisual = true;

    const matFuselage = new THREE.MeshStandardMaterial({
        color: 0x4a90e2,
        metalness: 0.35,
        roughness: 0.45,
    });
    const matWing = new THREE.MeshStandardMaterial({
        color: 0xe8f4ff,
        metalness: 0.2,
        roughness: 0.55,
    });
    const matTail = new THREE.MeshStandardMaterial({ color: 0x2c5f9c, metalness: 0.3, roughness: 0.5 });

    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 6.2, 16), matFuselage);
    fuselage.rotation.x = Math.PI / 2;
    fuselage.position.set(0, 0.9, 0);
    body.add(fuselage);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(10, 0.12, 1.4), matWing);
    wing.position.set(0, 0.85, 0.2);
    body.add(wing);

    const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 1.2), matTail);
    tailFin.position.set(0, 1.35, 2.9);
    body.add(tailFin);

    const hStab = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.08, 0.7), matTail);
    hStab.position.set(0, 1.0, 2.85);
    body.add(hStab);

    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.45, 1.2, 12), matFuselage);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.9, -3.5);
    body.add(nose);

    root.add(body);
}

/**
 * @param {import('../../../metaverse-simple/public/js/scene-manager.js').default|{ getAircraftSlots: () => unknown[] }} sceneManager
 */
export function ensureAircraftSlotVisuals(sceneManager) {
    const slots = sceneManager?.getAircraftSlots?.() || [];
    for (const slot of slots) {
        if (slot?.root) {
            attachProceduralAircraftVisual(slot.root);
        }
    }
}
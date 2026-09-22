// public/js/tenant-world-edit-fds-snapshot.js — ワールド編集 editGroup から FDS 設定を抽出
import { ensureFdsSmokeButtonPanel } from './fds/fds-smoke-control-panel.js';

/**
 * editGroup から FDS 煙・再生ボタン設定をスナップショットする（ギズモ位置を反映）
 * @param {{ children?: Array<{ position: { x: number, y: number, z: number }, rotation?: { x: number, y: number, z: number }, scale?: { x: number }, userData?: object }> } | null | undefined} editGroup
 * @returns {{ fdsSmokes: object[], fdsSmokeButtons: object[] }}
 */
export function collectFdsWorldSnapshotFromEditGroup(editGroup) {
    const fdsSmokes = [];
    const fdsSmokeButtons = [];
    if (!editGroup?.children) {
        return { fdsSmokes, fdsSmokeButtons };
    }

    for (const child of editGroup.children) {
        if (child.userData?.fdsSmokeConfig) {
            const s = JSON.parse(JSON.stringify(child.userData.fdsSmokeConfig));
            s.position = { x: child.position.x, y: child.position.y, z: child.position.z };
            s.rotation = {
                x: (child.rotation.x * 180) / Math.PI,
                y: (child.rotation.y * 180) / Math.PI,
                z: (child.rotation.z * 180) / Math.PI,
            };
            s.scale = child.scale.x;
            fdsSmokes.push(s);
        }
        if (child.userData?.fdsSmokeButtonConfig) {
            const b = ensureFdsSmokeButtonPanel(
                JSON.parse(JSON.stringify(child.userData.fdsSmokeButtonConfig)),
            );
            b.position = { x: child.position.x, y: child.position.y, z: child.position.z };
            fdsSmokeButtons.push(b);
        }
    }

    return { fdsSmokes, fdsSmokeButtons };
}

// public/js/tenant-world-edit-vdb-snapshot.js — editGroup から vdbs[] を抽出（sim 専用 shim）

/**
 * @param {THREE.Group} editGroup
 * @returns {{ vdbs: object[] }}
 */
export function collectVdbSnapshotFromEditGroup(editGroup) {
    const vdbs = [];
    if (!editGroup) return { vdbs };
    for (const child of editGroup.children) {
        const cfg = child.userData?.vdbVolumeConfig;
        if (!cfg) continue;
        const entry = JSON.parse(JSON.stringify(cfg));
        entry.position = { x: child.position.x, y: child.position.y, z: child.position.z };
        entry.rotation = {
            x: (child.rotation.x * 180) / Math.PI,
            y: (child.rotation.y * 180) / Math.PI,
            z: (child.rotation.z * 180) / Math.PI,
        };
        const ws = typeof entry.worldScale === 'number' ? entry.worldScale : child.scale.x;
        entry.worldScale = ws;
        vdbs.push(entry);
    }
    return { vdbs };
}
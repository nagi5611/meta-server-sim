// addons/aircraft/server/seed-presets.js — B787 / A320 初期タグ
import { mergeAircraftPhysicsFromWorld } from '../client/aircraft-physics-defaults.js';
import { mergeEasyAircraftPhysicsFromWorld } from '../client/aircraft-physics-easy-defaults.js';

/**
 * @param {import('better-sqlite3').Database} db
 */
export function seedDefaultAirframes(db) {
    const row = db.prepare('SELECT COUNT(*) AS c FROM aircraft_airframe').get();
    if (row && Number(row.c) > 0) return;

    const b787Hard = mergeAircraftPhysicsFromWorld({
        maxThrustSpeed: (250 + 80) * (1000 / 3600),
        stallSpeed: 58 * 0.514444,
        rotationSpeed: 72 * 0.514444,
        tireStaticFriction: 0.82,
    });
    const b787Easy = mergeEasyAircraftPhysicsFromWorld({
        maxThrustSpeed: (220 + 60) * (1000 / 3600),
        stallSpeed: 50 * 0.514444,
    });
    const a320Hard = mergeAircraftPhysicsFromWorld({
        maxThrustSpeed: (230 + 70) * (1000 / 3600),
        stallSpeed: 52 * 0.514444,
        rotationSpeed: 68 * 0.514444,
        rollMaxDeg: 56,
    });
    const a320Easy = mergeEasyAircraftPhysicsFromWorld({
        maxThrustSpeed: (200 + 55) * (1000 / 3600),
        stallSpeed: 48 * 0.514444,
    });

    const cameraDefault = JSON.stringify({
        cockpitOffset: { x: 0, y: 1.4, z: 0.3 },
        chaseOffset: { x: 0, y: 4, z: 14 },
    });

    const stmt = db.prepare(
        `INSERT INTO aircraft_airframe (
            id, display_name, prefab_manifest, bindings_json, animation_json,
            physics_json, camera_json, control_mode, physics_easy_json, camera_easy_json
        ) VALUES (?, ?, '', '{}', '{}', ?, ?, ?, ?, ?)`
    );

    stmt.run(
        'B787',
        'Boeing 787',
        JSON.stringify(b787Hard),
        cameraDefault,
        'hard',
        JSON.stringify(b787Easy),
        cameraDefault
    );
    stmt.run(
        'A320',
        'Airbus A320',
        JSON.stringify(a320Hard),
        cameraDefault,
        'easy',
        JSON.stringify(a320Easy),
        cameraDefault
    );
}
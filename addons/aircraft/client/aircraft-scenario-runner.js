// addons/aircraft/client/aircraft-scenario-runner.js — ブラウザ内シナリオ再生・サンプリング
import { validateAircraftScenario } from '../lib/aircraft-scenario-schema.js';
import { buildAircraftScenarioReport } from '../lib/aircraft-scenario-report.js';

/**
 * @param {import('../lib/aircraft-scenario-types.js').AircraftScenarioControls} controls
 */
/**
 * @param {import('../lib/aircraft-scenario-types.js').AircraftScenarioControls} controls
 * @param {'easy'|'hard'} controlMode
 */
export function controlsToKeyState(controls, controlMode = 'easy') {
    const thr = Number(controls.thrust) || 0;
    const yaw = Number(controls.yaw) || 0;
    const pitch = Number(controls.pitch) || 0;
    const roll = Number(controls.roll) || 0;
    if (controlMode === 'hard') {
        return {
            throttleUp: thr > 0.05,
            throttleDown: thr < -0.05,
            yawR: yaw > 0.05,
            yawL: yaw < -0.05,
            pitchUp: pitch > 0.05,
            pitchDn: pitch < -0.05,
            rollL: roll > 0.05,
            rollR: roll < -0.05,
            brake: false,
        };
    }
    return {
        forward: thr > 0.05,
        back: thr < -0.05,
        yawR: yaw > 0.05,
        yawL: yaw < -0.05,
        pitchUp: pitch > 0.05,
        pitchDn: pitch < -0.05,
        rollL: roll > 0.05,
        rollR: roll < -0.05,
        brake: false,
    };
}

/**
 * @param {import('three').Object3D} root
 * @returns {{ position: {x:number,y:number,z:number}, quaternion: {x:number,y:number,z:number,w:number}, headingDeg: number, speedHorizontal: number, verticalSpeed: number }}
 */
function readRootKinematics(root) {
    const THREE = globalThis.__metaverseSharedThree;
    if (!THREE || !root) {
        return {
            position: { x: 0, y: 0, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            headingDeg: 0,
            speedHorizontal: 0,
            verticalSpeed: 0,
        };
    }
    root.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    root.getWorldPosition(p);
    root.getWorldQuaternion(q);
    e.setFromQuaternion(q);
    const headingDeg = (e.y * 180) / Math.PI;
    return {
        position: { x: p.x, y: p.y, z: p.z },
        quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
        headingDeg,
        speedHorizontal: 0,
        verticalSpeed: 0,
    };
}

export default class AircraftScenarioRunner {
    /**
     * @param {import('../../public/js/tenant-metaverse-app.js').TenantMetaverseApp | { aircraftManager?: any, aircraftController?: any, tenantId?: string, worldManager?: any }} app
     */
    constructor(app) {
        this.app = app;
        /** @type {boolean} */
        this._running = false;
    }

    /**
     * @returns {boolean}
     */
    isRunning() {
        return this._running;
    }

    /**
     * @param {unknown} rawScenario
     * @returns {Promise<import('../lib/aircraft-scenario-types.js').AircraftScenarioReport>}
     */
    async run(rawScenario) {
        if (this._running) {
            return buildAircraftScenarioReport(
                { id: 'busy', version: 1, name: 'busy', controlMode: 'easy', sampleIntervalMs: 100, steps: [], checkpoints: [] },
                [],
                { errors: ['scenario runner already active'] }
            );
        }

        const validated = validateAircraftScenario(rawScenario);
        if (!validated.ok) {
            return buildAircraftScenarioReport(
                { id: 'invalid', version: 1, name: 'invalid', controlMode: 'easy', sampleIntervalMs: 100, steps: [], checkpoints: [] },
                [],
                { errors: validated.errors }
            );
        }
        const scenario = validated.scenario;
        const mgr = this.app.aircraftManager;
        const ctrl = this.app.aircraftController;
        if (!mgr || !ctrl) {
            return buildAircraftScenarioReport(scenario, [], { errors: ['aircraft subsystem not loaded'] });
        }

        this._running = true;
        const startedAtIso = new Date().toISOString();
        /** @type {string[]} */
        const errors = [];

        try {
            const waitSlotMs = 90_000;
            let slot = scenario.slotId
                ? await this._waitForSlotId(mgr, scenario.slotId, waitSlotMs)
                : null;
            mgr.refreshSlotsFromScene();
            if (!slot) {
                const lib = scenario.aircraftLibraryId;
                if (lib) {
                    for (const s of mgr.slotsById.values()) {
                        if (String(s.aircraftLibraryId || '').toUpperCase() === lib.toUpperCase()) {
                            slot = s;
                            break;
                        }
                    }
                }
            }
            if (!slot) {
                for (const s of mgr.slotsById.values()) {
                    if ((s.controlMode || 'hard') === scenario.controlMode) {
                        slot = s;
                        break;
                    }
                }
            }
            if (!slot) {
                slot = mgr.slotsById.values().next().value || null;
            }
            if (!slot) {
                return buildAircraftScenarioReport(scenario, [], {
                    startedAtIso,
                    errors: ['no aircraft slot in world'],
                });
            }

            const boarded = await this._ensurePiloting(mgr, slot, 5);
            if (!boarded) {
                return buildAircraftScenarioReport(scenario, [], {
                    startedAtIso,
                    errors: [`board failed for slot ${slot.id} after retries`],
                });
            }

            const mode = scenario.controlMode || slot.controlMode || 'easy';
            if (mode === 'hard' && mgr.activeSlot) {
                mgr.resetSlotToParked(slot.id);
                ctrl.bindSlot({ ...mgr.activeSlot, controlMode: mode });
                const impl = ctrl._active;
                if (impl?.velocity) impl.velocity.set(0, 0, 0);
                if (impl && 'engineRpm' in impl) {
                    impl._engineRpm = 0;
                    impl._throttle = 0;
                }
                for (let i = 0; i < 3; i++) await this._waitFrame();
            } else if (mgr.activeSlot) {
                ctrl.bindSlot({ ...mgr.activeSlot, controlMode: mode });
            }

            if (!ctrl.setScenarioControls) {
                return buildAircraftScenarioReport(scenario, [], {
                    startedAtIso,
                    errors: ['aircraftController lacks scenario API'],
                });
            }

            /** @type {import('../lib/aircraft-scenario-types.js').AircraftScenarioPoseSample[]} */
            const samples = [];
            const totalSec = scenario.steps.reduce((acc, s) => acc + s.durationSec, 0);
            const sampleEvery = scenario.sampleIntervalMs / 1000;
            let elapsed = 0;
            let nextSampleT = 0;

            const pushSample = () => {
                const root = mgr.activeSlot?.root;
                if (!root) return;
                const kin = readRootKinematics(root);
                const impl = ctrl._active;
                if (impl?.velocity) {
                    const v = impl.velocity;
                    kin.speedHorizontal = Math.hypot(v.x, v.z);
                    kin.verticalSpeed = v.y;
                }
                samples.push({
                    tSec: elapsed,
                    position: kin.position,
                    quaternion: kin.quaternion,
                    headingDeg: kin.headingDeg,
                    speedHorizontal: kin.speedHorizontal,
                    verticalSpeed: kin.verticalSpeed,
                });
            };

            const t0 = performance.now();
            for (const step of scenario.steps) {
                const keys = controlsToKeyState(step.controls, mode);
                ctrl.setScenarioControls(keys);
                const stepEndMs = t0 + (elapsed + step.durationSec) * 1000;

                while (performance.now() < stepEndMs) {
                    await this._waitFrame();
                    ctrl.setScenarioControls(keys);
                    elapsed = (performance.now() - t0) / 1000;
                    if (elapsed + 1e-6 >= nextSampleT) {
                        pushSample();
                        nextSampleT += sampleEvery;
                    }
                }
                elapsed = (performance.now() - t0) / 1000;
            }

            ctrl.clearScenarioControls();
            pushSample();

            if (elapsed < totalSec - 0.01) {
                errors.push(`time undershot: ${elapsed.toFixed(3)} < ${totalSec}`);
            }

            const worldId = this.app.worldManager?.getCurrentWorldId?.() ?? null;
            return buildAircraftScenarioReport(scenario, samples, {
                startedAtIso,
                finishedAtIso: new Date().toISOString(),
                tenantId: this.app.tenantId,
                worldId: worldId || undefined,
                slotId: mgr.activeSlot?.id,
                errors,
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            errors.push(msg);
            return buildAircraftScenarioReport(validated.scenario, [], {
                startedAtIso,
                finishedAtIso: new Date().toISOString(),
                errors,
            });
        } finally {
            try {
                ctrl.clearScenarioControls?.();
            } catch {
                /* ignore */
            }
            this._running = false;
        }
    }

    /**
     * @param {import('./aircraft-manager.js').default} mgr
     * @param {{ id: string }} slot
     * @param {number} maxAttempts
     */
    async _ensurePiloting(mgr, slot, maxAttempts = 5) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (mgr.isPiloting && mgr.activeSlot?.id === slot.id) return true;
            const feet = this.app.characterController?.getPosition?.();
            if (feet) mgr.updateProximity(feet);
            await mgr.tryBoardSlot(slot.id);
            for (let i = 0; i < 8; i++) {
                await this._waitFrame();
                if (mgr.isPiloting && mgr.activeSlot?.id === slot.id) return true;
            }
            await new Promise((r) => setTimeout(r, 400 + attempt * 200));
        }
        return mgr.isPiloting && mgr.activeSlot?.id === slot.id;
    }

    /**
     * @returns {Promise<void>}
     */
    _waitFrame() {
        return new Promise((resolve) => {
            requestAnimationFrame(() => resolve());
        });
    }

    /**
     * @param {import('./aircraft-manager.js').default} mgr
     * @param {string} slotId
     * @param {number} timeoutMs
     */
    async _waitForSlotId(mgr, slotId, timeoutMs) {
        const sid = String(slotId || '').trim();
        const t0 = performance.now();
        while (performance.now() - t0 < timeoutMs) {
            mgr.refreshSlotsFromScene();
            const hit = mgr.slotsById.get(sid);
            if (hit?.root) return hit;
            await this._waitFrame();
        }
        return null;
    }
}
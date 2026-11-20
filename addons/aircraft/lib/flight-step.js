// addons/aircraft/lib/flight-step.js — 簡易飛行ステップ（単体テスト・挙動検証用）
/**
 * @param {{ y: number, speed: number, throttle: number, onGround: boolean, pitch: number }} state
 * @param {Record<string, number>} physics
 * @param {{ throttleInput: number, pitchInput: number, dt: number }} input
 */
export function simulateFlightStep(state, physics, input) {
    const dt = Math.min(0.1, Math.max(0, input.dt || 0.016));
    const throttle = Math.max(0, Math.min(1, input.throttleInput));
    const pitch = input.pitchInput || 0;
    const stall = Number(physics.stallSpeed) || 45;
    const maxV = Number(physics.maxThrustSpeed) || 100;
    const rot = Number(physics.rotationSpeed) || 55;
    let speed = state.speed;
    let y = state.y;
    let onGround = state.onGround;

    const targetAccel = throttle * (maxV - speed) * 0.15;
    speed += targetAccel * dt;
    if (!onGround && speed < stall && pitch > 0.15) {
        speed *= 1 - dt * 0.8;
        y -= dt * 4;
    }

    if (onGround) {
        if (speed >= rot && y <= 2.05) {
            onGround = false;
            y += dt * 8 * Math.max(0, pitch);
        } else {
            y = Math.max(0, y);
        }
    } else {
        y += dt * speed * 0.12 * pitch;
        y -= dt * (Number(physics.gravity) || 9.81) * 0.02 * (1 - throttle * 0.5);
        if (y <= 0) {
            y = 0;
            onGround = true;
            speed = Math.min(speed, rot);
        }
    }

    return { y, speed, throttle, onGround, pitch };
}
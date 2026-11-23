// addons/aircraft/lib/aircraft-scenario-types.js — 飛行シナリオ型（JSDoc のみ）

/**
 * @typedef {Object} AircraftScenarioControls
 * @property {number} thrust -1..1（正=加速 W、負=減速 S）
 * @property {number} yaw -1..1（正=右ヨー D、負=左ヨー A）
 * @property {number} pitch -1..1（正=機首上 ArrowDown、負=機首下 ArrowUp）
 * @property {number} roll -1..1（正=右バンク ArrowRight、負=左バンク ArrowLeft）
 */

/**
 * @typedef {Object} AircraftScenarioStep
 * @property {number} durationSec
 * @property {AircraftScenarioControls} controls
 */

/**
 * @typedef {Object} AircraftScenarioCheckpointExpect
 * @property {{ x: number, y: number, z: number }} [position]
 * @property {{ x: number, y: number, z: number }} [deltaPosition] 開始姿勢からの並進 (m)
 * @property {number} [headingDeg] 水平机首方位（度、Y 回転）
 * @property {number} [altitude] ワールド Y
 * @property {number} [minAltitudeGain] 開始高度からの最小上昇 (m)
 * @property {number} [minHeadingChangeDeg] 開始方位からの最小変化（度、絶対）
 */

/**
 * @typedef {Object} AircraftScenarioCheckpointTolerance
 * @property {number} [positionM] 期待位置との最大距離 (m)
 * @property {number} [headingDeg] 方位誤差（度、最短角差）
 * @property {number} [altitudeM] 高度誤差 (m)
 */

/**
 * @typedef {Object} AircraftScenarioCheckpoint
 * @property {number} atTimeSec シナリオ開始からの秒
 * @property {AircraftScenarioCheckpointExpect} expect
 * @property {AircraftScenarioCheckpointTolerance} tolerance
 */

/**
 * @typedef {Object} AircraftScenario
 * @property {string} id
 * @property {number} version
 * @property {string} name
 * @property {'easy'|'hard'} controlMode
 * @property {string} [slotId]
 * @property {string} [aircraftLibraryId]
 * @property {number} sampleIntervalMs
 * @property {AircraftScenarioStep[]} steps
 * @property {AircraftScenarioCheckpoint[]} checkpoints
 */

/**
 * @typedef {Object} AircraftScenarioPoseSample
 * @property {number} tSec
 * @property {{ x: number, y: number, z: number }} position
 * @property {{ x: number, y: number, z: number, w: number }} quaternion
 * @property {number} headingDeg
 * @property {number} speedHorizontal
 * @property {number} verticalSpeed
 */

/**
 * @typedef {Object} AircraftScenarioCheckpointResult
 * @property {string} label
 * @property {number} atTimeSec
 * @property {boolean} pass
 * @property {Record<string, { expected: number|object, actual: number|object, delta: number, tolerance: number, pass: boolean }>} metrics
 */

/**
 * @typedef {Object} AircraftScenarioReport
 * @property {string} scenarioId
 * @property {string} scenarioName
 * @property {boolean} pass
 * @property {number} durationSec
 * @property {string} startedAtIso
 * @property {string} finishedAtIso
 * @property {string} [tenantId]
 * @property {string} [worldId]
 * @property {string} [slotId]
 * @property {AircraftScenarioPoseSample[]} samples
 * @property {AircraftScenarioCheckpointResult[]} checkpoints
 * @property {string[]} errors
 */

export {};
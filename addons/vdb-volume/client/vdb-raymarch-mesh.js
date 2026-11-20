// addons/vdb-volume/client/vdb-raymarch-mesh.js — three-vdb-loader グリッドを雲向けレイマーチ表示
import * as THREE from 'three';

const VERTEX_SHADER = `
varying vec3 vOrigin;
varying vec3 vDirection;
void main() {
    vOrigin = vec3( inverse( modelMatrix ) * vec4( cameraPosition, 1.0 ) );
    vDirection = position - vOrigin;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

/**
 * @param {number} raySteps
 * @param {number} lightSteps
 */
function buildFragmentShader(raySteps, lightSteps) {
    return `
precision highp sampler3D;
uniform sampler3D map;
uniform vec3 tint;
uniform vec3 sunDirection;
uniform float densityScale;
uniform float extinction;
uniform float scattering;
uniform float ambient;
uniform float anisotropy;
uniform float rayStride;
uniform float lightStride;
varying vec3 vOrigin;
varying vec3 vDirection;

float henyeyGreenstein( float cosTheta, float g ) {
    float g2 = g * g;
    float denom = 1.0 + g2 - 2.0 * g * cosTheta;
    return ( 1.0 - g2 ) / ( 4.0 * 3.14159265 * pow( max( denom, 0.0001 ), 1.5 ) );
}

float rawDensity( vec3 p ) {
    if ( any( lessThan( p, vec3( 0.001 ) ) ) || any( greaterThan( p, vec3( 0.999 ) ) ) ) {
        return 0.0;
    }
    return texture( map, p ).r * densityScale;
}

float lightTransmittance( vec3 p, vec3 sunDir, float lightStepLen ) {
    float optical = 0.0;
    vec3 pos = p;
    for ( int i = 0; i < ${lightSteps}; i++ ) {
        if ( lightStride > 1.5 && mod( float( i ), lightStride ) >= 0.5 ) continue;
        pos += sunDir * lightStepLen * max( lightStride, 1.0 );
        if ( any( lessThan( pos, vec3( 0.0 ) ) ) || any( greaterThan( pos, vec3( 1.0 ) ) ) ) {
            break;
        }
        optical += rawDensity( pos ) * extinction * lightStepLen;
        if ( optical > 12.0 ) break;
    }
    return exp( -optical );
}

void main() {
    vec3 dir = normalize( vDirection );
    vec3 sunDir = normalize( sunDirection );
    vec3 t0 = ( vec3( -0.5 ) - vOrigin ) / dir;
    vec3 t1 = ( vec3( 0.5 ) - vOrigin ) / dir;
    vec3 nearP = min( t0, t1 );
    vec3 farP = max( t0, t1 );
    float start = max( max( max( nearP.x, nearP.y ), nearP.z ), 0.0 );
    float end = min( min( farP.x, farP.y ), farP.z );
    if ( end <= start ) discard;

    float stepLen = ( end - start ) / float( ${raySteps} );
    float jitter = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    start += jitter * stepLen;
    float lightStepLen = 1.732 / float( ${lightSteps} );

    float transmittance = 1.0;
    vec3 radiance = vec3( 0.0 );
    float cosTheta = dot( dir, sunDir );
    float phase = henyeyGreenstein( cosTheta, anisotropy );

    for ( int i = 0; i < ${raySteps}; i++ ) {
        if ( rayStride > 1.5 && mod( float( i ), rayStride ) >= 0.5 ) continue;
        float t = start + float( i ) * stepLen;
        vec3 p = vOrigin + dir * t + 0.5;
        float density = rawDensity( p );
        if ( density < 0.001 ) continue;

        float lightT = lightTransmittance( p, sunDir, lightStepLen );
        vec3 direct = tint * scattering * density * stepLen * lightT * phase;
        vec3 amb = tint * ambient * density * stepLen;
        radiance += transmittance * ( direct + amb );
        transmittance *= exp( -density * extinction * stepLen );
        if ( transmittance < 0.015 ) break;
    }

    float alpha = 1.0 - transmittance;
    if ( alpha < 0.008 ) discard;
    radiance *= 1.15;
    gl_FragColor = vec4( radiance, clamp( alpha, 0.0, 0.98 ) );
}`;
}

/**
 * カメラ距離に応じてレイ stride を上げる
 * @param {THREE.ShaderMaterial} material
 * @param {number} distance
 * @param {number} radius
 */
export function applyPerformanceUniforms(material, distance, radius) {
    if (!material?.uniforms?.rayStride) return;
    let rayStride = 1;
    let lightStride = 1;
    const near = radius * 2.5;
    const mid = radius * 6;
    if (distance > mid) {
        rayStride = 3;
        lightStride = 2;
    } else if (distance > near) {
        rayStride = 2;
        lightStride = 2;
    }
    material.uniforms.rayStride.value = rayStride;
    material.uniforms.lightStride.value = lightStride;
}

/**
 * @param {object} [cfg]
 * @param {object} [pluginConfig]
 */
export function resolveRaymarchRenderOpts(cfg = {}, pluginConfig = {}) {
    const tintSrc = cfg.tint ?? pluginConfig.tint ?? [0.93, 0.96, 1.0];
    const tint = new THREE.Color(tintSrc[0], tintSrc[1], tintSrc[2]);
    let sunWorld;
    if (cfg.sunDirection) {
        sunWorld = new THREE.Vector3(
            cfg.sunDirection.x ?? 0,
            cfg.sunDirection.y ?? 1,
            cfg.sunDirection.z ?? 0,
        );
    } else {
        const sun = cfg.sun ?? pluginConfig.sun ?? { yaw: 40, pitch: 58 };
        const yaw = ((sun.yaw ?? 40) * Math.PI) / 180;
        const pitch = ((sun.pitch ?? 58) * Math.PI) / 180;
        sunWorld = new THREE.Vector3(
            Math.cos(pitch) * Math.sin(yaw),
            Math.sin(pitch),
            Math.cos(pitch) * Math.cos(yaw),
        );
    }
    sunWorld.normalize();
    return {
        raySteps: cfg.raySteps ?? pluginConfig.raySteps ?? 72,
        lightSteps: cfg.lightSteps ?? pluginConfig.lightSteps ?? 10,
        densityScale: cfg.densityScale ?? pluginConfig.densityScale ?? 0.55,
        extinction: cfg.extinction ?? pluginConfig.extinction ?? 1.4,
        scattering: cfg.scattering ?? pluginConfig.scattering ?? 0.85,
        ambient: cfg.ambient ?? pluginConfig.ambient ?? 0.22,
        anisotropy: cfg.anisotropy ?? cfg.g ?? pluginConfig.anisotropy ?? 0.55,
        tint,
        sunWorld,
    };
}

/**
 * メッシュのボックスローカル空間に太陽方向を書き込む
 * @param {THREE.Mesh} mesh
 * @param {THREE.Vector3} sunWorld
 * @param {THREE.ShaderMaterial} material
 */
export function updateSunDirectionUniform(mesh, sunWorld, material) {
    const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const sunLocal = sunWorld.clone().transformDirection(inv).normalize();
    material.uniforms.sunDirection.value.copy(sunLocal);
}

/**
 * VDBLoader が返す grid からレイマーチ用メッシュを作る（グリッドのワールド姿勢のみ。親 Group で配置する）
 * @param {object} grid
 * @param {ReturnType<typeof resolveRaymarchRenderOpts>} [opts]
 */
export function createVdbRaymarchMesh(grid, opts = {}) {
    const renderOpts = opts.sunWorld ? opts : resolveRaymarchRenderOpts(opts);
    const {
        raySteps,
        lightSteps,
        densityScale,
        extinction,
        scattering,
        ambient,
        anisotropy,
        tint,
        sunWorld,
    } = renderOpts;

    const material = new THREE.ShaderMaterial({
        uniforms: {
            map: { value: grid.texture },
            tint: { value: tint },
            sunDirection: { value: new THREE.Vector3(0, 1, 0) },
            densityScale: { value: densityScale },
            extinction: { value: extinction },
            scattering: { value: scattering },
            ambient: { value: ambient },
            anisotropy: { value: anisotropy },
            rayStride: { value: 1 },
            lightStride: { value: 1 },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: buildFragmentShader(raySteps, lightSteps),
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: true,
    });

    const center = grid.bbox.getCenter(new THREE.Vector3());
    const size = grid.bbox.getSize(new THREE.Vector3());
    if (size.lengthSq() < 1e-6) {
        size.set(1, 1, 1);
    }
    size.addScalar(0.02);

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.name = 'vdb-volume-raymarch';
    mesh.frustumCulled = false;
    mesh.renderOrder = 950;
    mesh.matrixAutoUpdate = false;
    mesh.matrix
        .copy(grid.transform)
        .multiply(new THREE.Matrix4().makeTranslation(center).scale(size));
    mesh.updateMatrixWorld(true);
    updateSunDirectionUniform(mesh, sunWorld, material);
    mesh.userData.vdbGridName = grid.name;
    mesh.userData.vdbSunWorld = sunWorld.clone();
    mesh.userData.vdbRenderOpts = { raySteps, lightSteps };
    return mesh;
}

/**
 * メッシュのワールド AABB を返す
 * @param {THREE.Mesh} mesh
 */
export function getVdbMeshWorldBox(mesh) {
    const box = new THREE.Box3();
    const corners = [
        new THREE.Vector3(-0.5, -0.5, -0.5),
        new THREE.Vector3(0.5, -0.5, -0.5),
        new THREE.Vector3(-0.5, 0.5, -0.5),
        new THREE.Vector3(0.5, 0.5, -0.5),
        new THREE.Vector3(-0.5, -0.5, 0.5),
        new THREE.Vector3(0.5, -0.5, 0.5),
        new THREE.Vector3(-0.5, 0.5, 0.5),
        new THREE.Vector3(0.5, 0.5, 0.5),
    ];
    for (const c of corners) {
        c.applyMatrix4(mesh.matrixWorld);
        box.expandByPoint(c);
    }
    return box;
}
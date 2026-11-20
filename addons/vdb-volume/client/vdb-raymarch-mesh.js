// addons/vdb-volume/client/vdb-raymarch-mesh.js — three-vdb-loader グリッドをレイマーチ表示
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
 * @param {number} steps
 * @param {number} densityScale
 */
function buildFragmentShader(steps, densityScale) {
    return `
precision highp sampler3D;
uniform sampler3D map;
uniform vec3 tint;
uniform float densityScale;
varying vec3 vOrigin;
varying vec3 vDirection;
void main() {
    vec3 dir = normalize( vDirection );
    vec3 t0 = ( vec3( -0.5 ) - vOrigin ) / dir;
    vec3 t1 = ( vec3( 0.5 ) - vOrigin ) / dir;
    vec3 near = min( t0, t1 );
    vec3 far = max( t0, t1 );
    float start = max( max( max( near.x, near.y ), near.z ), 0.0 );
    float end = min( min( far.x, far.y ), far.z );
    if ( end <= start ) discard;
    float stepLen = ( end - start ) / float( ${steps} );
    float alpha = 0.0;
    vec3 accum = vec3( 0.0 );
    for ( int i = 0; i < ${steps}; i++ ) {
        float t = start + float( i ) * stepLen;
        vec3 p = vOrigin + dir * t + 0.5;
        float d = texture( map, p ).r * densityScale;
        float sampleAlpha = clamp( d, 0.0, 1.0 );
        accum += ( 1.0 - alpha ) * sampleAlpha * tint;
        alpha += ( 1.0 - alpha ) * sampleAlpha;
        if ( alpha > 0.98 ) break;
    }
    if ( alpha < 0.02 ) discard;
    gl_FragColor = vec4( accum, clamp( alpha, 0.0, 0.95 ) );
}`;
}

/**
 * VDBLoader が返す grid からレイマーチ用メッシュを作る
 * @param {object} grid
 * @param {{ raySteps?: number, densityScale?: number, tint?: THREE.Color }} [opts]
 */
export function createVdbRaymarchMesh(grid, opts = {}) {
    const steps = opts.raySteps ?? 96;
    const densityScale = opts.densityScale ?? 0.08;
    const tint = opts.tint ?? new THREE.Color(0.95, 0.55, 0.15);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            map: { value: grid.texture },
            tint: { value: tint },
            densityScale: { value: densityScale },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: buildFragmentShader(steps, densityScale),
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
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
    mesh.matrixAutoUpdate = false;
    mesh.matrix
        .copy(grid.transform)
        .multiply(new THREE.Matrix4().makeTranslation(center).scale(size));
    mesh.updateMatrixWorld(true);
    mesh.userData.vdbGridName = grid.name;
    return mesh;
}
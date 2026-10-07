import * as THREE from 'three';

// Source's VertexLitGeneric phong pixel shader (CS:GO materialsystem/stdshaders/phong_ps20b.fxc and
// common_vertexlitgeneric_dx9.h), with the constants phong_dx9_helper.cpp derives from each VMT.
// Lighting is Source's per-model light state: an ambient cube plus up to two directional lights here
// (CS:GO forces the first to the sun), with the map's light scale.
export type SourcePhong = { shader: string; phongBoost: number; albedoBoost: number; fresnelRanges: number[]; exponent: number;
  tint: number[]; rim: boolean; rimExponent: number; rimBoost: number; rimMaskControl: number; maskTexture: number };
// Shared, updated each frame: light direction and colours in view space plus the view-to-world rotation.
export const lighting = {
  lightDir: { value: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0)] }, lightColor: { value: [new THREE.Color(0), new THREE.Color(0)] },
  lightScale: { value: 1 },
  ambientCube: { value: [0, 0, 0, 0, 0, 0].map(() => new THREE.Color()) }, viewToWorld: { value: new THREE.Matrix3() },
};

const vertexShader = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
varying vec2 vUv;
varying vec3 vViewPosition;
varying vec3 vNormal;
void main() {
  vUv = uv;
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  vNormal = normalize( transformedNormal );
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vViewPosition = - mvPosition.xyz;
}`;

const fragmentShader = /* glsl */`
uniform sampler2D baseMap, normalMap, maskMap;
uniform bool hasNormalMap, rimLight;
uniform vec2 normalScale;
uniform vec3 lightDir[ 2 ], lightColor[ 2 ], ambientCube[ 6 ], fresnelRanges, tint;
uniform float lightScale;
uniform mat3 viewToWorld;
uniform float phongBoost, albedoBoost, exponent, rimExponent, rimBoost, rimMaskControl;
varying vec2 vUv;
varying vec3 vViewPosition;
varying vec3 vNormal;
// PixelShaderAmbientLight, with the cube on three.js world axes (+x, -x, +y up, -y, +z, -z).
vec3 ambientLight( vec3 n ) {
  vec3 n2 = n * n;
  return n2.x * ( n.x >= 0.0 ? ambientCube[ 0 ] : ambientCube[ 1 ] ) + n2.y * ( n.y >= 0.0 ? ambientCube[ 2 ] : ambientCube[ 3 ] )
    + n2.z * ( n.z >= 0.0 ? ambientCube[ 4 ] : ambientCube[ 5 ] );
}
float fresnel( vec3 n, vec3 v ) { float f = 1.0 - clamp( dot( n, v ), 0.0, 1.0 ); return f * f; }
float fresnelRanges3( vec3 n, vec3 v ) {
  float f = fresnel( n, v );
  return f > 0.5 ? mix( fresnelRanges.y, fresnelRanges.z, 2.0 * f - 1.0 ) : mix( fresnelRanges.x, fresnelRanges.y, 2.0 * f );
}
// Tangent frame from screen-space derivatives (three.js perturbNormal2Arb).
vec3 perturb( vec3 eyePos, vec3 n, vec3 mapN ) {
  vec3 q0 = dFdx( eyePos ), q1 = dFdy( eyePos );
  vec2 st0 = dFdx( vUv ), st1 = dFdy( vUv );
  vec3 q1perp = cross( q1, n ), q0perp = cross( n, q0 );
  vec3 T = q1perp * st0.x + q0perp * st1.x, B = q1perp * st0.y + q0perp * st1.y;
  float det = max( dot( T, T ), dot( B, B ) ), scale = det == 0.0 ? 0.0 : inversesqrt( det );
  return normalize( T * ( mapN.x * scale ) + B * ( mapN.y * scale ) + n * mapN.z );
}
void main() {
  vec4 base = texture2D( baseMap, vUv );
  vec4 masks = texture2D( maskMap, vUv );
  vec3 n = normalize( vNormal );
  if ( hasNormalMap ) {
    vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;
    mapN.xy *= normalScale;
    n = perturb( - vViewPosition, n, mapN );
  }
  vec3 v = normalize( vViewPosition );
  vec3 nWorld = normalize( viewToWorld * n ), vWorld = normalize( viewToWorld * v );
  // Diffuse: CS:GO forces half-lambert off for phong and softens the cosine term.
  vec3 diffuse = ambientLight( nWorld ), specular = vec3( 0.0 ), rim = vec3( 0.0 );
  // Specular: exponent texture red maps to 1..150 unless $phongexponent overrides it.
  float specExp = exponent == 0.0 ? 1.0 - masks.g + 150.0 * masks.g : exponent;
  for ( int i = 0; i < 2; i++ ) {
    float nDotL = clamp( dot( n, lightDir[ i ] ), 0.0, 1.0 );
    float nDotH = clamp( dot( n, normalize( v + lightDir[ i ] ) ), 0.0, 1.0 );
    diffuse += lightColor[ i ] * ( nDotL + nDotL * nDotL ) * 0.5;
    specular += pow( nDotH, specExp ) * sqrt( nDotL ) * lightColor[ i ];
    rim += pow( nDotH, rimExponent ) * nDotL * lightColor[ i ];
  }
  vec3 specTint = tint.r < 0.0 ? mix( vec3( phongBoost ), albedoBoost * base.rgb, masks.b ) : phongBoost * tint;
  specular *= masks.r * specTint * fresnelRanges3( n, v );
  if ( rimLight ) {
    float rimFresnel = fresnel( n, v ); rimFresnel *= rimFresnel; // Fresnel4
    float rimMask = mix( 1.0, masks.a, rimMaskControl );
    specular = max( specular, rim * rimMask * rimFresnel );
    specular += rimFresnel * rimMask * rimBoost * ambientLight( vWorld ) * clamp( nWorld.y, 0.0, 1.0 );
  }
  gl_FragColor = vec4( ( specular + base.rgb * diffuse ) * lightScale, 1.0 );
  #include <colorspace_fragment>
}`;

export function sourcePhongMaterial(params: SourcePhong, base: THREE.Texture, normal: THREE.Texture | null, normalScale: THREE.Vector2, masks: THREE.Texture) {
  masks.colorSpace = THREE.NoColorSpace;
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader,
    uniforms: {
      ...lighting,
      baseMap: { value: base }, normalMap: { value: normal }, maskMap: { value: masks }, hasNormalMap: { value: !!normal },
      normalScale: { value: normalScale.clone() }, rimLight: { value: params.rim },
      fresnelRanges: { value: new THREE.Vector3(...params.fresnelRanges) }, tint: { value: new THREE.Vector3(...params.tint) },
      phongBoost: { value: params.phongBoost }, albedoBoost: { value: params.albedoBoost }, exponent: { value: params.exponent },
      rimExponent: { value: params.rimExponent }, rimBoost: { value: params.rimBoost }, rimMaskControl: { value: params.rimMaskControl },
    },
  });
}

import * as THREE from 'three';

// Source LDR LightmappedGeneric: result = albedo × lightmap × 2 (overbright) in gamma space, where the lightmap
// texture holds (L/2)^(1/2.2) as CS:GO stores LDR lightmaps. Textures are sampled raw (gamma) and the
// result is written out as display colour, so no lights, shadows or tone mapping run for map surfaces.
const vertexShader = /* glsl */`
attribute vec2 uv1;
#ifdef BUMP
attribute float lmStep;
varying float vLightmapStep;
#endif
varying vec2 vUv;
varying vec2 vLightmapUv;
void main() {
  vUv = uv; vLightmapUv = uv1;
  #ifdef BUMP
  vLightmapStep = lmStep;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
const fragmentShader = /* glsl */`
uniform sampler2D map, lightmap;
uniform bool hasMap;
uniform vec3 color;
uniform float alphaTest;
uniform bool lit, modulate;
varying vec2 vUv;
varying vec2 vLightmapUv;
#ifdef BUMP
// Bumped lightmaps (lightmappedgeneric_ps2_3_x.h): the three directional lightmaps beside the flat one, weighted by
// the tangent-space normal against Source's bump basis. VRAD bakes in that same basis, so no vertex tangents are needed.
uniform sampler2D normalMap;
uniform bool ssbump;
varying float vLightmapStep;
const vec3 bumpBasis0 = vec3( 0.81649661064147949, 0.0, 0.57735025882720947 );
const vec3 bumpBasis1 = vec3( -0.40824833512306213, 0.70710676908493042, 0.57735025882720947 );
const vec3 bumpBasis2 = vec3( -0.40824821591377258, -0.7071068286895752, 0.57735025882720947 );
vec3 lightmapSample() {
  if ( vLightmapStep <= 0.0 ) return texture2D( lightmap, vLightmapUv ).rgb;
  vec3 n = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;
  vec3 l1 = texture2D( lightmap, vLightmapUv + vec2( vLightmapStep, 0.0 ) ).rgb;
  vec3 l2 = texture2D( lightmap, vLightmapUv + vec2( 2.0 * vLightmapStep, 0.0 ) ).rgb;
  vec3 l3 = texture2D( lightmap, vLightmapUv + vec2( 3.0 * vLightmapStep, 0.0 ) ).rgb;
  if ( ssbump ) return ( n.x * l1 + n.y * l2 + n.z * l3 ) * 0.57735025882720947;
  vec3 dp = clamp( vec3( dot( n, bumpBasis0 ), dot( n, bumpBasis1 ), dot( n, bumpBasis2 ) ), 0.0, 1.0 );
  dp *= dp;
  return ( dp.x * l1 + dp.y * l2 + dp.z * l3 ) / max( dot( dp, vec3( 1.0 ) ), 1e-4 );
}
#else
vec3 lightmapSample() { return texture2D( lightmap, vLightmapUv ).rgb; }
#endif
void main() {
  vec4 albedo = hasMap ? texture2D( map, vUv ) : vec4( color, 1.0 );
  if ( albedo.a < alphaTest ) discard;
  // DecalModulate is a 2x multiply with the framebuffer (src * dst + dst * src); the shader just outputs the texture.
  if ( modulate ) { gl_FragColor = vec4( mix( vec3( 0.5 ), albedo.rgb, albedo.a ), 1.0 ); return; }
  vec3 color = lit ? min( albedo.rgb * lightmapSample() * 2.0, 1.0 ) : albedo.rgb;
  gl_FragColor = vec4( color, alphaTest < 0.0 ? albedo.a : 1.0 );
}`;

export function lightmappedMaterial(map: THREE.Texture | null, reflectivity: number[], lightmap: THREE.Texture, alphaTest: number,
  decal?: { blend: 'alpha' | 'modulate'; lit: boolean }, bump?: { normalMap: THREE.Texture; ssbump: boolean }) {
  if (map) map.colorSpace = THREE.NoColorSpace;
  // Texture reflectivity (texdata) is linear; the shader works in gamma space.
  const color = new THREE.Color(...reflectivity.map(v => Math.pow(v, 1 / 2.2)) as [number, number, number]);
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, side: THREE.DoubleSide,
    uniforms: { map: { value: map }, hasMap: { value: !!map }, color: { value: color }, lightmap: { value: lightmap },
      // A negative alphaTest marks a blended decal: output the texture's alpha instead of testing it.
      alphaTest: { value: decal ? -1 : alphaTest }, lit: { value: decal ? decal.lit : true }, modulate: { value: decal?.blend === 'modulate' },
      normalMap: { value: bump?.normalMap ?? null }, ssbump: { value: bump?.ssbump ?? false } },
    // Only bump-mapped materials compile the extra lightmap and normal fetches.
    defines: bump ? { BUMP: '' } : {},
  });
  if (decal) {
    Object.assign(material, { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    if (decal.blend === 'modulate') Object.assign(material, { blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.SrcColorFactor });
  }
  return material;
}

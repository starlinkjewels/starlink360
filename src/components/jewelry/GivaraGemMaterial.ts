/**
 * givara's gem material, ported verbatim.
 *
 * WHY A SECOND GEM MATERIAL EXISTS
 *
 * `GemTransportMaterial` fixed drei's transport but kept drei's intersection:
 * `bvhIntersectFirstHit` against the exact triangles. That is more physically
 * literal, and it is also why it could never match the reference. Measured on
 * SDAG076's centre stone against givara's:
 *
 *   facet contrast   37.3   vs   54.2
 *   coloured pixels  18.2%  vs    0.9%
 *
 * Dropping dispersion from 0.005 to 0.002 moved the colour by barely a point
 * (19.6% -> 18.2%), which is the tell: that rainbow is not the dispersion
 * uniform, it is the trace itself. A razor-flat triangle normal sends adjacent
 * pixels to wildly different places, every bounce compounds it, and the three
 * colour channels diverge independently — so the stone fills with chromatic
 * speckle across small shards instead of resolving into facet planes.
 *
 * This material traces the SMOOTHED HULL instead, exactly as givara does: a
 * cubemap baked from the stone's own centre storing surface normal and
 * distance per direction (see diamondNormalCapture.ts). Sampling that is
 * bilinear, so neighbouring pixels get continuous normals and the trace stays
 * coherent. That continuity is what produces clean planes and contained fire.
 *
 * The cost is that it is only valid for a geometry that is star-shaped about
 * its own centre — one solid. A merged pavé field of two hundred stones shares
 * one centre and one hull, and the trace would be meaningless, so those keep
 * using GemTransportMaterial's BVH path. See the selection in GemRefraction.
 *
 * Everything below is givara's file unchanged, including its calibration.
 */
import * as THREE from "three";

export type GemRole = "centerStone" | "accentStone";

const vertexShader = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;

void main() {
  vec4 worldPos = modelMatrix * vec4( position, 1.0 );
  vWorldPosition = worldPos.xyz;
  vWorldNormal = normalize( ( modelMatrix * vec4( normal, 0.0 ) ).xyz );
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const fragmentShader = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  precision highp sampler2D;
  precision highp samplerCube;
#else
  precision mediump float;
  precision mediump sampler2D;
  precision mediump samplerCube;
#endif

varying vec3 vWorldNormal;
varying vec3 vWorldPosition;

uniform float radius;
uniform vec3 centerOffset;
uniform mat4 modelOffsetMatrix;
uniform mat4 modelOffsetMatrixInv;
uniform sampler2D envMap;
uniform samplerCube tCubeMapNormals;
uniform float envMapIntensity;
uniform float refractiveIndex;
uniform float rIndexDelta;
uniform float squashFactor;
uniform float geometryFactor;
uniform vec3 color;
uniform vec3 colorCorrection;
uniform vec3 boostFactors;
uniform float gammaFactor;
uniform float absorptionFactor;
uniform float envMapRotation;
uniform float reflectivity;
uniform float useExtinctionFix;

#define CENTER_OFFSET centerOffset

/** Karis' analytic fit to the split-sum environment BRDF. */
vec3 BRDF_Specular_GGX_Environment( const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float roughness ) {
  float dotNV = clamp( abs( dot( normal, viewDir ) ), 0.001, 1.0 );
  const vec4 c0 = vec4( -1.0, -0.0275, -0.572, 0.022 );
  const vec4 c1 = vec4( 1.0, 0.0425, 1.04, -0.04 );
  vec4 r = roughness * c0 + c1;
  float a004 = min( r.x * r.x, exp2( -9.28 * dotNV ) ) * r.x + r.y;
  vec2 AB = vec2( -1.04, 1.04 ) * a004 + r.zw;
  return clamp( specularColor * AB.x + AB.y, vec3( 0.0 ), vec3( 1.0 ) );
}

vec2 cartesianToPolar( vec3 n ) {
  vec2 uv;
  uv.x = atan( n.z, n.x ) / ( PI * 2.0 ) + 0.5;
  uv.y = asin( n.y ) / PI + 0.5;
  return uv;
}

vec4 sampleEnvMap( vec3 direction ) {
  #if !defined( USE_ENVMAP )
    return vec4( direction, 1.0 );
  #else
    float cs = cos( envMapRotation );
    float sn = sin( envMapRotation );
    float temp = cs * direction.x + sn * direction.z;
    direction.z = -sn * direction.x + cs * direction.z;
    direction.x = temp;
    direction.x *= -1.0;
    direction.y *= -1.0;
    direction.z *= -1.0;
    vec4 sampled;
    #if ENV_MAP_TYPE == 0
      sampled = textureCube( envMap, direction );
    #elif ENV_MAP_TYPE == 1
      sampled = texture2D( envMap, cartesianToPolar( direction ) );
    #else
      sampled = vec4( 1.0, 0.0, 1.0, 1.0 );
    #endif
    sampled.rgb = max( sampled.rgb, vec3( 0.0 ) );
    // Soft shoulder on the HDR. Without it a single sun-bright texel carried
    // through five bounces overwhelms everything it touches.
    const float threshold = 2.0;
    sampled.rgb = sampled.rgb / ( 1.0 + sampled.rgb / threshold );
    return sampled;
  #endif
}

vec3 safeNormalize( vec3 v, vec3 fallback ) {
  float len = length( v );
  return len > 1e-6 ? v / len : fallback;
}

vec4 SampleSpecularReflection( vec3 direction ) {
  return envMapIntensity * sampleEnvMap( direction );
}

vec4 SampleSpecularContribution( vec3 direction ) {
  #if DIA_ORIENT_ENVMAP < 1
    direction = mat3( modelOffsetMatrix ) * direction;
  #endif
  direction = safeNormalize( direction, vec3( 0.0, 1.0, 0.0 ) );
  direction.x *= -1.0;
  direction.z *= -1.0;
  return envMapIntensity * sampleEnvMap( direction );
}

/** First guess at where a ray leaves the stone: the bounding sphere. */
vec3 intersectSphere( vec3 origin, vec3 direction ) {
  origin -= CENTER_OFFSET;
  direction.y /= squashFactor;
  float A = dot( direction, direction );
  float B = 2.0 * dot( origin, direction );
  float C = dot( origin, origin ) - radius * radius;
  float disc = B * B - 4.0 * A * C;
  if ( disc > 0.0 ) {
    disc = sqrt( disc );
    float t1 = ( -B + disc ) * geometryFactor / A;
    float t2 = ( -B - disc ) * geometryFactor / A;
    float t = ( t1 > t2 ) ? t1 : t2;
    direction.y *= squashFactor;
    return vec3( origin + CENTER_OFFSET + direction * t );
  }
  return CENTER_OFFSET;
}

vec3 linePlaneIntersect( in vec3 pointOnLine, in vec3 lineDirection, in vec3 pointOnPlane, in vec3 planeNormal ) {
  float denom = dot( planeNormal, lineDirection );
  if ( abs( denom ) < 1e-8 ) return pointOnPlane;
  return lineDirection * ( dot( planeNormal, pointOnPlane - pointOnLine ) / denom ) + pointOnLine;
}

vec4 getNormalDistance( vec3 d ) { return textureCube( tCubeMapNormals, d ); }

vec3 getSurfaceNormal( vec4 surfaceInfos ) {
  vec3 n = surfaceInfos.rgb;
  n = n * 2.0 - 1.0;
  return -safeNormalize( n, vec3( 0.0, 0.0, 1.0 ) );
}

/**
 * Where does this ray leave the stone?
 *
 * Fixed-point iteration: guess a point on the hull, look up the facet that
 * actually lies in that direction, intersect the ray with that facet's plane,
 * and repeat. Three rounds is enough to land on the right facet for a brilliant
 * cut, and it is a constant cost regardless of how many facets the stone has.
 */
vec3 intersect( vec3 rayOrigin, vec3 rayDirection ) {
  vec3 sphereHitPoint = intersectSphere( rayOrigin, rayDirection );
  vec3 d1 = safeNormalize( sphereHitPoint - CENTER_OFFSET, vec3( 0.0, 1.0, 0.0 ) );
  vec4 nd1 = getNormalDistance( d1 );
  vec3 p1 = CENTER_OFFSET + d1 * nd1.a * radius;
  vec3 n1 = getSurfaceNormal( nd1 );
  vec3 h1 = linePlaneIntersect( rayOrigin, rayDirection, p1, n1 );

  vec3 d2 = safeNormalize( h1 - CENTER_OFFSET, vec3( 0.0, 1.0, 0.0 ) );
  vec4 nd2 = getNormalDistance( d2 );
  vec3 p2 = CENTER_OFFSET + d2 * nd2.a * radius;
  vec3 n2 = getSurfaceNormal( nd2 );
  vec3 h2 = linePlaneIntersect( rayOrigin, rayDirection, p2, n2 );

  vec3 d3 = safeNormalize( h2 - CENTER_OFFSET, vec3( 0.0, 1.0, 0.0 ) );
  vec4 nd3 = getNormalDistance( d3 );
  vec3 p3 = CENTER_OFFSET + d3 * nd3.a * radius;
  vec3 n3 = getSurfaceNormal( nd3 );
  return linePlaneIntersect( rayOrigin, rayDirection, p3, n3 );
}

/**
 * Trace the light that enters the stone and eventually leaves it.
 *
 * At each facet the ray either refracts out (contributing colour, split three
 * ways for dispersion) or totally internally reflects and carries on. That
 * alternation, not the surface mirror, is what a brilliant cut is for.
 */
vec3 getRefractionColor( vec3 origin, vec3 direction, vec3 normal ) {
  vec3 outColor = vec3( 0.0 );
  const float n1 = 1.0;
  const float epsilon = 1e-3;
  float f0 = ( 2.4 - n1 ) / ( 2.4 + n1 );
  f0 *= f0;
  vec3 attenuationFactor = vec3( 1.0 );

  vec3 newDirection = refract( direction, normal, n1 / refractiveIndex );
  if ( dot( newDirection, newDirection ) < epsilon ) return vec3( 0.0 );
  vec3 brdfRefracted = BRDF_Specular_GGX_Environment( newDirection, -normal, vec3( f0 ), 0.0 );
  attenuationFactor *= ( vec3( 1.0 ) - brdfRefracted );

  // Into the stone's own space, where the normal cubemap is defined.
  mat4 invModelOffsetMatrix = modelOffsetMatrixInv;
  newDirection = safeNormalize( ( invModelOffsetMatrix * vec4( newDirection, 0.0 ) ).xyz, vec3( 0.0, 1.0, 0.0 ) );
  origin = ( invModelOffsetMatrix * vec4( origin, 1.0 ) ).xyz;

  for ( int i = 0; i < RAY_BOUNCES; i++ ) {
    vec3 intersectedPos = intersect( origin, newDirection );
    vec3 dist = intersectedPos - origin;
    vec3 d = safeNormalize( intersectedPos - CENTER_OFFSET, vec3( 0.0, 1.0, 0.0 ) );
    vec3 mappedNormal = getNormalDistance( d ).rgb;
    mappedNormal = 2.0 * mappedNormal - 1.0;
    mappedNormal = -safeNormalize( mappedNormal, vec3( 0.0, 0.0, 1.0 ) );

    // Beer-Lambert: a longer path through the stone means more absorption. For
    // a white diamond color is 1 and this is a no-op; it is what would give a
    // coloured stone its depth.
    float r = clamp( length( dist ) / radius * absorptionFactor, 0.0, 10.0 );
    attenuationFactor *= exp( -r * max( 1.0 - color, vec3( 0.0 ) ) );

    origin = intersectedPos;
    vec3 oldDir = newDirection;
    newDirection = refract( newDirection, mappedNormal, refractiveIndex / n1 );

    if ( dot( newDirection, newDirection ) < epsilon ) {
      // Total internal reflection: nothing escapes here, keep bouncing.
      newDirection = reflect( oldDir, mappedNormal );
      newDirection = safeNormalize( newDirection, vec3( 0.0, 1.0, 0.0 ) );
      if ( i == RAY_BOUNCES - 1 ) {
        vec3 brdfR = BRDF_Specular_GGX_Environment( -oldDir, mappedNormal, vec3( f0 ), 0.0 );
        outColor += SampleSpecularContribution( oldDir ).rgb * attenuationFactor * colorCorrection * boostFactors * ( vec3( 1.0 ) - brdfR );
      }
    } else {
      vec3 brdfRefracted2 = vec3( 1.0 ) - BRDF_Specular_GGX_Environment( newDirection, -mappedNormal, vec3( f0 ), 0.0 );
      // Dispersion. Red and blue leave at measurably different angles, so each
      // channel samples the environment somewhere slightly different. This is
      // the fire, and it is the whole reason diamond throws colour where glass
      // only glitters.
      vec3 dir0 = newDirection;
      vec3 dir1 = refract( oldDir, mappedNormal, ( refractiveIndex + rIndexDelta ) / n1 );
      vec3 dir2 = refract( oldDir, mappedNormal, ( refractiveIndex - rIndexDelta ) / n1 );
      if ( dot( dir1, dir1 ) < epsilon ) dir1 = dir0;
      if ( dot( dir2, dir2 ) < epsilon ) dir2 = dir0;
      outColor += vec3(
        SampleSpecularContribution( dir1 ).r,
        SampleSpecularContribution( dir0 ).g,
        SampleSpecularContribution( dir2 ).b
      ) * brdfRefracted2 * attenuationFactor * colorCorrection * boostFactors;

      newDirection = reflect( oldDir, mappedNormal );
      newDirection = safeNormalize( newDirection, vec3( 0.0, 1.0, 0.0 ) );
      vec3 brdfReflected2 = BRDF_Specular_GGX_Environment( newDirection, mappedNormal, vec3( f0 ), 0.0 );
      attenuationFactor *= brdfReflected2 * boostFactors;
    }

    outColor = clamp( outColor, vec3( 0.0 ), vec3( 64.0 ) );
    attenuationFactor = clamp( attenuationFactor, vec3( 0.0 ), vec3( 1.0 ) );
  }
  return outColor;
}

void main() {
  vec3 normalizedNormal = normalize( vWorldNormal );
  vec3 viewVector = normalize( vWorldPosition - cameraPosition );
  const float n1 = 1.0;
  float f0 = ( 2.4 - n1 ) / ( 2.4 + n1 );
  f0 *= f0;

  // The surface mirror: the crisp highlight sitting on top of the trace.
  vec3 reflectedDirection = reflect( viewVector, normalizedNormal );
  vec3 brdfReflected = BRDF_Specular_GGX_Environment( reflectedDirection, normalizedNormal, vec3( f0 ), 0.0 );
  vec3 reflectionColor = SampleSpecularReflection( reflectedDirection ).rgb * brdfReflected * reflectivity * 2.0;

  vec3 refractionColor = getRefractionColor( vWorldPosition, viewVector, normalizedNormal );

  const float MAX_OUTPUT = 16.0;
  vec3 combined = clamp( refractionColor.rgb + reflectionColor.rgb, vec3( 0.0 ), vec3( MAX_OUTPUT ) );

  // A ray can run out of bounces still inside the stone and return nothing,
  // which shows up as an unnaturally dead black facet. Where that happens,
  // fall back toward the surrounding environment rather than to void.
  if ( useExtinctionFix > 0.5 ) {
    float lum = dot( combined, vec3( 0.299, 0.587, 0.114 ) );
    float darkBlend = smoothstep( 0.25, 0.0, lum );
    if ( darkBlend > 0.0 ) {
      vec3 offsetDir = normalize( reflectedDirection + normalizedNormal * 0.3 );
      vec3 fallback = SampleSpecularReflection( reflectedDirection ).rgb * 0.5
        + SampleSpecularReflection( normalizedNormal ).rgb * 0.2
        + SampleSpecularReflection( offsetDir ).rgb * 0.15;
      combined = mix( combined, max( combined, fallback ), darkBlend );
    }
  }

  gl_FragColor = vec4( pow( combined, vec3( gammaFactor ) ), 1.0 );
}
`;

interface GemPreset {
  color: number;
  envMapIntensity: number;
  /** Per-channel IOR spread. Diamond's is unusually high, hence the fire. */
  dispersion: number;
  squashFactor: number;
  geometryFactor: number;
  gammaFactor: number;
  absorptionFactor: number;
  reflectivity: number;
  refractiveIndex: number;
  rayBounces: number;
  boost: number;
}

/**
 * Calibration from the reference builder. These are not free parameters —
 * `refractiveIndex` and `dispersion` are diamond's real optical constants, and
 * the rest were set against physical stones.
 */
const CENTER_PRESET: GemPreset = {
  color: 0xffffff,
  envMapIntensity: 1.5,
  dispersion: 0.005,
  squashFactor: 0.98,
  geometryFactor: 0.5,
  gammaFactor: 1.5,
  absorptionFactor: 1,
  reflectivity: 0.5,
  refractiveIndex: 2.42,
  rayBounces: 5,
  boost: 1.45,
};

/**
 * Melee is half a millimetre across and covers a few pixels. It is pushed
 * brighter and less absorbent than the centre stone so it registers at all,
 * and its lower gamma keeps it from crushing to black at that size.
 */
const ACCENT_PRESET: GemPreset = {
  ...CENTER_PRESET,
  envMapIntensity: 1.6,
  absorptionFactor: 0.5,
  gammaFactor: 1.3,
  boost: 1.6,
};

export const GEM_PRESETS: Record<GemRole, GemPreset> = {
  centerStone: CENTER_PRESET,
  accentStone: ACCENT_PRESET,
};

/**
 * One material per stone. The trace runs in the stone's own space, so
 * `radius`, `centerOffset` and `tCubeMapNormals` all describe *this* stone and
 * cannot be shared across a band of them.
 */
export function createGemMaterial(role: GemRole, envMap: THREE.Texture): THREE.ShaderMaterial {
  const preset = GEM_PRESETS[role];
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    defines: {
      DIA_ORIENT_ENVMAP: 0,
      RAY_BOUNCES: preset.rayBounces,
      PI: "3.14159265359",
      // Equirectangular: the HDRIs are sampled directly, unprefiltered.
      ENV_MAP_TYPE: 1,
      USE_ENVMAP: "",
    },
    uniforms: {
      envMap: { value: envMap },
      tCubeMapNormals: { value: null },
      envMapIntensity: { value: preset.envMapIntensity },
      envMapRotation: { value: 0 },
      refractiveIndex: { value: preset.refractiveIndex },
      rIndexDelta: { value: preset.dispersion },
      squashFactor: { value: preset.squashFactor },
      geometryFactor: { value: preset.geometryFactor },
      color: { value: new THREE.Color(preset.color) },
      colorCorrection: { value: new THREE.Vector3(1, 1, 1) },
      boostFactors: { value: new THREE.Vector3(preset.boost, preset.boost, preset.boost) },
      gammaFactor: { value: preset.gammaFactor },
      absorptionFactor: { value: preset.absorptionFactor },
      reflectivity: { value: preset.reflectivity },
      radius: { value: 1 },
      centerOffset: { value: new THREE.Vector3() },
      modelOffsetMatrix: { value: new THREE.Matrix4() },
      modelOffsetMatrixInv: { value: new THREE.Matrix4() },
      useExtinctionFix: { value: 1 },
    },
  });
  // The trace is emissive by construction and already gamma-shaped; letting
  // three tone map it again would flatten exactly the highlights bloom needs.
  material.toneMapped = false;
  return material;
}

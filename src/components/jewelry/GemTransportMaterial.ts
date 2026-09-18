/**
 * Gem material: drei's BVH intersection, a different light transport.
 *
 * WHY THIS EXISTS
 *
 * `diamondOptics.ts` records ~31 phases chasing "muddy gray facet / soft
 * internal gradients", and Phase 31 landed the decisive diagnostic: a plain
 * `reflect(view, normal)` environment sample on the SAME geometry and normals
 * showed real, coherent facet-to-facet variation. The geometry is capable; the
 * transport is what flattens it. Phases 28-30 then tried to recover that
 * variation downstream — tone-shaping the result, or reshuffling which
 * direction an exhausted ray samples — and every one was reverted.
 *
 * Reading drei's shader explains why none of them could work. Its
 * `totalInternalReflection` produces only a *direction*:
 *
 *     for (i < bounces) { refract? -> break : reflect; }
 *     return rayDirection;
 *     ...
 *     diffuseColor.rgb *= texture(envMap, rayDirection).rgb;   // one sample
 *     gl_FragColor = mix(diffuseColor.rgb, vec3(1.0), nFresnel);
 *
 * Three consequences, all measured on SDAG076 before this file existed
 * (centre stone, neutral pixels): mean 230.9, facet contrast 17.0 standard
 * deviations of luminance, and 0.1% of the stone below 140/255. The Origem
 * reference measures 176.4 / 38.0 / 17.6% on the same metrics.
 *
 *   1. One environment sample per pixel. However many times the ray bounced
 *      internally, only the final direction is ever looked up, so the bounces
 *      change *where* a facet samples but never how much light it returns.
 *      A real brilliant sheds light through the crown at every bounce.
 *   2. A ray that exhausts the bounce budget returns whatever its last forced
 *      `reflect()` produced, as if that were a genuine exit. No fallback —
 *      exactly the ~72% path this project already measured.
 *   3. `mix(colour, vec3(1.0), nFresnel)` drags every grazing facet toward
 *      pure white. GemRefraction's own comment calls this out. It is the
 *      single biggest reason the stone sits in a 206-245 band.
 *
 * WHAT CHANGED
 *
 * The intersection is still drei's — `bvhIntersectFirstHit` against the real
 * facets. That is deliberately kept: this project merges a pave field into one
 * mesh per Rhino layer (see stones.ts), and a BVH is the only thing that
 * traces correctly through merged geometry. Nothing about the asset pipeline
 * has to change.
 *
 * What is replaced is everything after the hit:
 *
 *   - light accumulates at every bounce where the ray refracts out, instead of
 *     one sample at the end;
 *   - attenuation carries along the path — Fresnel at each interface plus
 *     Beer-Lambert absorption over the distance actually travelled, which is
 *     what makes a short path and a long path read differently;
 *   - dispersion is applied per channel at each exit rather than by tracing
 *     the whole path three times, so this is also one BVH trace instead of
 *     three;
 *   - a ray that exhausts its budget contributes its last direction explicitly
 *     rather than falling through;
 *   - the surface reflection is an additive, BRDF-weighted environment term
 *     rather than a lerp toward white;
 *   - the environment sample passes through a bounded shoulder, which answers
 *     the lesson recorded in diamondOptics.ts that "the environment itself,
 *     not the weight, is what's unbounded";
 *   - and `extinctionFix` lifts *only* pixels that come back essentially dead.
 *
 * ON THAT LAST ONE, specifically: Phase 31 added an environment term and it
 * washed out bright facets, correctly rejected. This one cannot do that. It is
 * gated by `smoothstep(0.25, 0.0, luminance)` so it is zero for anything that
 * already has signal, and it combines with `max()` rather than by adding, so
 * it can only ever raise a pixel toward the environment — never push one past
 * it. Those two properties are the difference between this and the reverted
 * attempt, and they are why it is safe to have on by default.
 *
 * Transport ported from the Origem ring builder's DiamondMaterial, whose
 * constants are a jeweller's calibration rather than free parameters.
 */
import * as THREE from "three";
import { shaderStructs, shaderIntersectFunction, MeshBVHUniformStruct } from "three-mesh-bvh";

const vertexShader = /* glsl */ `
uniform mat4 viewMatrixInverse;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying mat4 vModelMatrixInverse;

#include <color_pars_vertex>

void main() {
  #include <color_vertex>

  vec4 transformedNormal = vec4( normal, 0.0 );
  vec4 transformedPosition = vec4( position, 1.0 );
  #ifdef USE_INSTANCING
    transformedNormal = instanceMatrix * transformedNormal;
    transformedPosition = instanceMatrix * transformedPosition;
  #endif

  #ifdef USE_INSTANCING
    vModelMatrixInverse = inverse( modelMatrix * instanceMatrix );
  #else
    vModelMatrixInverse = inverse( modelMatrix );
  #endif

  vWorldPosition = ( modelMatrix * transformedPosition ).xyz;
  vNormal = normalize( ( viewMatrixInverse * vec4( normalMatrix * transformedNormal.xyz, 0.0 ) ).xyz );
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * transformedPosition;
}
`;

const fragmentShader = /* glsl */ `
#define ENVMAP_TYPE_CUBE_UV
precision highp isampler2D;
precision highp usampler2D;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying mat4 vModelMatrixInverse;

#include <color_pars_fragment>

#ifdef ENVMAP_TYPE_CUBEM
  uniform samplerCube envMap;
#else
  uniform sampler2D envMap;
#endif

uniform float bounces;
${shaderStructs}
${shaderIntersectFunction}
uniform BVH bvh;
uniform float ior;
uniform bool correctMips;
uniform vec2 resolution;
uniform float fresnel;
uniform mat4 modelMatrix;
uniform mat4 projectionMatrixInverse;
uniform mat4 viewMatrixInverse;
uniform float aberrationStrength;
uniform vec3 color;
uniform float opacity;

uniform float uDiamondEnvIntensity;
uniform float uDiamondEnvRotation;
uniform float absorptionFactor;
uniform float boost;
uniform float gammaFactor;
uniform float envShoulder;
uniform float gemEnvIntensity;
/*
 * Facet-normal smoothing — the single most important control in this file for
 * whether the stone reads as cut or as shattered.
 *
 * bvhIntersectFirstHit hands back the exact, razor-flat normal of whichever
 * triangle the ray hit, and facetGeometry deliberately gives every triangle
 * its own unblended normal. A mirror reflection off a perfectly flat plane is
 * chaotically sensitive: two rays a pixel apart diverge after one bounce, and
 * every further bounce compounds it. That is what turns five bounces into
 * small disconnected shards instead of clean facet planes.
 *
 * Blending each hit normal a little toward a genuinely smooth one recovers the
 * coherence. At 0 this is an exact identity, so it can be dialled out.
 */
uniform float uGeometryFactor;
uniform sampler2D uSmoothNormalMap;
uniform float extinctionFix;

#include <common>
#include <cube_uv_reflection_fragment>

#ifdef ENVMAP_TYPE_CUBEM
  vec4 textureGradient( samplerCube env, vec3 rayDirection, vec3 directionCamPerfect ) {
    return textureGrad( env, rayDirection,
      dFdx( correctMips ? directionCamPerfect : rayDirection ),
      dFdy( correctMips ? directionCamPerfect : rayDirection ) );
  }
#else
  vec4 textureGradient( sampler2D env, vec3 rayDirection, vec3 directionCamPerfect ) {
    vec2 uvv = equirectUv( rayDirection );
    vec2 smoothUv = equirectUv( directionCamPerfect );
    return textureGrad( env, uvv,
      dFdx( correctMips ? smoothUv : uvv ),
      dFdy( correctMips ? smoothUv : uvv ) );
  }
#endif

/**
 * Bounded environment read.
 *
 * A single very bright texel carried through five bounces otherwise dominates
 * everything it touches, which is the unbounded-environment failure recorded
 * in diamondOptics.ts. The shoulder is a soft roll-off, not a clamp, so
 * relative brightness survives.
 */
vec3 sampleEnv( vec3 dir, vec3 dirPerfect ) {
  // Rotation applied to the direction rather than to a uv, so it works for a
  // cube map as well as an equirect. The uv-level patch it replaces was a
  // documented no-op on cube textures.
  float a = uDiamondEnvRotation * 6.283185307179586;
  float ca = cos( a );
  float sa = sin( a );
  vec3 d = normalize( dir );
  d = vec3( ca * d.x + sa * d.z, d.y, -sa * d.x + ca * d.z );
  vec3 s = max( textureGradient( envMap, d, dirPerfect ).rgb, vec3( 0.0 ) );
  // Shoulder FIRST, gain SECOND — the order matters. Applying the gain before
  // the roll-off would just push more of the range into the shoulder and
  // compress the contrast it is there to protect. This is the reference's
  // envMapIntensity * sampleEnvMap(dir), and it was missing: every
  // environment read was landing at unit gain where the reference uses 1.5.
  return ( s / ( 1.0 + s / envShoulder ) ) * gemEnvIntensity;
}

/** Karis' analytic fit to the split-sum environment BRDF. */
vec3 envBRDF( vec3 viewDir, vec3 normal, vec3 specularColor, float roughness ) {
  float dotNV = clamp( abs( dot( normal, viewDir ) ), 0.001, 1.0 );
  const vec4 c0 = vec4( -1.0, -0.0275, -0.572, 0.022 );
  const vec4 c1 = vec4( 1.0, 0.0425, 1.04, -0.04 );
  vec4 r = roughness * c0 + c1;
  float a004 = min( r.x * r.x, exp2( -9.28 * dotNV ) ) * r.x + r.y;
  vec2 AB = vec2( -1.04, 1.04 ) * a004 + r.zw;
  return clamp( specularColor * AB.x + AB.y, vec3( 0.0 ), vec3( 1.0 ) );
}

float fresnelFunc( vec3 viewDirection, vec3 worldNormal ) {
  return pow( 1.0 + dot( viewDirection, worldNormal ), 10.0 );
}

/**
 * Trace the light that enters the stone and eventually leaves it.
 *
 * At each facet the ray either refracts out — contributing colour, split three
 * ways for dispersion — or totally internally reflects and carries on. That
 * alternation, not the surface mirror, is what a brilliant cut is for.
 */
vec3 tracePath( vec3 incident, vec3 surfaceNormal, vec3 dirPerfect ) {
  vec3 outColor = vec3( 0.0 );
  vec3 atten = vec3( 1.0 );
  const float EPS = 1e-3;

  float f0 = ( ior - 1.0 ) / ( ior + 1.0 );
  f0 *= f0;

  vec3 dir = refract( incident, surfaceNormal, 1.0 / ior );
  if ( dot( dir, dir ) < EPS ) return vec3( 0.0 );
  atten *= vec3( 1.0 ) - envBRDF( dir, -surfaceNormal, vec3( f0 ), 0.0 );

  // Into the stone's own space, where the BVH lives.
  vec3 origin = vWorldPosition + dir * 0.001;
  origin = ( vModelMatrixInverse * vec4( origin, 1.0 ) ).xyz;
  dir = normalize( ( vModelMatrixInverse * vec4( dir, 0.0 ) ).xyz );

  for ( int i = 0; i < 12; i++ ) {
    if ( float( i ) >= bounces ) break;

    uvec4 faceIndices = uvec4( 0u );
    vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
    vec3 barycoord = vec3( 0.0 );
    float side = 1.0;
    float dist = 0.0;
    bvhIntersectFirstHit( bvh, origin, dir, faceIndices, faceNormal, barycoord, side, dist );
    // three-mesh-bvh's own barycentric attribute read, at the hit point.
    vec3 gSmoothNormal = textureSampleBarycoord( uSmoothNormalMap, barycoord, faceIndices.xyz ).xyz;
    faceNormal = normalize( mix( faceNormal, gSmoothNormal, uGeometryFactor ) );
    vec3 hitPos = origin + dir * max( dist - 0.001, 0.0 );

    // Beer-Lambert over the distance actually travelled. For a colourless
    // stone color is 1 and this is a no-op; it is what gives a ruby its
    // depth, and what separates a short internal path from a long one.
    float travel = clamp( dist * absorptionFactor, 0.0, 10.0 );
    atten *= exp( -travel * max( vec3( 1.0 ) - color, vec3( 0.0 ) ) );

    vec3 oldDir = dir;
    vec3 exitDir = refract( dir, faceNormal, ior );
    bool lastBounce = ( float( i ) >= bounces - 1.0 );

    if ( dot( exitDir, exitDir ) > EPS ) {
      // Light leaves here. Accumulate it, then carry on with what reflects.
      vec3 transmitted = vec3( 1.0 ) - envBRDF( exitDir, -faceNormal, vec3( f0 ), 0.0 );

      // Dispersion: red and blue leave at measurably different angles, so each
      // channel reads the environment somewhere slightly different. This is the
      // fire, and it is one trace rather than three.
      vec3 dirG = exitDir;
      vec3 dirR = refract( oldDir, faceNormal, ior * ( 1.0 + aberrationStrength ) );
      vec3 dirB = refract( oldDir, faceNormal, ior * ( 1.0 - aberrationStrength ) );
      if ( dot( dirR, dirR ) < EPS ) dirR = dirG;
      if ( dot( dirB, dirB ) < EPS ) dirB = dirG;

      vec3 wG = normalize( ( modelMatrix * vec4( dirG, 0.0 ) ).xyz );
      vec3 wR = normalize( ( modelMatrix * vec4( dirR, 0.0 ) ).xyz );
      vec3 wB = normalize( ( modelMatrix * vec4( dirB, 0.0 ) ).xyz );

      vec3 lit = vec3(
        sampleEnv( wR, dirPerfect ).r,
        sampleEnv( wG, dirPerfect ).g,
        sampleEnv( wB, dirPerfect ).b
      );
      outColor += lit * transmitted * atten * boost;

      dir = normalize( reflect( oldDir, faceNormal ) );
      atten *= envBRDF( dir, faceNormal, vec3( f0 ), 0.0 ) * boost;
    } else {
      // Total internal reflection: nothing escapes here, keep bouncing.
      dir = normalize( reflect( oldDir, faceNormal ) );
      if ( lastBounce ) {
        // Budget exhausted. drei drops this ray's energy entirely; give it its
        // last direction explicitly instead, which is where most of the muddy
        // grey came from.
        vec3 world = normalize( ( modelMatrix * vec4( oldDir, 0.0 ) ).xyz );
        vec3 spread = vec3( 1.0 ) - envBRDF( -oldDir, faceNormal, vec3( f0 ), 0.0 );
        outColor += sampleEnv( world, dirPerfect ) * atten * spread * boost;
      }
    }

    origin = hitPos + dir * 0.01;
    outColor = clamp( outColor, vec3( 0.0 ), vec3( 64.0 ) );
    atten = clamp( atten, vec3( 0.0 ), vec3( 1.0 ) );
  }

  return outColor;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec3 directionCamPerfect = ( projectionMatrixInverse * vec4( uv * 2.0 - 1.0, 0.0, 1.0 ) ).xyz;
  directionCamPerfect = ( viewMatrixInverse * vec4( directionCamPerfect, 0.0 ) ).xyz;
  directionCamPerfect = normalize( directionCamPerfect );

  vec3 normal = normalize( vNormal );
  vec3 viewDirection = normalize( vWorldPosition - cameraPosition );

  vec4 diffuseColor = vec4( color, opacity );
  #include <color_fragment>

  float f0 = ( ior - 1.0 ) / ( ior + 1.0 );
  f0 *= f0;

  // The surface mirror: additive and BRDF-weighted, rather than drei's lerp
  // toward pure white. A lerp cannot help but raise the floor of every grazing
  // facet, which is what crushed the stone's range.
  vec3 reflectedDirection = reflect( viewDirection, normal );
  vec3 brdfReflected = envBRDF( reflectedDirection, normal, vec3( f0 ), 0.0 );
  vec3 reflection = sampleEnv( reflectedDirection, directionCamPerfect ) * brdfReflected * fresnel * 2.0;

  vec3 refraction = tracePath( viewDirection, normal, directionCamPerfect );

  // Live Diamond Environment Intensity. Applied to the stone's own light, not
  // to a fresnel rim — same placement intent as the patch this replaces.
  vec3 combined = clamp( ( refraction + reflection ) * uDiamondEnvIntensity, vec3( 0.0 ), vec3( 16.0 ) );

  /*
   * Lift only what came back dead.
   *
   * Gated by darkness and combined with max(), so a facet that already carries
   * signal is mathematically untouched — which is the specific failure of the
   * reverted additive-environment attempt.
   */
  if ( extinctionFix > 0.5 ) {
    float lum = dot( combined, vec3( 0.299, 0.587, 0.114 ) );
    float darkBlend = smoothstep( 0.25, 0.0, lum );
    if ( darkBlend > 0.0 ) {
      vec3 offsetDir = normalize( reflectedDirection + normal * 0.3 );
      vec3 fallback =
        sampleEnv( reflectedDirection, directionCamPerfect ) * 0.5 +
        sampleEnv( normal, directionCamPerfect ) * 0.2 +
        sampleEnv( offsetDir, directionCamPerfect ) * 0.15;
      combined = mix( combined, max( combined, fallback ), darkBlend );
    }
  }

  gl_FragColor = vec4( pow( combined, vec3( gammaFactor ) ) * diffuseColor.rgb, opacity );

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Defaults carried over from the Origem calibration. */
export const GEM_TRANSPORT_DEFAULTS = {
  /** Beer-Lambert strength. Colourless stones are unaffected by construction. */
  absorptionFactor: 1,
  /** Per-bounce gain. Compensates for energy the BRDF terms remove. */
  boost: 1.45,
  /** Output shaping. Below 1 the trace is dark; this is the reference's value. */
  gammaFactor: 1.5,
  /** Soft roll-off applied to every environment read. */
  envShoulder: 2,
  /** Gain on each environment read, after the roll-off. The reference's 1.5. */
  gemEnvIntensity: 1.5,
  /** Blend of each hit normal toward a smooth one. Stops multi-bounce shatter. */
  geometryFactor: 0.15,
  /** Lift pixels that come back essentially dead. See the note in main(). */
  extinctionFix: 1,
};

type Uniforms = Record<string, THREE.IUniform>;

/** Bound whenever a stone has no smoothNormal attribute; paired with factor 0. */
const FALLBACK_NORMAL_TEXTURE = (() => {
  const texture = new THREE.DataTexture(
    new Float32Array([0, 0, 1, 0]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  texture.needsUpdate = true;
  return texture;
})();

/**
 * Drop-in for drei's `MeshRefractionMaterial`.
 *
 * The property accessors exist so `GemRefraction.tsx` can keep assigning
 * `material.bounces = …` exactly as it did — drei's `shaderMaterial()` helper
 * generates those, and this is a plain ShaderMaterial, so they are declared
 * here instead.
 */
export class GemTransportMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      vertexShader,
      fragmentShader,
      /*
       * Deliberately NOT transparent, matching drei's material.
       *
       * Setting it moves the stone into the transparent queue, which changes
       * both draw order against the setting and how it depth-tests — and a gem
       * whose alpha is 1 gains nothing from being there. An earlier revision of
       * this file set it and the centre stone rendered see-through with the
       * metal visible behind it.
       */
      uniforms: {
        envMap: { value: null },
        bounces: { value: 5 },
        ior: { value: 2.4 },
        correctMips: { value: true },
        aberrationStrength: { value: 0.01 },
        fresnel: { value: 0.6 },
        bvh: { value: new MeshBVHUniformStruct() },
        color: { value: new THREE.Color("white") },
        opacity: { value: 1 },
        resolution: { value: new THREE.Vector2() },
        uDiamondEnvIntensity: { value: 1 },
        uDiamondEnvRotation: { value: 0 },
        viewMatrixInverse: { value: new THREE.Matrix4() },
        projectionMatrixInverse: { value: new THREE.Matrix4() },
        absorptionFactor: { value: GEM_TRANSPORT_DEFAULTS.absorptionFactor },
        boost: { value: GEM_TRANSPORT_DEFAULTS.boost },
        gammaFactor: { value: GEM_TRANSPORT_DEFAULTS.gammaFactor },
        envShoulder: { value: GEM_TRANSPORT_DEFAULTS.envShoulder },
        gemEnvIntensity: { value: GEM_TRANSPORT_DEFAULTS.gemEnvIntensity },
        uGeometryFactor: { value: GEM_TRANSPORT_DEFAULTS.geometryFactor },
        // Replaced with the real per-geometry attribute texture when there is
        // one; a 1x1 stand-in keeps the sampler bound either way, which is
        // cheaper than compiling a second program for stones without it.
        uSmoothNormalMap: { value: FALLBACK_NORMAL_TEXTURE },
        extinctionFix: { value: GEM_TRANSPORT_DEFAULTS.extinctionFix },
      } satisfies Uniforms,
    });

    // Mirrors THREE.Material.opacity into the shader, which drei's
    // `shaderMaterial()` helper did for free.
    this.onBeforeRender = () => {
      const uniform = this.uniforms["opacity"];
      if (uniform) uniform.value = this.opacity;
    };
  }
}

const SCALARS = [
  "bounces",
  "ior",
  "correctMips",
  "aberrationStrength",
  "fresnel",
  "absorptionFactor",
  "boost",
  "gammaFactor",
  "envShoulder",
  "gemEnvIntensity",
  "uGeometryFactor",
  "uSmoothNormalMap",
  "extinctionFix",
  "uDiamondEnvIntensity",
  "uDiamondEnvRotation",
  "envMap",
  "bvh",
  "color",
  "resolution",
  "viewMatrixInverse",
  "projectionMatrixInverse",
] as const;

/*
 * `uniforms` is undefined while THREE.Material's own constructor runs, so every
 * accessor has to tolerate being called before the material is fully built.
 * `opacity` is deliberately absent from the list above: THREE.Material declares
 * it as a real property, and shadowing that fired this setter during
 * construction and threw.
 */
for (const key of SCALARS) {
  Object.defineProperty(GemTransportMaterial.prototype, key, {
    get(this: GemTransportMaterial) {
      return this.uniforms?.[key]?.value;
    },
    set(this: GemTransportMaterial, value: unknown) {
      const uniform = this.uniforms?.[key];
      if (uniform) uniform.value = value;
    },
  });
}

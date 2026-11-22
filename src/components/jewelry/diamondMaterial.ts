import * as THREE from "three";
import { MeshBVHUniformStruct, shaderIntersectFunction, shaderStructs } from "three-mesh-bvh";
import { gemChroma, gemTint } from "./materials";

/*
 * The diamond shader, shared by the studio viewer and the try-on.
 *
 * Written from the optics rather than patched onto drei's refraction
 * material, which follows one ray and lets ALL of it out at the first facet
 * that does not totally internally reflect. A real stone splits the light at
 * every facet it meets: some leaves (the Fresnel transmission), the rest
 * reflects back in and goes on to leave somewhere else. Following that split
 * is what fills a stone with the many small, layered reflections of
 * different greys that read as a real diamond, rather than a few large flat
 * patches.
 *
 * Per pixel:
 *
 *  1. SURFACE. The crown reflects the room with the exact dielectric Fresnel
 *     term, added on top of the light from inside: the crisp white flashes
 *     off the table.
 *  2. INSIDE. The ray refracts in and is traced against a BVH of the stone's
 *     real facets. At each internal hit the transmitted share is collected
 *     from the environment and the reflected share carries on until spent.
 *  3. FIRE. Red, green and blue are traced at their own refractive index, so
 *     colour separates inside the stone, not as a post-process fringe.
 *  4. BODY COLOUR. A coloured stone darkens with the distance light travels
 *     through it, and keeps its hue against bright highlights (see the knee
 *     and the post-tone-map tint below, the same two fixes the studio's
 *     earlier shader needed; gemAbsorption.ts explains why both are needed).
 *
 * The world-to-stone transform is built in the vertex shader by an explicit
 * adjugate, not GLSL inverse(): ANGLE's inverse() treats small determinants
 * as singular, and a stone drawn at a few hundred pixels per unit (try-on) or
 * a piece modelled in millimetres and scaled down (studio) both get there,
 * turning the stone flat grey.
 */

const VERT = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying mat3 vToWorld;
  varying mat3 vToObject;
  varying vec3 vToObjectT;

  // Exact 3×3 inverse by adjugate; no singularity threshold.
  mat3 inverse3(mat3 a) {
    vec3 c0 = cross(a[1], a[2]);
    vec3 c1 = cross(a[2], a[0]);
    vec3 c2 = cross(a[0], a[1]);
    float det = dot(a[0], c0);
    return transpose(mat3(c0, c1, c2)) / det;
  }

  void main() {
    mat4 m = modelMatrix;
    #ifdef USE_INSTANCING
      m = modelMatrix * instanceMatrix;
    #endif
    mat3 a = mat3(m);
    mat3 ai = inverse3(a);
    vToWorld = a;
    vToObject = ai;
    vToObjectT = -(ai * m[3].xyz);
    vec4 wp = m * vec4(position, 1.0);
    vWorldPosition = wp.xyz;
    vWorldNormal = normalize(transpose(ai) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const FRAG = /* glsl */ `
  precision highp isampler2D;
  precision highp usampler2D;

  #include <common>

  ${shaderStructs}
  ${shaderIntersectFunction}

  uniform BVH bvh;
  uniform sampler2D envMap;
  uniform mat3 envRotation;
  uniform float envIntensity;
  uniform float ior;
  uniform float dispersion;
  uniform float surface;
  uniform vec3 tint;
  uniform float tintChroma;
  uniform float absorbRef;
  uniform float epsilon;
  uniform float outputAlpha;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying mat3 vToWorld;
  varying mat3 vToObject;
  varying vec3 vToObjectT;

  vec3 env(vec3 worldDir) {
    return texture2D(envMap, equirectUv(envRotation * worldDir)).rgb * envIntensity;
  }

  // Exact unpolarised Fresnel reflectance, going from index n1 into n2.
  float fresnel(float cosI, float n1, float n2) {
    float eta = n1 / n2;
    float sinT2 = eta * eta * (1.0 - cosI * cosI);
    if (sinT2 >= 1.0) return 1.0;
    float cosT = sqrt(1.0 - sinT2);
    float rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
    float rp = (n2 * cosI - n1 * cosT) / (n2 * cosI + n1 * cosT);
    return 0.5 * (rs * rs + rp * rp);
  }

  // Light gathered by one ray already inside the stone, at index n.
  vec3 trace(vec3 ro, vec3 rd, float n) {
    vec3 gathered = vec3(0.0);
    float carried = 1.0;
    float travelled = 0.0;
    for (int i = 0; i < BOUNCES; i++) {
      uvec4 faceIndices = uvec4(0u);
      vec3 faceNormal = vec3(0.0, 0.0, 1.0);
      vec3 barycoord = vec3(0.0);
      float side = 1.0;
      float dist = 0.0;
      bool hit = bvhIntersectFirstHit(bvh, ro, rd, faceIndices, faceNormal, barycoord, side, dist);
      if (!hit) break;
      travelled += dist;
      vec3 p = ro + rd * dist;
      // faceNormal faces against the ray, i.e. back into the stone.
      float cosI = clamp(-dot(rd, faceNormal), 0.0, 1.0);
      float F = fresnel(cosI, n, 1.0);
      vec3 body = pow(max(tint, vec3(1e-4)), vec3(clamp(travelled / absorbRef, 0.0, 3.0)));
      if (F < 1.0) {
        vec3 out_ = refract(rd, faceNormal, n);
        gathered += carried * (1.0 - F) * body * env(normalize(vToWorld * out_));
      }
      carried *= F;
      if (carried < 0.015) return gathered;
      rd = reflect(rd, faceNormal);
      ro = p + rd * epsilon;
    }
    // Whatever is still inside after the last bounce leaves the way it is going.
    return gathered + carried * env(normalize(vToWorld * rd));
  }

  vec3 enter(vec3 V, vec3 N, float n) {
    vec3 rdW = refract(V, N, 1.0 / n);
    vec3 rd = normalize(vToObject * rdW);
    vec3 ro = vToObject * vWorldPosition + vToObjectT + rd * epsilon;
    return trace(ro, rd, n);
  }

  void main() {
    vec3 V = normalize(vWorldPosition - cameraPosition);
    vec3 N = normalize(vWorldNormal);
    if (dot(N, V) > 0.0) N = -N;
    float cosV = clamp(-dot(V, N), 0.0, 1.0);
    float Fs = fresnel(cosV, 1.0, ior);

    #ifdef DISPERSION
      vec3 inside = vec3(
        enter(V, N, ior - dispersion).r,
        enter(V, N, ior).g,
        enter(V, N, ior + dispersion).b
      );
    #else
      vec3 inside = enter(V, N, ior);
    #endif

    // A coloured stone's highlights are pulled into range so its hue survives
    // them; a colourless stone (chroma 0) is untouched.
    inside = inside / (1.0 + tintChroma * inside);

    vec3 refl = env(reflect(V, N)) * Fs * surface;
    gl_FragColor = vec4(inside * (1.0 - Fs) + refl, outputAlpha);

    #include <tonemapping_fragment>
    // Body colour once more on the bounded value, where no highlight can hide
    // it. The tint is normalised, so a white stone is multiplied by exactly 1.
    gl_FragColor.rgb *= tint;
    #include <colorspace_fragment>
  }`;

/*
 * The look, matched against the leading commercial real-time jewellery
 * viewers (their live settings: index 2.6, ±0.01 dispersion, 1.5× light on
 * the stones, ACES at exposure 1) and then set by eye.
 *
 *  - BRILLIANCE: rendered at a raised refractive index (diamond 2.417 →
 *    2.6). A screen shows a stone far smaller and dimmer than life; the extra
 *    internal reflection buys back the brilliance the eye expects. Scaled from
 *    (n - 1), so every gem keeps its place relative to the others.
 *  - FIRE: about half of the real index spread. Exaggerated fire is the tell
 *    of a cheap render; real stones are crisp white and grey with colour in
 *    occasional flashes.
 */
const IOR_BOOST = 1.13;
const MAX_RENDER_IOR = 2.9;
/**
 * The library's `aberration` (library.ts) is diamond 0.035 for a real index
 * spread of 0.044. This turns it into the ± index offset used here, at about
 * half the real spread.
 */
const ABERRATION_TO_DISPERSION = (0.044 / 0.035) * 0.25;
export const STONE_ENV_INTENSITY = 1.5;
export const DIAMOND_BOUNCES = 5;

/** A stone as the material library resolves it. */
export interface StoneOptics {
  color: string;
  ior: number;
  aberration: number;
}

export interface DiamondOptions {
  /** Shared rotation for the environment the stones see (try-on twinkle). */
  envRotation?: THREE.Matrix3;
  /**
   * Object-space length of about one stone diameter of travel, for body
   * colour. Defaults to 4, right for a unit-girdle stone.
   */
  absorbRef?: number;
  /** Ray offset in object space; ~1/2000 of a stone is safe at any scale. */
  epsilon?: number;
  /** Alpha written; the try-on marks stones with a hair under 1 for its glints. */
  outputAlpha?: number;
  bounces?: number;
}

export type DiamondMaterial = THREE.ShaderMaterial;

export function createDiamondMaterial(
  bvh: MeshBVHUniformStruct,
  envMap: THREE.Texture,
  optics: StoneOptics,
  o: DiamondOptions = {},
): DiamondMaterial {
  const dispersion = Math.max(0, optics.aberration) * ABERRATION_TO_DISPERSION;
  const defines: Record<string, string | number> = {
    BOUNCES: Math.max(1, Math.round(o.bounces ?? DIAMOND_BOUNCES)),
  };
  if (dispersion > 0) defines.DISPERSION = "";
  return new THREE.ShaderMaterial({
    uniforms: {
      bvh: { value: bvh },
      envMap: { value: envMap },
      envRotation: { value: o.envRotation ?? new THREE.Matrix3() },
      envIntensity: { value: STONE_ENV_INTENSITY },
      ior: { value: Math.min(MAX_RENDER_IOR, 1 + (optics.ior - 1) * IOR_BOOST) },
      dispersion: { value: dispersion },
      surface: { value: 1 },
      tint: { value: new THREE.Color(gemTint(optics.color)) },
      tintChroma: { value: gemChroma(optics.color) },
      absorbRef: { value: o.absorbRef ?? 4 },
      epsilon: { value: o.epsilon ?? 5e-4 },
      outputAlpha: { value: o.outputAlpha ?? 1 },
    },
    defines,
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

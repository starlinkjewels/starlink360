import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";

/*
 * Star glints: the thing that makes a diamond read as a diamond on a screen.
 *
 * In a photograph, the brightest flash off a diamond overloads the sensor and
 * the lens spreads it into a star. Every jewellery advert, every product photo
 * and every in-store look at a stone under spotlights has it, so the eye has
 * learned that a stone WITHOUT it is glass or plastic. A plain bloom spreads a
 * round haze, which reads as fog rather than fire.
 *
 * Three steps, on the linear HDR frame before tone mapping:
 *
 *  1. Extract, at quarter resolution, only what is far brighter than white.
 *     The 4×4 block is reduced with MAX, not average, so a glint one pixel
 *     wide survives the downsample instead of being diluted away.
 *  2. Streak those pixels into an eight-point star: two strong arms, two faint
 *     diagonals, with a slight spectral tint along the arms, as a real lens
 *     star shows.
 *  3. Add the stars back, raising alpha by the glint's brightness so the star
 *     also shows over the camera video, not just over the piece.
 */

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const EXTRACT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 texel;
  uniform float threshold;
  varying vec2 vUv;

  vec3 bright(vec2 uv) {
    vec4 s = texture2D(tDiffuse, uv);
    // Stones only: they write alpha a hair under 1 (STONE_ALPHA). A star off a
    // gold claw tip reads as cheap; real glints come from the stone.
    float stone = step(0.99, s.a) * step(s.a, 0.9995);
    vec3 c = s.rgb * stone;
    float l = max(c.r, max(c.g, c.b));
    // Soft knee, so a glint grows out of nothing rather than popping in.
    float k = max(l - threshold, 0.0);
    return c * (k * k / (k + threshold)) / max(l, 1e-4);
  }

  void main() {
    vec3 a = bright(vUv + texel * vec2(-1.0, -1.0));
    vec3 b = bright(vUv + texel * vec2( 1.0, -1.0));
    vec3 c = bright(vUv + texel * vec2(-1.0,  1.0));
    vec3 d = bright(vUv + texel * vec2( 1.0,  1.0));
    /*
     * Part peak, part area. Peak alone keeps a one-pixel glint alive but gives
     * every melee stone in a halo the same star as the centre stone, which
     * reads as a sea of stickers. Weighting in the area makes a star's size
     * follow the size of the flash, as it does through a real lens.
     */
    vec3 peak = max(max(a, b), max(c, d));
    vec3 area = (a + b + c + d) * 0.25;
    gl_FragColor = vec4(mix(area, peak, 0.35), 1.0);
  }`;

const STREAK = /* glsl */ `
  uniform sampler2D tBright;
  uniform vec2 texel;
  uniform float angle;
  uniform float reach;
  varying vec2 vUv;

  const int TAPS = 14;

  vec3 spectrum(float t) {
    return clamp(abs(fract(t + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  }

  vec3 arm(float a, float weight) {
    vec2 dir = vec2(cos(a), sin(a)) * texel * reach;
    vec3 sum = vec3(0.0);
    for (int i = 1; i <= TAPS; i++) {
      float f = float(i);
      float w = pow(0.78, f) * weight;
      vec3 tint = mix(vec3(1.0), spectrum(f / float(TAPS) * 0.8), 0.3);
      sum += (texture2D(tBright, vUv + dir * f).rgb + texture2D(tBright, vUv - dir * f).rgb) * w * tint;
    }
    return sum;
  }

  void main() {
    vec3 core = texture2D(tBright, vUv).rgb;
    vec3 star = core * 1.4;
    star += arm(angle, 1.0);
    star += arm(angle + 1.5707963, 1.0);
    star += arm(angle + 0.7853982, 0.22);
    star += arm(angle - 0.7853982, 0.22);
    // A little round halo around the core, as in any real optic.
    vec3 halo = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982;
      halo += texture2D(tBright, vUv + vec2(cos(a), sin(a)) * texel * 2.0).rgb;
    }
    star += halo * 0.12;
    gl_FragColor = vec4(star, 1.0);
  }`;

const COMPOSITE = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tGlint;
  uniform float strength;
  varying vec2 vUv;

  void main() {
    vec4 base = texture2D(tDiffuse, vUv);
    vec3 g = texture2D(tGlint, vUv).rgb * strength;
    float ga = clamp(max(g.r, max(g.g, g.b)), 0.0, 1.0);
    // Undo the stone marker: stones are opaque.
    float a = base.a > 0.99 ? 1.0 : base.a;
    gl_FragColor = vec4(base.rgb + g, max(a, ga));
  }`;

export interface GlintSettings {
  /** Linear brightness a pixel must exceed to throw a star. White is 1. */
  threshold: number;
  strength: number;
  /** Arm length, in quarter-resolution pixels per tap. */
  reach: number;
  /** Rotation of the star, radians. A real star filter sits off-axis. */
  angle: number;
}

/*
 * Tuned against the studio light tent, whose softboxes put stone pixels at
 * 4–7× white and whose pinpoint sources at 14–26×. The threshold sits between
 * the two, so a star marks a pinpoint caught by a facet, which is what a
 * glint is, and the broad panel reflections stay as plain brilliance.
 */
export const DEFAULT_GLINTS: GlintSettings = {
  threshold: 8,
  strength: 0.42,
  reach: 1.25,
  angle: 0.33,
};

/**
 * Alpha written by stone pixels (see jewelry.ts). Half-float holds it exactly
 * apart from 1.0, and multisample edges against the background land well
 * below it, so it works as a stones-only mask at no cost.
 */
export const STONE_ALPHA = 0.998;

export class GlintPass extends Pass {
  private bright: THREE.WebGLRenderTarget;
  private streak: THREE.WebGLRenderTarget;
  private extractQuad: FullScreenQuad;
  private streakQuad: FullScreenQuad;
  private compositeQuad: FullScreenQuad;
  private extractMat: THREE.ShaderMaterial;
  private streakMat: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;

  constructor(settings: GlintSettings = DEFAULT_GLINTS) {
    super();
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.bright = new THREE.WebGLRenderTarget(1, 1, opts);
    this.streak = new THREE.WebGLRenderTarget(1, 1, opts);

    this.extractMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        texel: { value: new THREE.Vector2() },
        threshold: { value: settings.threshold },
      },
      vertexShader: VERT,
      fragmentShader: EXTRACT,
      depthTest: false,
      depthWrite: false,
    });
    this.streakMat = new THREE.ShaderMaterial({
      uniforms: {
        tBright: { value: this.bright.texture },
        texel: { value: new THREE.Vector2() },
        angle: { value: settings.angle },
        reach: { value: settings.reach },
      },
      vertexShader: VERT,
      fragmentShader: STREAK,
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tGlint: { value: this.streak.texture },
        strength: { value: settings.strength },
      },
      vertexShader: VERT,
      fragmentShader: COMPOSITE,
      depthTest: false,
      depthWrite: false,
    });
    this.extractQuad = new FullScreenQuad(this.extractMat);
    this.streakQuad = new FullScreenQuad(this.streakMat);
    this.compositeQuad = new FullScreenQuad(this.compositeMat);
  }

  set strength(v: number) {
    this.compositeMat.uniforms.strength.value = v;
  }

  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width / 4));
    const h = Math.max(1, Math.round(height / 4));
    this.bright.setSize(w, h);
    this.streak.setSize(w, h);
    (this.extractMat.uniforms.texel.value as THREE.Vector2).set(1 / width, 1 / height);
    (this.streakMat.uniforms.texel.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;

    this.extractMat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.bright);
    this.extractQuad.render(renderer);

    renderer.setRenderTarget(this.streak);
    this.streakQuad.render(renderer);

    this.compositeMat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.compositeQuad.render(renderer);

    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.bright.dispose();
    this.streak.dispose();
    this.extractMat.dispose();
    this.streakMat.dispose();
    this.compositeMat.dispose();
    this.extractQuad.dispose();
    this.streakQuad.dispose();
    this.compositeQuad.dispose();
  }
}

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { SSRPass } from "three/examples/jsm/postprocessing/SSRPass.js";

/*
 * Bloom, and the two traps in adding it.
 *
 * 1. COLOUR SPACE. A composed frame does not go through the renderer's own
 *    tone mapping and sRGB conversion — those happen when a material writes to
 *    the default framebuffer, which a composer bypasses. Chain RenderPass ->
 *    UnrealBloomPass and stop there and the whole render comes out washed out
 *    and flat, in a way that looks like a lighting mistake rather than a
 *    pipeline one. `OutputPass` is what applies both, and it must be last.
 *
 * 2. THE EXPORT PATH. Exports call `gl.render` directly, bypassing the render
 *    loop entirely. Left alone, bloom would appear on screen and be missing
 *    from every download. So one function renders a frame and both paths call
 *    it — the same rule this codebase has needed in every phase so far.
 *
 * When bloom is off no composer exists at all, and both paths fall back to a
 * plain `gl.render`. That is the safety property: the feature cannot cost or
 * change anything until it is switched on.
 */

export interface BloomSettings {
  enabled: boolean;
  /**
   * Buffer the bloom is computed in, independently of the render size.
   *
   * Bloom is a blur, and a blur does not need full resolution — halving both
   * axes quarters the work and is close to invisible, which is the cheapest
   * quality dial in the whole pipeline. Zero means "follow the renderer".
   */
  resolutionX: number;
  resolutionY: number;
  /** How much light the effect adds. */
  strength: number;
  /** How far it spreads. */
  radius: number;
  /**
   * Brightness a pixel must exceed to glow at all.
   *
   * The important dial. Diamonds already reach far above 1.0 where they catch a
   * light, so a threshold near 1 makes only the genuine sparkle bloom. Drop it
   * toward 0 and the metal starts glowing too, which reads as fog.
   */
  threshold: number;
}

/** Off, so nothing changes and nothing is paid for until asked. */
export const DEFAULT_BLOOM: BloomSettings = {
  enabled: false,
  strength: 0.35,
  radius: 0.4,
  threshold: 0.95,
  // Zero is "match the renderer", which is what it always did.
  resolutionX: 0,
  resolutionY: 0,
};

/**
 * Depth of field.
 *
 * A real macro lens has millimetres of focus, and the shallow depth is most of
 * why a product photograph looks like a photograph. `focus` is a distance from
 * the camera in the piece's own units, so it does not need re-tuning per model.
 */
export interface DofSettings {
  enabled: boolean;
  focus: number;
  /** Wider aperture, shallower focus. */
  aperture: number;
  /** Ceiling on the blur, so a badly set focus cannot dissolve the frame. */
  maxBlur: number;
}

export const DEFAULT_DOF: DofSettings = {
  enabled: false,
  focus: 3,
  aperture: 0.0008,
  maxBlur: 0.006,
};

/**
 * Screen-space reflections.
 *
 * Honest warning, since this is the one that will disappoint: SSR can only
 * reflect what is ON SCREEN, and it reads the depth buffer — which transmissive
 * materials do not write in any useful way. On a piece that is mostly diamonds
 * the stones will reflect wrongly or not at all. It is here because a product
 * competing on a feature list needs it, and it is off by default with the
 * caveat stated rather than hidden.
 */
export interface SsrSettings {
  enabled: boolean;
  /** How thick a surface is assumed to be when a ray passes behind it. */
  thickness: number;
  maxDistance: number;
  opacity: number;
  /** Buffer size. The expensive pair. */
  width: number;
  height: number;
  blur: boolean;
  /** Lets reflections reflect each other. Doubles the pass. */
  bouncing: boolean;
  /** Grazing angles reflect more, which is how real surfaces behave. */
  fresnel: boolean;
  /** Reflections weaken with distance rather than staying full strength. */
  distanceAttenuation: boolean;
}

export const DEFAULT_SSR: SsrSettings = {
  enabled: false,
  thickness: 0.018,
  maxDistance: 0.1,
  opacity: 0.5,
  width: 0,
  height: 0,
  blur: true,
  bouncing: false,
  fresnel: true,
  distanceAttenuation: true,
};

/** Everything the composer draws, in one object. */
export interface PostSettings {
  bloom: BloomSettings;
  dof: DofSettings;
  ssr: SsrSettings;
}

export const DEFAULT_POST: PostSettings = {
  bloom: DEFAULT_BLOOM,
  dof: DEFAULT_DOF,
  ssr: DEFAULT_SSR,
};

/**
 * What to say before someone turns these on.
 *
 * Both of these cost real frame time and one of them is unreliable on exactly
 * the material this product is mostly made of. Saying so up front is the
 * difference between a considered choice and a bug report.
 */
export function postWarning(post: PostSettings): string | null {
  if (post.ssr.enabled) {
    return "Screen-space reflections can only reflect what is on screen, and they read a depth buffer that transmissive materials do not write usefully — so the stones will reflect wrongly or not at all. It also adds a full extra pass.";
  }
  if (post.dof.enabled && post.bloom.enabled) {
    return "Depth of field and bloom are two more full-screen passes on top of the render. Expect roughly half the frame rate without a dedicated GPU.";
  }
  if (post.dof.enabled) {
    return "Depth of field blurs by depth, so a focus set past the piece softens all of it. The distance is in the piece's own units — around 3 is on the subject.";
  }
  return null;
}

export interface SceneRenderer {
  /** Draws one frame at the current renderer size. */
  render(): void;
  /** Follows the renderer through an export's resize. */
  setSize(width: number, height: number): void;
  update(post: PostSettings): void;
  dispose(): void;
}

/**
 * Builds the composer for a given renderer, scene and camera.
 *
 * Half float, because the whole point is that highlights carry values above 1:
 * an 8-bit buffer clamps them to white before the bright-pass ever sees them,
 * and the bloom then keys off nothing.
 */
export function createSceneRenderer(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  post: PostSettings,
): SceneRenderer {
  const size = gl.getSize(new THREE.Vector2());

  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    // The canvas is transparent and the backdrop is painted behind it, so alpha
    // has to survive the whole chain or exports lose their cut-out.
    format: THREE.RGBAFormat,
    samples: 4,
  });

  const composer = new EffectComposer(gl, target);
  /** What the composer was last told; see `render` for why it is watched. */
  let appliedRatio = gl.getPixelRatio();
  composer.addPass(new RenderPass(scene, camera));

  /*
   * The order is not a preference.
   *
   * SSR replaces the image with a reflected one, so it has to see the plain
   * render and goes first. Bloom keys off brightness, so it must see those
   * reflections. Depth of field blurs whatever is finally there, so it goes
   * after both — blurring before bloom would make the bloom key off a blurred
   * image and smear the sparkle instead of spreading it.
   */
  let ssr: SSRPass | null = null;
  if (post.ssr.enabled) {
    ssr = new SSRPass({
      renderer: gl,
      scene,
      camera: camera as THREE.PerspectiveCamera,
      width: post.ssr.width || size.x,
      height: post.ssr.height || size.y,
      // Everything in the scene rather than a hand-picked list.
      selects: null,
      isBouncing: post.ssr.bouncing,
      // Declared required by the typings but genuinely optional: the pass only
      // uses it to reflect a MeshReflectorMaterial ground into itself, and ours
      // is not always present.
      groundReflector: null,
    });
    composer.addPass(ssr);
  }

  let bloom: UnrealBloomPass | null = null;
  if (post.bloom.enabled && post.bloom.strength > 0) {
    bloom = new UnrealBloomPass(
      new THREE.Vector2(post.bloom.resolutionX || size.x, post.bloom.resolutionY || size.y),
      post.bloom.strength,
      post.bloom.radius,
      post.bloom.threshold,
    );
    composer.addPass(bloom);
  }

  let dof: BokehPass | null = null;
  if (post.dof.enabled) {
    dof = new BokehPass(scene, camera, {
      focus: post.dof.focus,
      aperture: post.dof.aperture,
      maxblur: post.dof.maxBlur,
    });
    composer.addPass(dof);
  }

  // Last, always: tone mapping and sRGB conversion for the composed frame.
  composer.addPass(new OutputPass());

  return {
    render() {
      /*
       * The composer captures the pixel ratio when it is built and never looks
       * again, so every target it owns stays the size it was born at. Dropping
       * the renderer's ratio to keep the frame rate up therefore shrank the
       * scene pass and nothing else — the expensive half, SSR and the bright
       * pass, carried on at full resolution and the frame rate did not move.
       *
       * Checked here rather than pushed from outside because the ratio has more
       * than one owner: an export sets it to 1 and restores it afterwards, and
       * the adaptive loop moves it while the pointer is down. Reading it each
       * frame means the composer follows whoever last set it, with no ordering
       * to get wrong.
       */
      const ratio = gl.getPixelRatio();
      if (ratio !== appliedRatio) {
        appliedRatio = ratio;
        composer.setPixelRatio(ratio);
      }
      composer.render();
    },
    setSize(width, height) {
      composer.setSize(width, height);
      // Bloom keeps its own buffer size when one is set, so a resize must not
      // silently drag it back to the render resolution.
      bloom?.setSize(post.bloom.resolutionX || width, post.bloom.resolutionY || height);
      ssr?.setSize(post.ssr.width || width, post.ssr.height || height);
    },
    update(next) {
      if (bloom) {
        bloom.strength = next.bloom.strength;
        bloom.radius = next.bloom.radius;
        bloom.threshold = next.bloom.threshold;
      }
      if (dof) {
        /*
         * Bokeh copies its constructor params into uniforms, so assigning the
         * fields back does nothing — the uniforms are the live values.
         */
        const u = dof.uniforms as unknown as Record<string, { value: number }>;
        u.focus.value = next.dof.focus;
        u.aperture.value = next.dof.aperture;
        u.maxblur.value = next.dof.maxBlur;
      }
      if (ssr) {
        ssr.thickness = next.ssr.thickness;
        ssr.maxDistance = next.ssr.maxDistance;
        ssr.opacity = next.ssr.opacity;
        ssr.blur = next.ssr.blur;
        ssr.fresnel = next.ssr.fresnel;
        ssr.distanceAttenuation = next.ssr.distanceAttenuation;
        /*
         * Not "bouncing": it is read once at construction and decides which
         * render targets exist, so changing it needs the composer rebuilt.
         * `composerKey` is what tells the caller when that is necessary.
         */
      }
    },
    dispose() {
      ssr?.dispose();
      composer.dispose();
      target.dispose();
    },
  };
}

/**
 * Changes that need the composer rebuilt rather than updated.
 *
 * Passes are constructed with some values baked in — which passes exist at all,
 * SSR's bouncing targets, bloom's buffer size. Updating those in place silently
 * does nothing, which is the failure where a control moves and the render does
 * not. The caller rebuilds when this string changes.
 */
export function composerKey(post: PostSettings): string {
  return [
    post.bloom.enabled && post.bloom.strength > 0 ? 1 : 0,
    post.bloom.resolutionX,
    post.bloom.resolutionY,
    post.dof.enabled ? 1 : 0,
    post.ssr.enabled ? 1 : 0,
    post.ssr.bouncing ? 1 : 0,
    post.ssr.width,
    post.ssr.height,
  ].join("|");
}

/**
 * Whether a composer should exist at all.
 *
 * Separate from the settings so the render path has one thing to ask, and the
 * test has one thing to assert.
 */
export function usesComposer(post: PostSettings): boolean {
  return (post.bloom.enabled && post.bloom.strength > 0) || post.dof.enabled || post.ssr.enabled;
}

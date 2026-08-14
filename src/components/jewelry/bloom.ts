import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
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

/*
 * On, because on a jewellery viewer this is not an effect — it is the product.
 *
 * It defaulted to off so that nothing changed and nothing was paid for until
 * asked, which was the right instinct for an optional flourish and the wrong
 * one here. A diamond in a photograph blows out the sensor around each flash,
 * and that halo is most of what makes the photograph read as real. Without it
 * a stone renders as a small grey dot, which is exactly what a client compared
 * against a competitor and called an obvious render.
 *
 * Nobody was ever going to find this in a panel. The threshold does the work
 * of keeping it honest: at 0.95 only pixels already brighter than white glow,
 * so the stones bloom and the metal does not turn to fog.
 */
export const DEFAULT_BLOOM: BloomSettings = {
  enabled: true,
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

/**
 * The camera, not the scene.
 *
 * Everything else in this file is physically correct light arriving at a lens.
 * This is what happens after that: a lens bends colour apart slightly toward
 * the frame edge, falls off in brightness at the corners, and lands on a
 * sensor that is never perfectly quiet. A render with none of that is not
 * wrong, exactly — it is a photograph of nothing, which is precisely the
 * "obviously CG" complaint. Real product photography carries a small amount
 * of all three even in a clean studio shot; their absence reads as synthetic
 * regardless of how correct the optics underneath are.
 *
 * On by default, at the studio-shot end of subtle rather than the toy-camera
 * end of obvious: enough that a frame stops looking printed, never enough
 * that someone notices the effect before the piece.
 */
export interface FilmSettings {
  enabled: boolean;
  /** Sensor noise. 0 is a mathematically clean image, which no camera makes. */
  grain: number;
  /** Corner falloff, as a lens has. 0 is no darkening at all. */
  vignette: number;
  /** Lateral colour fringing toward the frame edge. Separate from a gem's own
   *  internal dispersion — this is the lens, not the stone. */
  aberration: number;
}

export const DEFAULT_FILM: FilmSettings = {
  enabled: true,
  grain: 0.035,
  vignette: 0.35,
  aberration: 0.15,
};

/**
 * Highlight recovery.
 *
 * A diamond's brightest facet and its second-brightest facet can both be many
 * times over white before tone mapping ever sees them — the light tent's hard
 * sources go up to intensity 26 — and ACES's own shoulder, however good, still
 * has a point past which everything above it reads as the same flat white. A
 * real diamond photograph does not have that flatness: two flashes at
 * different intensities look different, which is most of what "sparkle" is
 * as opposed to "glow".
 *
 * This runs BEFORE tone mapping, in the same linear HDR space bloom and depth
 * of field already work in — unlike Film below, this is not what a camera
 * does to a finished photograph, it is compressing light that has not been
 * turned into a photograph yet. Bloom must still run first: it decides what
 * glows from the same uncompressed brightness a real lens would see, and
 * compressing before that would starve it.
 *
 * There is a real ceiling here that no amount of strength removes: this is
 * an SDR canvas, 256 shades per channel, and two facets ten and forty times
 * over white are never going to land far apart in an 8-bit output — there is
 * nowhere for "far apart" to mean. What this buys is the difference between
 * "identical" and "close but distinguishable", worked out numerically against
 * this renderer's own ACES curve rather than guessed: 0.5 (the first value
 * tried) turned out to move those two peaks from 255/255 to only 253/254 —
 * invisible. 2.0 moves them to 248/250, which reads as two different flashes
 * rather than one shape. Actual HDR display output (wide-gamut, 10-bit,
 * shown on hardware that supports it) is a different and much larger project
 * than a tone-mapping constant; this is the honest version of that ask on an
 * ordinary screen.
 */
export interface HighlightSettings {
  enabled: boolean;
  /** 0 leaves everything above white to tone mapping alone. Higher values
   *  compress a wider range of highlight brightness into visibly different
   *  shades instead of one flat white. */
  strength: number;
}

export const DEFAULT_HIGHLIGHTS: HighlightSettings = {
  enabled: true,
  strength: 2,
};

/** Everything the composer draws, in one object. */
export interface PostSettings {
  bloom: BloomSettings;
  dof: DofSettings;
  ssr: SsrSettings;
  film: FilmSettings;
  highlights: HighlightSettings;
}

export const DEFAULT_POST: PostSettings = {
  bloom: DEFAULT_BLOOM,
  dof: DEFAULT_DOF,
  ssr: DEFAULT_SSR,
  film: DEFAULT_FILM,
  highlights: DEFAULT_HIGHLIGHTS,
};

/**
 * Compresses whatever is already brighter than white, logarithmically rather
 * than linearly — a facet ten times over gets pulled in far more than one
 * twice over, which is what keeps them looking different instead of both
 * saturating to the same value a little sooner.
 *
 * Below 1.0 (anything not already blown) this is the identity: midtones and
 * shadows are untouched, which is the difference between this and lowering
 * exposure — exposure dims the whole picture to buy the highlights headroom,
 * this only ever touches pixels already past white.
 */
const HighlightShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: DEFAULT_HIGHLIGHTS.strength },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float peak = max(c.r, max(c.g, c.b));
      if (peak > 1.0 && strength > 0.0001) {
        float excess = peak - 1.0;
        float compressed = 1.0 + log(1.0 + excess * strength) / strength;
        c.rgb *= compressed / peak;
      }
      gl_FragColor = c;
    }
  `,
};

/**
 * Grain, vignette and lens aberration in one pass, because they are all the
 * same kind of thing — a cheap look-up next to the render itself — and three
 * separate passes would be three separate full-screen texture reads to do
 * work this shader does in one.
 *
 * Runs after `OutputPass`, deliberately: these are what happens to a frame
 * AFTER it leaves the sensor as a viewable image, not more light transport,
 * so they belong in display space (already tone-mapped and sRGB-encoded)
 * rather than the linear HDR space every earlier pass works in.
 */
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    vignette: { value: DEFAULT_FILM.vignette },
    aberration: { value: DEFAULT_FILM.aberration },
    grain: { value: DEFAULT_FILM.grain },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform float aberration;
    uniform float grain;
    uniform float time;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float dist = length(centered);
      vec4 base = texture2D(tDiffuse, vUv);

      // Lens chromatic aberration: red and blue shift outward from centre by
      // an amount that grows toward the edge, as a real lens element does.
      vec2 dir = dist > 0.0001 ? centered / dist : vec2(0.0);
      float shift = aberration * 0.006 * dist * dist;
      float r = texture2D(tDiffuse, vUv - dir * shift).r;
      float b = texture2D(tDiffuse, vUv + dir * shift).b;
      vec3 color = vec3(r, base.g, b);

      // Vignette: natural corner falloff, not a lighting choice — so it is
      // multiplicative on the finished image rather than a light in the scene.
      float fall = 1.0 - smoothstep(0.28, 0.75, dist);
      color *= mix(1.0, fall, vignette);

      // Grain: sensor noise, re-rolled per frame so it reads as noise rather
      // than a texture printed on the glass.
      float noise = hash(vUv * vec2(1600.0, 900.0) + time) - 0.5;
      color += noise * grain * 0.09;

      gl_FragColor = vec4(color, base.a);
    }
  `,
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

  // Still linear HDR here — see HighlightShader for why this runs after
  // bloom (which needs the uncompressed brightness) but before tone mapping
  // (which is what would otherwise flatten it).
  let highlights: ShaderPass | null = null;
  if (post.highlights.enabled) {
    highlights = new ShaderPass(HighlightShader);
    highlights.uniforms.strength.value = post.highlights.strength;
    composer.addPass(highlights);
  }

  // Tone mapping and sRGB conversion for the composed frame.
  composer.addPass(new OutputPass());

  // Last of all: the camera, not the scene — see FilmShader.
  let film: ShaderPass | null = null;
  let filmFrame = 0;
  if (post.film.enabled) {
    film = new ShaderPass(FilmShader);
    film.uniforms.vignette.value = post.film.vignette;
    film.uniforms.aberration.value = post.film.aberration;
    film.uniforms.grain.value = post.film.grain;
    composer.addPass(film);
  }

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
      if (film) film.uniforms.time.value = filmFrame++ * 0.033;
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
      if (film) {
        film.uniforms.vignette.value = next.film.vignette;
        film.uniforms.aberration.value = next.film.aberration;
        film.uniforms.grain.value = next.film.grain;
      }
      if (highlights) {
        highlights.uniforms.strength.value = next.highlights.strength;
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
    post.film.enabled ? 1 : 0,
    post.highlights.enabled ? 1 : 0,
  ].join("|");
}

/**
 * Whether a composer should exist at all.
 *
 * Separate from the settings so the render path has one thing to ask, and the
 * test has one thing to assert.
 */
export function usesComposer(post: PostSettings): boolean {
  return (
    (post.bloom.enabled && post.bloom.strength > 0) ||
    post.dof.enabled ||
    post.ssr.enabled ||
    post.film.enabled ||
    post.highlights.enabled
  );
}

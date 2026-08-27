import { useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshBVH, MeshBVHUniformStruct, SAH } from "three-mesh-bvh";
import { parseId } from "./selection";
import { planRuns, runMaterials, runSlots, drawableCount } from "./plan";
import { MeshRefractionMaterial } from "@react-three/drei/materials/MeshRefractionMaterial";
import { PATCH_ID, withPathAbsorption } from "./gemAbsorption";
import { ENV_INTENSITY_PATCH_ID, withEnvIntensity } from "./diamondEnvIntensity";
import { ENV_ROTATION_PATCH_ID, withEnvRotation } from "./diamondEnvRotation";
import { ENV_RESPONSE_PATCH_ID, withEnvResponse } from "./diamondEnvResponse";
import { HDR_KNEE_PATCH_ID, withHdrKnee } from "./gemHdrKnee";
import { gemFresnel, gemTint } from "./materials";
import { DIAMOND_ABERRATION } from "./library";
import { DEFAULT_DIAMOND_OPTICS, type DiamondOpticsSettings } from "./diamondOptics";

/*
 * A real diamond, rather than a transmissive approximation of one.
 *
 * MeshPhysicalMaterial refracts exactly once, against a screen-space buffer of
 * whatever was already drawn behind the stone. On a set piece that is the metal
 * underneath, so every stone takes the colour of its setting and no amount of
 * tuning gets past it: at transmission 1.0 the stones read grey, and lowering
 * it far enough to whiten them turns them milky. Both were dead ends.
 *
 * A diamond looks the way it does because light enters, bounces several times
 * off the inside of the pavilion by total internal reflection, and leaves
 * somewhere else entirely. This material traces those bounces for real, against
 * a BVH of the stone's own triangles, and samples the environment cube map
 * rather than the screen — so it is also independent of how many pixels a stone
 * covers, which is what makes pave work.
 *
 * Two things this depends on, both learned the hard way:
 *
 *  - Stones must be wound consistently. Rhino does not guarantee it, so
 *    rhinoDecode normalises winding per solid first; without that step roughly
 *    half the stones render inside-out and look upside down in their settings.
 *  - Do NOT feed it Rhino's own normals in place of the per-triangle normals
 *    from facetGeometry. That was tried and rendered most stones flat white.
 */

/** Refractive index of diamond. Glass is ~1.5, cubic zirconia ~2.15. */
const DIAMOND_IOR = 2.417;

/**
 * Stone colour, read back out of the mesh name.
 *
 * rhinoDecode groups stones by their Rhino render material and encodes the
 * colour into the name as `gem-rrggbb`, so a piece set with diamond and ruby
 * arrives as two meshes and each gets its own tint here. Anything without a
 * colour suffix falls back to colourless.
 */
function stoneColor(name: string): THREE.Color {
  const match = /gem-([0-9a-f]{6})/i.exec(name);
  if (!match) return new THREE.Color("#ffffff");
  const c = new THREE.Color(`#${match[1]}`);
  /*
   * Second line of defence against a black stone. The decoder already treats a
   * near-black material as unset, but a GLB authored elsewhere can still carry
   * one, and this material multiplies the refraction — so black in means a
   * black gem out, which is never a real stone.
   */
  return Math.max(c.r, c.g, c.b) < 0.09 ? new THREE.Color("#ffffff") : c;
}
/** What the library resolves a chosen stone down to, for the shader. */
export interface GemSpec {
  color: string;
  ior: number;
  aberration: number;
  transmission: number;
  /*
   * Opaque-only — read solely by the `transmission < 0.5` branch below, which
   * builds a `MeshPhysicalMaterial` rather than tracing. Optional so every
   * transparent stone's spec is unaffected; defaults exactly match what that
   * branch hardcoded before these existed (onyx and black diamond render
   * bit-identically to before unless a preset or patch sets one of these).
   */
  metalness?: number;
  roughness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  /**
   * Two different renderer properties share this one name, chosen by which
   * branch below a gem actually renders through:
   *  - Opaque (Pearl/onyx): `MeshPhysicalMaterial`'s own dielectric
   *    reflectance. Undefined falls back to three's own default, 0.5.
   *  - Transparent (traced): overrides `diamondOptics.fresnelScale` for this
   *    one gem, through the exact same `gemFresnel` formula and the exact
   *    same `material.fresnel` uniform every other gem already uses.
   *    Undefined leaves the global scale in effect, exactly as before.
   */
  reflectivity?: number;
  /**
   * Transparent gems only. Scales the path length `gemAbsorption.ts` is
   * measured against — see `resolveGem` in library.ts, which is where this
   * is actually computed and clamped. Always a real number once resolved;
   * optional here only so a `GemOptics` built before this field existed
   * still type-checks.
   */
  absorptionFactor?: number;
}

export interface GemOptics {
  ior: number;
  aberration: number;
  /**
   * Below 0.5 the stone stops being traced and renders as a polished solid.
   * Absent means fully transmissive, which is what every stone was before.
   */
  transmission?: number;
  /** Opaque-only — see `GemSpec`. */
  metalness?: number;
  roughness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  /**
   * Two different renderer properties share this one name, chosen by which
   * branch below a gem actually renders through:
   *  - Opaque (Pearl/onyx): `MeshPhysicalMaterial`'s own dielectric
   *    reflectance. Undefined falls back to three's own default, 0.5.
   *  - Transparent (traced): overrides `diamondOptics.fresnelScale` for this
   *    one gem, through the exact same `gemFresnel` formula and the exact
   *    same `material.fresnel` uniform every other gem already uses.
   *    Undefined leaves the global scale in effect, exactly as before.
   */
  reflectivity?: number;
  /**
   * Transparent gems only. Scales the path length `gemAbsorption.ts` is
   * measured against — see `resolveGem` in library.ts, which is where this
   * is actually computed and clamped. Always a real number once resolved;
   * optional here only so a `GemOptics` built before this field existed
   * still type-checks.
   */
  absorptionFactor?: number;
}

/** The stone-group id a mesh belongs to, or "" for an untagged one. */
function stoneId(mesh: THREE.Mesh): string {
  return (mesh.userData?.stone as { id?: string } | undefined)?.id ?? "";
}

/**
 * Splits the ray per wavelength — this is the fire. Anchored on `library.ts`'s
 * diamond aberration, so an untraced stone (one with no library/override
 * optics at all) can't drift out of sync with the catalogue's own diamond
 * entry.
 */
const ABERRATION = DIAMOND_ABERRATION;

/*
 * Bounces and fresnel scale used to be fixed constants here (3, later 5, and
 * 1.0 respectively). They're global shader tuning now — `diamondOptics`,
 * from `diamondOptics.ts` — because they're properties of the approximation
 * itself, not of any one gem, and the premium diamond render pass needed
 * both live-tunable from a debug panel.
 */

/**
 * The shader reads the environment through three's CubeUV packing, so it needs
 * the mip layout of the specific map as compile-time constants. Mirrors drei's
 * own calculation, but tolerates a texture that has no `image` rather than
 * throwing.
 *
 * `fastChroma` selects drei's cheap per-channel dispersion approximation
 * instead of tracing red/blue separately — a compile-time `#define`, not a
 * uniform, so it must be baked in here rather than set on the material later.
 */
function envDefines(envMap: THREE.Texture, fastChroma: boolean): Record<string, string> {
  const isCube = (envMap as THREE.CubeTexture).isCubeTexture === true;
  const image = envMap.image as { width?: number }[] & { width?: number };
  const width = (isCube ? image?.[0]?.width : image?.width) ?? 1024;

  const lodMax = Math.floor(Math.log2(width / 4));
  const cubeSize = Math.pow(2, lodMax);
  const texelWidth = 3 * Math.max(cubeSize, 16 * 7);
  const texelHeight = 4 * cubeSize;

  const defines: Record<string, string> = {
    CUBEUV_TEXEL_WIDTH: `${1 / texelWidth}`,
    CUBEUV_TEXEL_HEIGHT: `${1 / texelHeight}`,
    CUBEUV_MAX_MIP: `${lodMax}.0`,
    CHROMATIC_ABERRATIONS: "",
  };
  if (fastChroma) defines.FAST_CHROMA = "";
  if (isCube) defines.ENVMAP_TYPE_CUBEM = "";
  return defines;
}

/**
 * Geometry to hand MeshBVH, which must never be the geometry we draw.
 *
 * Building a BVH REORDERS the index buffer — that is how the tree groups
 * triangles into spatially coherent nodes. On an indexed geometry
 * `toNonIndexed()` already returns a fresh copy, so the original is safe. On a
 * NON-indexed one, three-mesh-bvh creates an index on whatever it is given and
 * then reorders that, so passing the render geometry directly rewrites the
 * triangle order underneath us.
 *
 * Stones are non-indexed — faceting de-indexes them for flat shading — so that
 * is exactly the path this took. The damage is quiet and specific: the solid
 * offsets in `userData.solids` still describe the ORIGINAL order, the element
 * count is unchanged so nothing looks wrong, but every draw run now points at a
 * spatially clustered set of triangles instead of one stone. Painting a stone
 * coloured a blob spanning it and its neighbour, right where the click landed.
 *
 * A wrapper sharing the position attribute is enough. MeshBVH reorders the
 * index it builds, never the vertex data, so the buffer can be shared and only
 * the throwaway index is rewritten.
 */
function bvhSource(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geo.index) return geo.toNonIndexed();
  const shared = new THREE.BufferGeometry();
  shared.setAttribute("position", geo.getAttribute("position"));
  return shared;
}

interface RefractionMaterialLike extends THREE.ShaderMaterial {
  envMap: THREE.Texture;
  bounces: number;
  ior: number;
  fresnel: number;
  aberrationStrength: number;
  color: THREE.Color;
  resolution: THREE.Vector2;
  bvh: MeshBVHUniformStruct;
  viewMatrixInverse: THREE.Matrix4;
  projectionMatrixInverse: THREE.Matrix4;
}

/**
 * Swaps the refraction material onto stones already present in the scene.
 *
 * Done imperatively so the loaded hierarchy is left exactly as it is — the
 * alternative is lifting every stone out into JSX and re-deriving its world
 * transform, which risks the framing and recentering for no benefit.
 */
export function GemRefraction({
  meshes,
  envMap,
  overrides,
  optics,
  diamondOptics = DEFAULT_DIAMOND_OPTICS,
  envIntensity = 1,
  envRotation = 0,
}: {
  meshes: THREE.Mesh[];
  envMap: THREE.Texture;
  /**
   * Colour chosen in the picker, by stone-group id. Absent means the group
   * keeps whatever the file specified.
   */
  overrides?: Record<string, string>;
  /**
   * Per-stone optics from the material library, by stone-group id.
   *
   * Until now every stone in every piece was traced at diamond's 2.417 and
   * diamond's dispersion, so an emerald was a diamond that happened to be
   * green. These are the published constants for the chosen stone, which is
   * what makes moissanite throw more fire than diamond rather than the same.
   */
  optics?: Record<string, GemOptics>;
  /** Global shader tuning — see `diamondOptics.ts`. */
  diamondOptics?: DiamondOpticsSettings;
  /**
   * Multiplies the sampled diamond environment. A live uniform, not baked
   * into materials, so dragging this slider never triggers the shader
   * rebuild/recompile the rest of this component's props do.
   */
  envIntensity?: number;
  /**
   * Turns the diamond environment's longitude, in radians. Also a live
   * uniform — texture.offset does nothing here, since this shader computes
   * its own UV from the ray direction rather than reading a texture
   * transform (see diamondEnvRotation.ts).
   */
  envRotation?: number;
}) {
  const size = useThree((s) => s.size);
  const materials = useRef<RefractionMaterialLike[]>([]);
  // Read every frame, not a dependency of the rebuild effect below — see the
  // `envIntensity`/`envRotation` prop docs.
  const envIntensityRef = useRef(envIntensity);
  envIntensityRef.current = envIntensity;
  const envRotationRef = useRef(envRotation);
  envRotationRef.current = envRotation;

  /*
   * The BVH, cached per geometry.
   *
   * This is the expensive part of setting a stone up — it is what makes the
   * internal bounces real, by intersecting each ray against the actual facets —
   * and it depends only on the geometry. Choosing a different stone must never
   * rebuild it, or every swatch click would stall for seconds on a pave field.
   */
  const bvhCache = useRef(new Map<string, MeshBVHUniformStruct>());
  /**
   * Whatever the last COMPLETED rebuild put on screen, so a new one can tear
   * it down before building fresh — see the debounce below for why this
   * moved out of the effect's own return.
   */
  const disposeCurrentRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const cache = bvhCache.current;
    for (const mesh of meshes) {
      const geo = mesh.geometry;
      if (cache.has(geo.uuid)) continue;
      const bvh = new MeshBVHUniformStruct();
      bvh.updateFrom(new MeshBVH(bvhSource(geo), { strategy: SAH }));
      cache.set(geo.uuid, bvh);
    }
    return () => cache.clear();
  }, [meshes]);

  /*
   * One material per distinct stone spec, and a draw range per run.
   *
   * A gem group is a whole Rhino layer — 140 diamonds on the client's pendant —
   * so "make THIS one ruby" needs the mesh split into ranges. The decoder made
   * each stone a contiguous run of the index buffer, so recolouring three out
   * of 140 costs seven draw calls rather than 140, and the untouched stretches
   * stay merged.
   *
   * Rebuilt whenever the specs change, which is cheap now that the BVH is
   * cached above: creating a material is a few uniforms.
   */
  useLayoutEffect(() => {
    if (!meshes.length || !envMap) return;

    /*
     * Debounced, not run inline.
     *
     * This effect's own deps can settle across more than one commit very
     * early in a piece's life — a fresh model discovers its parts, then its
     * stone colours, then its material overrides, each a legitimate step
     * that used to trigger its own full rebuild (see routes/index.tsx's
     * `useStableRecord` for the reference-identity half of this fix; this is
     * the other half, for renders that carry genuinely-changing values close
     * together rather than merely a new reference to the same content).
     *
     * Two rAFs, the same span already used below for spacing individual
     * compiles apart and for the same underlying reason: a burst of commits
     * within a couple of frames of each other is exactly the pattern that
     * has taken down the WebGL context on real hardware. Deferred here means
     * a rebuild that keeps getting superseded before it ever starts never
     * touches the GPU at all — only the LAST one in a burst runs, and it
     * runs with whatever props are current in ITS closure, so the final
     * state is always what gets built once the burst settles.
     */
    let debounceCancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (debounceCancelled) return;
        runBuild();
      });
    });

    function runBuild() {
      // Tear down whatever the last COMPLETED build put on screen — never
      // what a superseded, never-started build would have — before making
      // the new one, so two builds can never both be live on the same mesh.
      disposeCurrentRef.current?.();
      disposeCurrentRef.current = null;

      const created: RefractionMaterialLike[] = [];
      const disposable: THREE.Material[] = [];
      const previous: (THREE.Material | THREE.Material[])[] = [];
      /** One entry per mesh that actually gets a material — see the staggering below. */
      const applySteps: (() => void)[] = [];

      for (const mesh of meshes) {
        const groupId = stoneId(mesh);
        const fileColor = stoneColor(mesh.name);

        /** Everything the shader needs for one stone, in one comparable object. */
        const specFor = (id: string, fallback?: GemSpec): GemSpec => {
          const o = optics?.[id];
          const c = overrides?.[id];
          if (!o && !c)
            return (
              fallback ?? {
                color: `#${fileColor.getHexString()}`,
                ior: DIAMOND_IOR,
                aberration: ABERRATION,
                transmission: 1,
              }
            );
          const from = fallback ?? {
            color: `#${fileColor.getHexString()}`,
            ior: DIAMOND_IOR,
            aberration: ABERRATION,
            transmission: 1,
          };
          return {
            color: c ?? from.color,
            ior: o?.ior ?? from.ior,
            aberration: o?.aberration ?? from.aberration,
            transmission: o?.transmission ?? from.transmission,
            metalness: o?.metalness ?? from.metalness,
            roughness: o?.roughness ?? from.roughness,
            clearcoat: o?.clearcoat ?? from.clearcoat,
            clearcoatRoughness: o?.clearcoatRoughness ?? from.clearcoatRoughness,
            envMapIntensity: o?.envMapIntensity ?? from.envMapIntensity,
            reflectivity: o?.reflectivity ?? from.reflectivity,
            absorptionFactor: o?.absorptionFactor ?? from.absorptionFactor,
          };
        };

        const base = specFor(groupId);

        // Per-solid specs, layered on the group's rather than on the file's, so
        // painting one stone in a group already set to ruby keeps ruby's optics
        // for everything the paint did not touch.
        const perSolid = new Map<number, GemSpec>();
        for (const id of new Set([...Object.keys(optics ?? {}), ...Object.keys(overrides ?? {})])) {
          const { group, solid } = parseId(id);
          if (group !== groupId || solid === null) continue;
          perSolid.set(solid, specFor(id, base));
        }

        const runs = planRuns(
          mesh.userData?.solids as ArrayLike<number> | undefined,
          drawableCount(mesh.geometry),
          base,
          perSolid,
        );
        const specs = runMaterials(runs);
        const slots = runSlots(runs, specs);

        /*
         * The reference length is measured from this mesh, because the traced
         * distance is in model space and a piece is scaled to unit size on load:
         * a fixed number would absorb wildly differently on a solitaire and on a
         * melee stone. Four radii approximates a ray's whole path through the
         * stone across its internal bounces.
         */
        const geo = mesh.geometry;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        const reference = (geo.boundingSphere?.radius ?? 0.25) * 4;
        const bvh = bvhCache.current.get(geo.uuid);

        /*
         * Building the material objects themselves is deferred into the
         * staggered step below, alongside assigning them — see the comment
         * there for why. Everything above this point (specs, runs, the
         * reference length) is cheap, synchronous planning with no GPU work
         * in it, and stays outside the stagger.
         */
        applySteps.push(() => {
          const made = specs.map((spec) => {
            const s = spec ?? base;

            /*
             * A stone that does not transmit is not traced.
             *
             * Onyx, and anything dragged below half transmission. The shader
             * assumes light leaves the far side, so an opaque body renders as dark
             * glass with the background showing through it — worse than wrong.
             */
            if (s.transmission < 0.5) {
              /*
               * Defaults exactly match what this branch hardcoded before Pearl
               * existed, so onyx and black diamond render bit-identically to
               * before unless a preset or the custom editor sets one of these —
               * this is the same contextual spec Pearl's Luster/Roughness/
               * Shine/Environment Intensity controls write into.
               */
              const opaque = new THREE.MeshPhysicalMaterial({
                color: new THREE.Color(s.color),
                metalness: s.metalness ?? 0,
                roughness: s.roughness ?? 0.08,
                clearcoat: s.clearcoat ?? 1,
                clearcoatRoughness: s.clearcoatRoughness ?? 0.04,
                envMapIntensity: s.envMapIntensity ?? 1.6,
                // three's own default — unset, this line changes nothing.
                reflectivity: s.reflectivity ?? 0.5,
              });
              disposable.push(opaque);
              return opaque as THREE.Material;
            }

            const material = new (
              MeshRefractionMaterial as unknown as {
                new (): RefractionMaterialLike;
              }
            )();
            material.defines = envDefines(envMap, diamondOptics.fastChroma);
            material.envMap = envMap;
            material.bounces = diamondOptics.bounces;
            material.ior = s.ior;
            // Scaled by how coloured the stone is. At full strength the shader
            // blends every grazing facet to pure white, which is the diamond look
            // on a colourless stone and erases the colour on a painted one.
            // A per-gem Reflectivity override, when set, replaces the diamond-wide
            // scale for this one stone — see the `reflectivity` field doc on
            // `GemSpec` for why this is the right existing hook rather than a
            // new one.
            material.fresnel = gemFresnel(s.color, s.reflectivity ?? diamondOptics.fresnelScale);
            material.aberrationStrength = s.aberration;
            // Normalised so the shader's HDR environment multiply keeps the hue
            // instead of clipping the bright facets to white.
            material.color = new THREE.Color(gemTint(s.color));
            material.resolution = new THREE.Vector2(size.width, size.height);
            if (bvh) material.bvh = bvh;

            /*
             * Depth-dependent colour, so a coloured stone reads as gemstone rather
             * than tinted glass. Colourless stones are unaffected by construction —
             * the absorption term is a power of the stone's colour, and one to any
             * power is one — so the white diamond look is untouched.
             */
            /*
             * Absorption Factor, above 1, shortens the reference length so the
             * same physical path reaches a higher exponent sooner — more
             * saturated for the same geometry. `gemAbsorption.ts` itself is
             * untouched; only the length its caller hands it changes.
             */
            const effectiveReference = reference / (s.absorptionFactor ?? 1);

            material.onBeforeCompile = (shader) => {
              const patched = withPathAbsorption(shader.fragmentShader, effectiveReference);
              // Null means drei's shader is not the one this was written against.
              // Keeping the original flat tint is correct; a partial patch is not.
              if (patched) shader.fragmentShader = patched;
              /*
               * Say so, loudly, either way.
               *
               * Falling back to drei's flat tint is the safe choice but it is also
               * indistinguishable from the colour feature being broken: the stone
               * shows its colour only where the environment is dim, so a painted
               * stone comes out part coloured and part white. Failing silently
               * turned that into a long hunt through geometry that was never at
               * fault. This runs once per program, not per frame.
               */
              if (import.meta.env.DEV) {
                if (patched) console.log(`[gem] absorption patch ${PATCH_ID} compiled`);
                else
                  console.error(
                    "[gem] absorption patch REJECTED — drei's shader has changed shape, so " +
                      "stones fall back to a flat tint that washes out against a bright " +
                      "environment. Run `npm run test:gem` to see which anchor no longer matches.",
                  );
              }

              // Live diamond-environment-intensity uniform — see diamondEnvIntensity.ts.
              const withIntensity = withEnvIntensity(shader.fragmentShader);
              if (withIntensity) {
                shader.fragmentShader = withIntensity;
                shader.uniforms.uDiamondEnvIntensity = new THREE.Uniform(envIntensityRef.current);
              } else if (import.meta.env.DEV) {
                console.error(
                  "[gem] env-intensity patch REJECTED — drei's shader has changed shape, so " +
                    "the diamond environment intensity slider has no effect on this stone.",
                );
              }

              // Live diamond-environment-rotation uniform — see diamondEnvRotation.ts.
              // No-op (by design) when envMap is a cube texture; only the equirect
              // branch has a uvv/smoothUv to rotate.
              const withRotation = withEnvRotation(shader.fragmentShader);
              if (withRotation) {
                shader.fragmentShader = withRotation;
                shader.uniforms.uDiamondEnvRotation = new THREE.Uniform(
                  (envRotationRef.current ?? 0) / (2 * Math.PI),
                );
              } else if (import.meta.env.DEV && !(envMap as THREE.CubeTexture).isCubeTexture) {
                console.error(
                  "[gem] env-rotation patch REJECTED — drei's shader has changed shape, so " +
                    "the diamond environment rotation slider has no effect on this stone.",
                );
              }

              // Live environment-response-curve uniform — see diamondEnvResponse.ts.
              const withResponse = withEnvResponse(shader.fragmentShader);
              if (withResponse) {
                shader.fragmentShader = withResponse;
                shader.uniforms.uEnvResponseExponent = new THREE.Uniform(
                  diamondOptics.envResponseExponent,
                );
              } else if (import.meta.env.DEV) {
                console.error(
                  "[gem] env-response patch REJECTED — drei's shader has changed shape, so " +
                    "the environment response curve has no effect on this stone.",
                );
              }

              // Live pre-ACES HDR-compression uniforms — see gemHdrKnee.ts.
              const withKnee = withHdrKnee(shader.fragmentShader);
              if (withKnee) {
                shader.fragmentShader = withKnee;
                shader.uniforms.uKneeThreshold = new THREE.Uniform(diamondOptics.kneeThreshold);
                shader.uniforms.uKneeStrength = new THREE.Uniform(diamondOptics.kneeStrength);
              } else if (import.meta.env.DEV) {
                console.error(
                  "[gem] hdr-knee patch REJECTED — drei's shader has changed shape, so " +
                    "the diamond's pre-ACES HDR compression has no effect on this stone.",
                );
              }
            };
            /*
             * The reference length is baked into the shader text, so two stones of
             * different sizes need different programs. Without this three reuses
             * the first compiled program for all of them and every stone absorbs as
             * if it were the size of whichever compiled first.
             *
             * PATCH_ID and ENV_INTENSITY_PATCH_ID cover the same hazard for their own
             * patches, and the fast-chroma flag is included because it changes the
             * compiled `#define`s, not just a uniform. This cache lives on the
             * renderer, which survives a Vite hot update — so a key that does not
             * move when any of these do means three keeps serving a stale program,
             * and the edit silently does nothing until the renderer is torn down.
             */
            material.customProgramCacheKey = () =>
              `gem-absorb-${effectiveReference.toPrecision(8)}-${PATCH_ID}-envint-${ENV_INTENSITY_PATCH_ID}` +
              `-envrot-${ENV_ROTATION_PATCH_ID}-envresp-${ENV_RESPONSE_PATCH_ID}-hdrknee-${HDR_KNEE_PATCH_ID}` +
              `-fc${diamondOptics.fastChroma ? 1 : 0}`;
            material.needsUpdate = true;

            created.push(material);
            disposable.push(material as unknown as THREE.Material);
            return material as unknown as THREE.Material;
          });

          if (!made.length) return;

          previous.push(mesh.material);
          mesh.geometry.clearGroups();
          if (made.length > 1) {
            runs.forEach((run, i) => mesh.geometry.addGroup(run.start, run.count, slots[i]));
            mesh.material = made;
          } else {
            mesh.material = made[0];
          }
        });
      }

      materials.current = created;

      /*
       * Applied one mesh at a time, an animation frame apart — never all at
       * once.
       *
       * `envDefines` above bakes the environment texture's own dimensions into
       * the shader as compile-time defines, so switching environments forces a
       * fresh GLSL shader compile for every distinct stone group a piece has,
       * not just a uniform update. Three only actually compiles a program the
       * first time `gl.render()` encounters it — not when `mesh.material` is
       * assigned — so introducing every new material in the same tick means
       * the very next render call compiles all of them synchronously, back to
       * back, in one go. ANGLE translates each through its HLSL compiler
       * (visible in chrome://gpu's own log), which is not fast, and this was
       * confirmed on real hardware to be enough to lose the WebGL context
       * outright — reproducing even against an environment that was already
       * loaded and cached, which is what pointed at compilation rather than
       * the texture fetch as the actual cost. Spacing the assignments apart
       * gives each fresh program its own render call to compile in, so no
       * single frame ever carries more than one new shader compile.
       *
       * Two rAFs per step, not one, kept as defence in depth even now that
       * the debounce above coalesces most redundant back-to-back rebuilds
       * before they ever reach this point (see that comment for the actual
       * root cause it was chasing — a theme-flash script's `data-theme`
       * attribute, now fixed with `suppressHydrationWarning` in
       * `__root.tsx`). One frame of spacing was tuned against a single clean
       * run and wasn't enough headroom for two overlapping ones; a double
       * rAF roughly halves the compile density during that window without
       * making a normal single run noticeably slower to finish.
       */
      let cancelled = false;
      let raf = 0;
      function step(i: number) {
        if (cancelled || i >= applySteps.length) return;
        applySteps[i]();
        raf = requestAnimationFrame(() => {
          raf = requestAnimationFrame(() => step(i + 1));
        });
      }
      step(0);

      disposeCurrentRef.current = () => {
        cancelled = true;
        cancelAnimationFrame(raf);
        // Put the originals back before disposing ours, so a remount never lands
        // on a disposed program.
        meshes.forEach((mesh, i) => {
          if (previous[i]) mesh.material = previous[i];
        });
        disposable.forEach((m) => m.dispose());
        materials.current = [];
      };
    }

    /*
     * Cancels only the SCHEDULING of a build that has not started yet — never
     * a build that already has, which is why disposal lives on
     * `disposeCurrentRef` instead of here. A superseded invocation whose
     * timers never fired has nothing on screen to tear down; what IS on
     * screen belongs to whichever invocation last actually ran `runBuild`,
     * and only the next successful `runBuild` (or true unmount, below) should
     * dispose it.
     */
    return () => {
      debounceCancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [meshes, envMap, size.width, size.height, overrides, optics, diamondOptics]);

  // Unmount only — every other teardown path runs through `disposeCurrentRef`
  // itself, from the next build that supersedes this one.
  useEffect(() => {
    return () => {
      disposeCurrentRef.current?.();
      disposeCurrentRef.current = null;
    };
  }, []);

  // The shader reconstructs world rays itself, so it needs the camera each frame.
  useFrame(({ camera }) => {
    for (const material of materials.current) {
      material.viewMatrixInverse = camera.matrixWorld;
      material.projectionMatrixInverse = camera.projectionMatrixInverse;
      const intensity = material.uniforms.uDiamondEnvIntensity;
      if (intensity) intensity.value = envIntensityRef.current;
      const rotation = material.uniforms.uDiamondEnvRotation;
      if (rotation) rotation.value = (envRotationRef.current ?? 0) / (2 * Math.PI);
    }
  });

  return null;
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshBVHUniformStruct, SAH } from "three-mesh-bvh";
import { buildBVH } from "@/lib/bvhAsync";
import { requestRender } from "./renderNow";
import { parseId } from "./selection";
import { planRuns, runMaterials, runSlots, drawableCount } from "./plan";
import { STONE_ENV_INTENSITY, createDiamondMaterial } from "./diamondMaterial";
import type { GemTune } from "./lighting";

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
 * The shader itself lives in diamondMaterial.ts, shared with the try-on. It
 * replaced drei's MeshRefractionMaterial, which let all of a ray's light out at
 * the first facet that allowed it; ours splits the light at every facet by the
 * Fresnel equations, adds the crown's surface reflection, and traces red, green
 * and blue separately for fire. See that file for the details and the settings.
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
/** Bounces of total internal reflection. 3 is where brilliance appears. */
/** What the library resolves a chosen stone down to, for the shader. */
export interface GemSpec {
  color: string;
  ior: number;
  aberration: number;
  transmission: number;
}

export interface GemOptics {
  ior: number;
  aberration: number;
  /**
   * Below 0.5 the stone stops being traced and renders as a polished solid.
   * Absent means fully transmissive, which is what every stone was before.
   */
  transmission?: number;
}

/** The stone-group id a mesh belongs to, or "" for an untagged one. */
function stoneId(mesh: THREE.Mesh): string {
  return (mesh.userData?.stone as { id?: string } | undefined)?.id ?? "";
}

/**
 * Diamond's dispersion in the library's units (library.ts `aberrationFor`):
 * what a stone with no library optics is traced with.
 */
const ABERRATION = 0.035;

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
export function bvhSource(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (geo.index) return geo.toNonIndexed();
  const shared = new THREE.BufferGeometry();
  shared.setAttribute("position", geo.getAttribute("position"));
  return shared;
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
  viewLocked = false,
  tune,
}: {
  meshes: THREE.Mesh[];
  /** Null while the stones' room is still loading; the stones wait. */
  envMap: THREE.Texture | null;
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
  /**
   * Lock the stones' environment to the camera, as a photographer's light rig
   * travels with the camera.
   *
   * A generated gem room (gemStudio.ts, the light tent) puts the camera's own
   * dark reflection, the thing that draws the black arrows in a face-up
   * diamond, IN FRONT of the stone. Fixed in the world, that is only true from
   * the front: orbit to the top and the stone looks straight into the
   * overhead softbox and every facet goes white. Locked to the view, the dark
   * reflection is always behind the viewer and the stone keeps its contrast
   * from every angle; it still sparkles as it turns, because the stone moves
   * relative to the rig. This is what WebGi and iJewel3D call "oriented
   * lighting" for their gem environments.
   */
  viewLocked?: boolean;
  /**
   * Per-environment gem tuning (see `EnvironmentOption.gemTune`): where the
   * room is turned for the best sparkle, how bright it is, and contrast. The
   * same three dials the commercial gem renderers expose, because the right
   * values belong to the map, not to the stone.
   */
  tune?: GemTune;
}) {
  /*
   * The stones' environment rotation: the camera's view rotation when locked
   * (then turned by the tuning offset), identity otherwise. One matrix shared
   * by every stone material, updated in place each frame, so it costs one 3×3
   * copy however many stones there are.
   */
  const envRotation = useRef(new THREE.Matrix3()).current;
  // Dev only: timestamp a lost WebGL context against the material builds.
  const glEl = useThree((st) => st.gl.domElement);
  useLayoutEffect(() => {
    if (!import.meta.env.DEV) return;
    const onLost = () =>
      console.warn(`[gem] WebGL context lost at ${Math.round(performance.now())}ms`);
    glEl.addEventListener("webglcontextlost", onLost);
    return () => glEl.removeEventListener("webglcontextlost", onLost);
  }, [glEl]);
  const offset = useRef({ m: new THREE.Matrix4(), e: new THREE.Euler() }).current;
  const live = useRef<THREE.ShaderMaterial[]>([]);
  useFrame(({ camera }) => {
    // Dev only: window.__gemTune = { yaw, pitch, intensity, gamma } tunes live.
    const t =
      (import.meta.env.DEV && (window as unknown as { __gemTune?: GemTune }).__gemTune) || tune;
    if (viewLocked) {
      offset.m.makeRotationFromEuler(offset.e.set(t?.pitch ?? 0, t?.yaw ?? 0, 0));
      offset.m.multiply(camera.matrixWorldInverse);
      envRotation.setFromMatrix4(offset.m);
    } else {
      envRotation.identity();
    }
    for (const m of live.current) {
      m.uniforms.envIntensity.value = t?.intensity ?? STONE_ENV_INTENSITY;
      m.uniforms.gamma.value = t?.gamma ?? 1;
    }
  });

  /*
   * The BVH, cached per geometry.
   *
   * This is the expensive part of setting a stone up — it is what makes the
   * internal bounces real, by intersecting each ray against the actual facets —
   * and it depends only on the geometry. Choosing a different stone must never
   * rebuild it, or every swatch click would stall for seconds on a pave field.
   */
  const bvhCache = useRef(new Map<string, MeshBVHUniformStruct>());
  /** Geometry whose tree is on its way from the worker. */
  const inFlight = useRef(new Set<string>());
  /** Geometry currently on screen, so a tree that arrives late for a piece
   *  already closed is dropped rather than cached. */
  const wanted = useRef(new Set<string>());
  /** Bumped when the trees in flight have all arrived, so the materials below
   *  are rebuilt with them. */
  const [bvhVersion, setBvhVersion] = useState(0);

  /*
   * Built in a worker (lib/bvhAsync.ts). On the main thread this froze the
   * page for about 250 ms per pavé field on a desktop, several times that on a
   * phone. Until a stone's tree arrives the stone keeps the material it
   * loaded with, the same as it always did while waiting for its room.
   *
   * The cache is pruned to the stones on screen, not cleared whenever the
   * mesh list changes: clearing it on every change built every tree twice on
   * load, because the list is produced again as the piece settles.
   */
  useEffect(() => {
    const cache = bvhCache.current;
    wanted.current = new Set(meshes.map((m) => m.geometry.uuid));
    for (const uuid of [...cache.keys()]) if (!wanted.current.has(uuid)) cache.delete(uuid);

    for (const mesh of meshes) {
      const geo = mesh.geometry;
      const uuid = geo.uuid;
      if (cache.has(uuid) || inFlight.current.has(uuid)) continue;
      inFlight.current.add(uuid);
      buildBVH(bvhSource(geo), { strategy: SAH })
        .then((tree) => {
          if (!wanted.current.has(uuid)) return;
          const uniform = new MeshBVHUniformStruct();
          uniform.updateFrom(tree);
          cache.set(uuid, uniform);
        })
        .catch((err) => console.warn("[gem] could not build a stone's BVH", err))
        .finally(() => {
          inFlight.current.delete(uuid);
          /*
           * Once the last one lands, not per tree: rebuilding the materials
           * puts every stone back on its loaded material for a frame, so a
           * rebuild per tree would flicker each pavé field once per field.
           */
          if (inFlight.current.size === 0) setBvhVersion((v) => v + 1);
        });
    }
  }, [meshes]);

  // Everything goes when the stones do.
  useEffect(() => {
    const cache = bvhCache.current;
    return () => {
      wanted.current = new Set();
      cache.clear();
    };
  }, []);

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
            const opaque = new THREE.MeshPhysicalMaterial({
              color: new THREE.Color(s.color),
              metalness: 0,
              roughness: 0.08,
              clearcoat: 1,
              clearcoatRoughness: 0.04,
              envMapIntensity: 1.6,
            });
            disposable.push(opaque);
            return opaque as THREE.Material;
          }

          /*
           * The traced diamond (diamondMaterial.ts). Body colour, the colour
           * protection against bright highlights and the reference length are
           * uniforms there, not shader text, so every stone of a piece shares
           * one compiled program instead of one per stone size.
           *
           * The ray offset scales with the mesh: a fixed epsilon is either too
           * big for a millimetre melee stone or lost in float noise on a piece
           * modelled at another scale.
           */
          if (!bvh) return null;
          const material = createDiamondMaterial(bvh, envMap, s, {
            envRotation,
            absorbRef: reference,
            epsilon: (geo.boundingSphere?.radius ?? 0.25) * 1e-4,
          });
          disposable.push(material);
          live.current.push(material);
          return material as THREE.Material;
        });

        // A missing BVH leaves the stone as it was rather than half-dressed.
        if (!made.length || made.some((m) => m === null)) return;
        const ready = made as THREE.Material[];

        previous.push(mesh.material);
        mesh.geometry.clearGroups();
        if (ready.length > 1) {
          runs.forEach((run, i) => mesh.geometry.addGroup(run.start, run.count, slots[i]));
          mesh.material = ready;
        } else {
          mesh.material = ready[0];
        }
      });
    }

    /*
     * Applied one mesh at a time, an animation frame apart — never all at
     * once.
     *
     * Written for drei's material, which baked the environment's dimensions
     * into its shader as compile-time defines, so switching environments
     * forced a fresh GLSL compile for every distinct stone group. The shared
     * diamond shader compiles far fewer programs, but the stagger costs one
     * frame per mesh and keeps the guarantee. Three only actually compiles a program the
     * first time `gl.render()` encounters it — not when `mesh.material` is
     * assigned — so introducing every new material in the same tick means
     * the very next render call compiles all of them synchronously, back to
     * back, in one go. ANGLE translates each through its HLSL compiler
     * (visible in chrome://gpu's own log), which is not fast, and this was
     * confirmed on real hardware to be enough to lose the WebGL context
     * outright — reproducing even against an environment that was already
     * loaded and cached, which is what pointed at compilation rather than
     * the texture fetch as the actual cost. Spacing the assignments one
     * frame apart gives each fresh program its own render call to compile
     * in, so no single frame ever carries more than one new shader compile.
     */
    let cancelled = false;
    let raf = 0;
    function step(i: number) {
      if (cancelled || i >= applySteps.length) return;
      applySteps[i]();
      // Swapped outside a React render, so the on-demand viewer is told.
      requestRender();
      raf = requestAnimationFrame(() => step(i + 1));
    }
    /*
     * The first build waits a few frames too. Its room usually arrives at the
     * same moment as other GPU setup (the metal's environment is prefiltered
     * from the very same HDR file), and two heavy jobs in one frame is what
     * has been seen to drop the WebGL context on integrated GPUs.
     */
    const settle = (frames: number) =>
      frames <= 0 ? step(0) : (raf = requestAnimationFrame(() => settle(frames - 1)));
    settle(4);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      // Put the originals back before disposing ours, so a remount never lands
      // on a disposed program.
      meshes.forEach((mesh, i) => {
        if (previous[i]) mesh.material = previous[i];
      });
      disposable.forEach((m) => m.dispose());
      live.current = live.current.filter((m) => !disposable.includes(m));
    };
  }, [meshes, envMap, overrides, optics, bvhVersion]);

  return null;
}

import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshBVH, MeshBVHUniformStruct, SAH } from "three-mesh-bvh";
import { parseId } from "./selection";
import { planRuns, runMaterials, runSlots, drawableCount } from "./plan";
import { MeshRefractionMaterial } from "@react-three/drei/materials/MeshRefractionMaterial";
import { withPathAbsorption } from "./gemAbsorption";

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

const BOUNCES = 3;
/** Splits the ray per wavelength — this is the fire. */
const ABERRATION = 0.035;
/** Edge brightness where the stone turns mirror-like. */
const FRESNEL = 1.0;

/**
 * The shader reads the environment through three's CubeUV packing, so it needs
 * the mip layout of the specific map as compile-time constants. Mirrors drei's
 * own calculation, but tolerates a texture that has no `image` rather than
 * throwing.
 */
function envDefines(envMap: THREE.Texture): Record<string, string> {
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
    FAST_CHROMA: "",
  };
  if (isCube) defines.ENVMAP_TYPE_CUBEM = "";
  return defines;
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
}) {
  const size = useThree((s) => s.size);
  const materials = useRef<RefractionMaterialLike[]>([]);

  /*
   * The BVH, cached per geometry.
   *
   * This is the expensive part of setting a stone up — it is what makes the
   * internal bounces real, by intersecting each ray against the actual facets —
   * and it depends only on the geometry. Choosing a different stone must never
   * rebuild it, or every swatch click would stall for seconds on a pave field.
   */
  const bvhCache = useRef(new Map<string, MeshBVHUniformStruct>());

  useLayoutEffect(() => {
    const cache = bvhCache.current;
    for (const mesh of meshes) {
      const geo = mesh.geometry;
      if (cache.has(geo.uuid)) continue;
      const bvh = new MeshBVHUniformStruct();
      bvh.updateFrom(new MeshBVH(geo.index ? geo.toNonIndexed() : geo, { strategy: SAH }));
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

    const created: RefractionMaterialLike[] = [];
    const disposable: THREE.Material[] = [];
    const previous: (THREE.Material | THREE.Material[])[] = [];

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

        const material = new (
          MeshRefractionMaterial as unknown as {
            new (): RefractionMaterialLike;
          }
        )();
        material.defines = envDefines(envMap);
        material.envMap = envMap;
        material.bounces = BOUNCES;
        material.ior = s.ior;
        material.fresnel = FRESNEL;
        material.aberrationStrength = s.aberration;
        material.color = new THREE.Color(s.color);
        material.resolution = new THREE.Vector2(size.width, size.height);
        if (bvh) material.bvh = bvh;

        /*
         * Depth-dependent colour, so a coloured stone reads as gemstone rather
         * than tinted glass. Colourless stones are unaffected by construction —
         * the absorption term is a power of the stone's colour, and one to any
         * power is one — so the white diamond look is untouched.
         */
        material.onBeforeCompile = (shader) => {
          const patched = withPathAbsorption(shader.fragmentShader, reference);
          // Null means drei's shader is not the one this was written against.
          // Keeping the original flat tint is correct; a partial patch is not.
          if (patched) shader.fragmentShader = patched;
        };
        /*
         * The reference length is baked into the shader text, so two stones of
         * different sizes need different programs. Without this three reuses
         * the first compiled program for all of them and every stone absorbs as
         * if it were the size of whichever compiled first.
         */
        material.customProgramCacheKey = () => `gem-absorb-${reference.toPrecision(8)}`;
        material.needsUpdate = true;

        created.push(material);
        disposable.push(material as unknown as THREE.Material);
        return material as unknown as THREE.Material;
      });

      if (!made.length) continue;

      previous.push(mesh.material);
      mesh.geometry.clearGroups();
      if (made.length > 1) {
        runs.forEach((run, i) => mesh.geometry.addGroup(run.start, run.count, slots[i]));
        mesh.material = made;
      } else {
        mesh.material = made[0];
      }
    }

    materials.current = created;

    return () => {
      // Put the originals back before disposing ours, so a remount never lands
      // on a disposed program.
      meshes.forEach((mesh, i) => {
        if (previous[i]) mesh.material = previous[i];
      });
      disposable.forEach((m) => m.dispose());
      materials.current = [];
    };
  }, [meshes, envMap, size.width, size.height, overrides, optics]);

  // The shader reconstructs world rays itself, so it needs the camera each frame.
  useFrame(({ camera }) => {
    for (const material of materials.current) {
      material.viewMatrixInverse = camera.matrixWorld;
      material.projectionMatrixInverse = camera.projectionMatrixInverse;
    }
  });

  return null;
}

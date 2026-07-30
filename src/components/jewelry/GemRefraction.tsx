import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { MeshBVH, MeshBVHUniformStruct, SAH } from "three-mesh-bvh";
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
export function GemRefraction({ meshes, envMap }: { meshes: THREE.Mesh[]; envMap: THREE.Texture }) {
  const size = useThree((s) => s.size);
  const materials = useRef<RefractionMaterialLike[]>([]);

  useLayoutEffect(() => {
    if (!meshes.length || !envMap) return;

    const created: RefractionMaterialLike[] = [];
    const previous: THREE.Material[] = [];

    for (const mesh of meshes) {
      const material = new (
        MeshRefractionMaterial as unknown as {
          new (): RefractionMaterialLike;
        }
      )();

      material.defines = envDefines(envMap);
      material.envMap = envMap;
      material.bounces = BOUNCES;
      material.ior = DIAMOND_IOR;
      material.fresnel = FRESNEL;
      material.aberrationStrength = ABERRATION;
      material.color = stoneColor(mesh.name);
      material.resolution = new THREE.Vector2(size.width, size.height);

      // The BVH is what makes the internal bounces real: each ray is
      // intersected against the stone's actual facets.
      const bvh = new MeshBVHUniformStruct();
      const geo = mesh.geometry;
      bvh.updateFrom(new MeshBVH(geo.index ? geo.toNonIndexed() : geo, { strategy: SAH }));
      material.bvh = bvh;

      /*
       * Depth-dependent colour, so a coloured stone reads as gemstone rather
       * than tinted glass. Colourless stones are unaffected by construction —
       * the absorption term is a power of the stone's colour, and one to any
       * power is one — so the white diamond look is untouched.
       *
       * The reference length is measured from this stone, because the traced
       * distance is in model space and a piece is scaled to unit size on load:
       * a fixed number would absorb wildly differently on a solitaire and on a
       * melee stone. Four radii approximates a ray's whole path through the
       * stone across its internal bounces.
       */
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const reference = (geo.boundingSphere?.radius ?? 0.25) * 4;

      material.onBeforeCompile = (shader) => {
        const patched = withPathAbsorption(shader.fragmentShader, reference);
        // Null means drei's shader is not the one this was written against.
        // Keeping the original flat tint is correct; a partial patch is not.
        if (patched) shader.fragmentShader = patched;
      };
      /*
       * The reference length is baked into the shader text, so two stones of
       * different sizes need different programs. Without this three reuses the
       * first compiled program for all of them and every stone absorbs as if it
       * were the size of whichever compiled first.
       */
      material.customProgramCacheKey = () => `gem-absorb-${reference.toPrecision(8)}`;

      material.needsUpdate = true;

      previous.push(mesh.material as THREE.Material);
      mesh.material = material;
      created.push(material);
    }

    materials.current = created;

    return () => {
      // Put the original material back before disposing ours, so a remount
      // never lands on a disposed program.
      meshes.forEach((mesh, i) => {
        if (previous[i]) mesh.material = previous[i];
      });
      created.forEach((m) => m.dispose());
      materials.current = [];
    };
  }, [meshes, envMap, size.width, size.height]);

  // The shader reconstructs world rays itself, so it needs the camera each frame.
  useFrame(({ camera }) => {
    for (const material of materials.current) {
      material.viewMatrixInverse = camera.matrixWorld;
      material.projectionMatrixInverse = camera.projectionMatrixInverse;
    }
  });

  return null;
}

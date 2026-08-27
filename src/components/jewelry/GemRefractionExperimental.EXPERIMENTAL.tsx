/*
 * PHASE 9 EXPERIMENTAL PROTOTYPE — NOT PRODUCTION CODE.
 *
 * A duplicate of GemRefraction.tsx, not an edit to it — production's own
 * component is byte-for-byte untouched by this file's existence. This copy
 * exists ONLY to test whether multi-sample environment lookups (see
 * `gemMultiSampleRefraction.EXPERIMENTAL.ts`) close the facet-transition gap
 * Phase 8 found, without any risk to the shipped renderer. Wired in only via
 * a temporary, reverted `Model.tsx` query-flag check for the duration of the
 * test. Safe to delete entirely afterward.
 *
 * Everything below except the `sampleCount`/`sampleSpread` prop and the one
 * extra patch application inside `onBeforeCompile` is copied verbatim from
 * GemRefraction.tsx — see that file for the doc comments on the parts that
 * are unchanged (BVH caching, the debounce, the staggered apply, per-solid
 * spec resolution, etc.). Only the diff-relevant parts are re-commented here.
 */
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
import { multiSamplePatchId, withMultiSampleEnv } from "./gemMultiSampleRefraction.EXPERIMENTAL";
import { gemFresnel, gemTint } from "./materials";
import { DIAMOND_ABERRATION } from "./library";
import { DEFAULT_DIAMOND_OPTICS, type DiamondOpticsSettings } from "./diamondOptics";
import type { GemOptics } from "./GemRefraction";

const DIAMOND_IOR = 2.417;

function stoneColor(name: string): THREE.Color {
  const match = /gem-([0-9a-f]{6})/i.exec(name);
  if (!match) return new THREE.Color("#ffffff");
  const c = new THREE.Color(`#${match[1]}`);
  return Math.max(c.r, c.g, c.b) < 0.09 ? new THREE.Color("#ffffff") : c;
}

interface GemSpec {
  color: string;
  ior: number;
  aberration: number;
  transmission: number;
  metalness?: number;
  roughness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  reflectivity?: number;
  absorptionFactor?: number;
}

function stoneId(mesh: THREE.Mesh): string {
  return (mesh.userData?.stone as { id?: string } | undefined)?.id ?? "";
}

const ABERRATION = DIAMOND_ABERRATION;

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

export function GemRefractionExperimental({
  meshes,
  envMap,
  overrides,
  optics,
  diamondOptics = DEFAULT_DIAMOND_OPTICS,
  envIntensity = 1,
  envRotation = 0,
  sampleCount = 1,
  sampleSpread = 0.02,
}: {
  meshes: THREE.Mesh[];
  envMap: THREE.Texture;
  overrides?: Record<string, string>;
  optics?: Record<string, GemOptics>;
  diamondOptics?: DiamondOpticsSettings;
  envIntensity?: number;
  envRotation?: number;
  /** PHASE 9 EXPERIMENTAL. 1 = production behaviour, unpatched. */
  sampleCount?: number;
  /** PHASE 9 EXPERIMENTAL. Vogel-spiral disk radius in ray-direction units. */
  sampleSpread?: number;
}) {
  const size = useThree((s) => s.size);
  const materials = useRef<RefractionMaterialLike[]>([]);
  const envIntensityRef = useRef(envIntensity);
  envIntensityRef.current = envIntensity;
  const envRotationRef = useRef(envRotation);
  envRotationRef.current = envRotation;

  const bvhCache = useRef(new Map<string, MeshBVHUniformStruct>());
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

  useLayoutEffect(() => {
    if (!meshes.length || !envMap) return;

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
      disposeCurrentRef.current?.();
      disposeCurrentRef.current = null;

      const created: RefractionMaterialLike[] = [];
      const disposable: THREE.Material[] = [];
      const previous: (THREE.Material | THREE.Material[])[] = [];
      const applySteps: (() => void)[] = [];

      for (const mesh of meshes) {
        const groupId = stoneId(mesh);
        const fileColor = stoneColor(mesh.name);

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

        const geo = mesh.geometry;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        const reference = (geo.boundingSphere?.radius ?? 0.25) * 4;
        const bvh = bvhCache.current.get(geo.uuid);

        applySteps.push(() => {
          const made = specs.map((spec) => {
            const s = spec ?? base;

            if (s.transmission < 0.5) {
              const opaque = new THREE.MeshPhysicalMaterial({
                color: new THREE.Color(s.color),
                metalness: s.metalness ?? 0,
                roughness: s.roughness ?? 0.08,
                clearcoat: s.clearcoat ?? 1,
                clearcoatRoughness: s.clearcoatRoughness ?? 0.04,
                envMapIntensity: s.envMapIntensity ?? 1.6,
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
            material.fresnel = gemFresnel(s.color, s.reflectivity ?? diamondOptics.fresnelScale);
            material.aberrationStrength = s.aberration;
            material.color = new THREE.Color(gemTint(s.color));
            material.resolution = new THREE.Vector2(size.width, size.height);
            if (bvh) material.bvh = bvh;

            const effectiveReference = reference / (s.absorptionFactor ?? 1);

            material.onBeforeCompile = (shader) => {
              const patched = withPathAbsorption(shader.fragmentShader, effectiveReference);
              if (patched) shader.fragmentShader = patched;
              else if (import.meta.env.DEV) {
                console.error("[gem-exp] absorption patch REJECTED");
              }

              const withIntensity = withEnvIntensity(shader.fragmentShader);
              if (withIntensity) {
                shader.fragmentShader = withIntensity;
                shader.uniforms.uDiamondEnvIntensity = new THREE.Uniform(envIntensityRef.current);
              }

              const withRotation = withEnvRotation(shader.fragmentShader);
              if (withRotation) {
                shader.fragmentShader = withRotation;
                shader.uniforms.uDiamondEnvRotation = new THREE.Uniform(
                  (envRotationRef.current ?? 0) / (2 * Math.PI),
                );
              }

              // PHASE 9 EXPERIMENTAL — the only functional addition versus
              // GemRefraction.tsx. Applied last, after every production
              // patch, so it operates on the exact same shader those patches
              // already produce. sampleCount <= 1 leaves the shader
              // unchanged (see that function's own doc comment).
              if (sampleCount > 1) {
                const withMultiSample = withMultiSampleEnv(
                  shader.fragmentShader,
                  sampleCount,
                  sampleSpread,
                );
                if (withMultiSample) {
                  shader.fragmentShader = withMultiSample;
                  if (import.meta.env.DEV) {
                    console.log(
                      `[gem-exp] multi-sample patch applied — N=${sampleCount} spread=${sampleSpread}`,
                    );
                  }
                } else if (import.meta.env.DEV) {
                  console.error("[gem-exp] multi-sample patch REJECTED — anchors did not match");
                }
              }
            };

            material.customProgramCacheKey = () =>
              `gem-exp-absorb-${effectiveReference.toPrecision(8)}-${PATCH_ID}-envint-${ENV_INTENSITY_PATCH_ID}` +
              `-envrot-${ENV_ROTATION_PATCH_ID}-fc${diamondOptics.fastChroma ? 1 : 0}` +
              `-msample-${sampleCount}-${sampleSpread}-${multiSamplePatchId(Math.max(2, sampleCount), sampleSpread)}`;
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
        meshes.forEach((mesh, i) => {
          if (previous[i]) mesh.material = previous[i];
        });
        disposable.forEach((m) => m.dispose());
        materials.current = [];
      };
    }

    return () => {
      debounceCancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [meshes, envMap, size.width, size.height, overrides, optics, diamondOptics, sampleCount, sampleSpread]);

  useEffect(() => {
    return () => {
      disposeCurrentRef.current?.();
      disposeCurrentRef.current = null;
    };
  }, []);

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

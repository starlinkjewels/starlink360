import { useEffect, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";

/**
 * Lets diamonds reflect the actual piece — the metal setting, and any other
 * stone that isn't itself refractive — in addition to the baked Diamond
 * Studio backdrop, via a CubeCamera capture.
 *
 * Diamonds are excluded from the capture entirely, which is what rules out a
 * diamond reflecting a diamond reflecting a diamond: the capture scene never
 * contains one, so there is nothing for the feedback to start from. The
 * backdrop is set as the capture scene's own background/environment, so
 * anything the capture doesn't cover with real geometry still shows the
 * tuned bright/dark studio pattern rather than plain black.
 *
 * Stand-in meshes DO NOT share the live mesh's material by reference — see
 * `neutralized` below for why they are cloned instead, which is the one
 * exception to this hook otherwise costing nothing extra to keep resident.
 *
 * Captured on demand, never per frame: a diamond's reflection of a mostly
 * static piece doesn't need to track the camera, only the scene underneath
 * it, and that changes on a swatch click, not sixty times a second.
 */
/**
 * A clone of `material` with its colour flattened to a neutral grey and its
 * roughness pinned to the metal's real default. Metalness/clearcoat/
 * clearcoatRoughness are left untouched.
 *
 * The capture only ever contains metal stand-ins (gems are excluded from it
 * entirely — see the module comment), and a metal's `.color` at
 * `metalness: 1` IS its reflectance colour, not a tint over something else
 * (`materials.ts`'s `createMetalMaterial`). Left alone, that means a diamond
 * reflecting the setting is a diamond reflecting the metal's exact hue —
 * gold in, gold out, confirmed in Phase 18 as the source of the yellow cast
 * that had been read as the diamond itself being contaminated. Flattening
 * colour keeps the setting's specular STRUCTURE (bright highlights and dark
 * troughs following its shape) without shipping that hue into the stone —
 * turning dynamic reflections off entirely also removes the wash, but this
 * keeps the stone responsive to the piece's actual geometry rather than
 * falling back to a flat backdrop.
 *
 * Roughness, unlike colour/metalness/clearcoat, IS a live per-part override
 * (`MaterialsPanel`'s "Smoothness" slider, `1 - roughness`) rather than a
 * fixed constant — every `METALS` entry in `library.ts` ships at `0.02`, and
 * the panel's own fallback when no override is set is that same `0.02`, but
 * dragging the slider can push the LIVE material's roughness far past it.
 * Passing that live value through made the diamond's reflection visibly
 * flatten or sharpen with a slider its own look has nothing to do with,
 * which is the coupling this pins away. `metalness` is always `1` and
 * `clearcoat`/`clearcoatRoughness` are always `0.18`/`0.06` for every metal
 * regardless of finish (`createMetalMaterial`) — never slider-controlled, so
 * passing those through was never actually the source of any coupling and
 * they are left alone here. A prior version of this fix pinned all three
 * (roughness 0.3, metalness 1, clearcoat 0) instead of just the one that
 * needed it, and forcing clearcoat to 0 stripped the lacquer layer every
 * metal render actually has — the diamond came back looking whitish, flat,
 * and plastic. Pinning only roughness, and to the value the app already
 * renders at by default rather than an arbitrary guess, fixes the coupling
 * without touching anything that wasn't broken.
 */
function neutralized(material: THREE.Material): THREE.Material {
  const clone = material.clone();
  if ("color" in clone && (clone as THREE.MeshPhysicalMaterial).color instanceof THREE.Color) {
    (clone as THREE.MeshPhysicalMaterial).color.setRGB(0.82, 0.82, 0.82);
  }
  if ("roughness" in clone) {
    (clone as THREE.MeshPhysicalMaterial).roughness = 0.02;
  }
  return clone;
}

export function useDiamondSceneCapture({
  object,
  stones,
  backdrop,
  enabled,
  resolution = 256,
  materialsGeneration = 0,
}: {
  object: THREE.Object3D;
  stones: THREE.Mesh[];
  /** The static Diamond Studio equirect texture to use as the capture's own background. */
  backdrop: THREE.Texture;
  enabled: boolean;
  resolution?: number;
  /**
   * Bumped by `Model.tsx` whenever it actually replaces (not mutates) a
   * metal mesh's material — a per-solid recolour splits draw ranges, which
   * needs brand new materials, not an in-place edit. The stand-ins are
   * cloned fresh on every run of this effect (see `neutralized`), so a
   * replace this wasn't told about would keep reflecting a clone of a
   * material about to be disposed.
   *
   * A colour tweak that mutates the existing material in place needs no bump
   * — colour is discarded into the same neutral grey regardless, and
   * roughness is pinned to a fixed constant rather than read from the live
   * material at all (see `neutralized`), so neither can go stale. Metalness
   * and clearcoat/clearcoatRoughness are passed through, but those are fixed
   * constants for every metal (`createMetalMaterial`) that a live edit never
   * actually changes, so there is nothing there to go stale either.
   */
  materialsGeneration?: number;
}): THREE.CubeTexture | null {
  const gl = useThree((s) => s.gl);
  const [envMap, setEnvMap] = useState<THREE.CubeTexture | null>(null);

  useEffect(() => {
    if (!enabled) {
      setEnvMap(null);
      return;
    }

    const stoneSet = new Set(stones);
    const standIns: THREE.Mesh[] = [];
    const clonedMaterials: THREE.Material[] = [];
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || stoneSet.has(mesh)) return;
      mesh.updateWorldMatrix(true, false);
      const material = Array.isArray(mesh.material)
        ? mesh.material.map(neutralized)
        : neutralized(mesh.material);
      clonedMaterials.push(...(Array.isArray(material) ? material : [material]));
      const standIn = new THREE.Mesh(mesh.geometry, material);
      standIn.matrixAutoUpdate = false;
      standIn.matrix.copy(mesh.matrixWorld);
      standIns.push(standIn);
    });

    // Nothing to reflect — the pure static backdrop is what GemRefraction
    // already falls back to, so there is no texture to build here.
    if (!standIns.length) {
      setEnvMap(null);
      return;
    }

    const captureScene = new THREE.Scene();
    captureScene.background = backdrop;
    captureScene.environment = backdrop;
    for (const standIn of standIns) captureScene.add(standIn);

    const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
    const radius = sphere.radius || 1;

    const renderTarget = new THREE.WebGLCubeRenderTarget(resolution, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
    });
    renderTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;

    const cubeCamera = new THREE.CubeCamera(radius * 0.01, radius * 20, renderTarget);
    cubeCamera.position.copy(sphere.center);
    captureScene.add(cubeCamera);

    cubeCamera.update(gl, captureScene);
    setEnvMap(renderTarget.texture);

    return () => {
      renderTarget.dispose();
      // standIns share geometry with the live scene by reference — only the
      // render target, the wrapper meshes, and their cloned materials are
      // ours, and the clones leak on every re-capture if not disposed here.
      for (const m of clonedMaterials) m.dispose();
      setEnvMap(null);
    };
  }, [object, stones, backdrop, enabled, resolution, gl, materialsGeneration]);

  return envMap;
}

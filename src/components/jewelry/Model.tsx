import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useEnvironment, useGLTF } from "@react-three/drei";
import type { Finish } from "@/data/finishes";
import { DRACO_LIB } from "@/lib/loadJewelryFile";
import { createGemMaterial, createMetalMaterial, facetGeometry } from "./materials";
import { GemRefraction, type GemOptics } from "./GemRefraction";
import { DEFAULT_LIGHTING, environmentById, getLightTent, type LightingSettings } from "./lighting";
import { collectStoneGroups, type StoneGroup } from "./stones";
import { collectParts, ensurePart, ensureSolids, parseId, type Part } from "./selection";
import { assignmentsFor, planRuns, runMaterials, runSlots, drawableCount } from "./plan";
import { upAxisRotation, type CameraSettings } from "./camera";
import {
  DEFAULT_TEXTURE,
  ensureProjectedUVs,
  getFinishMaps,
  isTextureInert,
  type TextureAssignment,
} from "./textures";
import { useFallbackScene } from "./FallbackPendant";

/** What the camera needs to frame a piece. */
export interface Fit {
  /** Bounding-sphere radius — shadows and zoom limits. */
  radius: number;
  /** Footprint radius in XZ; the turntable spins about Y. */
  radiusXZ: number;
  /** Half extent in Y. */
  halfHeight: number;
}

interface DressedProps {
  scene: THREE.Object3D;
  finish: Finish;
  onFit: (fit: Fit) => void;
  /** Spins the piece itself. Only `spinAxis` and `spinSpeed` are read here. */
  camera?: CameraSettings;
  /** Only the environment fields are read here; lights never reach the stones. */
  lighting?: LightingSettings;
  /** Colour chosen per stone group in the picker, keyed by group id. */
  stoneColors?: Record<string, string>;
  /** Library metal resolved per part id, from the Materials panel. */
  metalOverrides?: Record<
    string,
    {
      color: string;
      roughness: number;
      metalness: number;
      /**
       * The finish for this part. Carried in the same object as the colour so
       * run-merging compares them together — two prongs in the same gold but
       * different finishes are different draw runs, and comparing only the
       * colour would silently merge them.
       */
      texture?: TextureAssignment;
    }
  >;
  /** Library optics resolved per stone group id, from the Materials panel. */
  gemOverrides?: Record<string, GemOptics>;
  /** Reports the selectable stone groups once the piece is built. */
  onStones?: (groups: StoneGroup[]) => void;
  /** Reports every selectable part — metal and stone alike. */
  onParts?: (parts: Part[]) => void;
  /**
   * True when the caller hands us a scene nobody else holds — an upload or the
   * procedural stand-in. Those we free entirely on unmount, otherwise every
   * replaced upload would strand its GPU buffers. The GLB path is false: its
   * geometry lives in the useGLTF cache and must survive us.
   */
  ownsScene?: boolean;
}

export function DressedScene({
  scene,
  finish,
  onFit,
  camera,
  lighting = DEFAULT_LIGHTING,
  stoneColors,
  metalOverrides,
  gemOverrides,
  onStones,
  onParts,
  ownsScene = false,
}: DressedProps) {
  const { object, owned, stones } = useMemo(() => {
    const root = scene.clone(true);
    // Geometry we allocated here, and must therefore dispose. Anything reused
    // from the caller (the useGLTF cache, or an uploaded scene) is not ours to
    // free — disposing a cached geometry would break the next mount.
    const owned = new Set<THREE.BufferGeometry>();
    // Stones are handed to GemRefraction, which swaps in the traced material.
    const stones: THREE.Mesh[] = [];
    /*
     * Label collisions, per scene. A GLB full of "Cube" meshes must still give
     * separately selectable parts rather than one id shared by all of them.
     */
    const seenLabels = new Map<string, number>();

    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = mesh.name.toLowerCase();

      const isStone =
        !camera?.rawGeometry &&
        (name.includes("gem") || name.includes("stone") || name.includes("diamond"));

      /*
       * Raw geometry: one flat clay material on everything, and no stones. The
       * point is to see the mesh a file actually contains before any styling
       * flatters it — which is also the fastest way to tell whether a piece
       * imported badly or was simply modelled that way.
       */
      if (camera?.rawGeometry) {
        if (!mesh.geometry.attributes.normal) {
          const geo = mesh.geometry.clone();
          geo.computeVertexNormals();
          mesh.geometry = geo;
          owned.add(geo);
        }
        mesh.material = new THREE.MeshStandardMaterial({
          color: "#b9b4ad",
          roughness: 0.85,
          metalness: 0,
        });
      } else if (isStone) {
        /*
         * Find the individual stones, for any file that did not arrive with
         * them already found.
         *
         * The .3dm worker does this at decode; a GLB has nobody to do it, so
         * the whole pave was one part and clicking one stone painted all 140.
         * Before faceting, because this reorders the index buffer and
         * `toNonIndexed` preserves triangle order — so the offsets survive it.
         */
        if (!mesh.userData.solids) {
          const solids = ensureSolids(mesh.geometry);
          if (solids) mesh.userData.solids = solids;
        }
        // Faceting rewrites the geometry, so this one really is a new buffer.
        // Cloned after the split, so it inherits the reordered index.
        mesh.geometry = facetGeometry(mesh.geometry.clone());
        owned.add(mesh.geometry);
        // Fallback only; GemRefraction replaces this once the env map is ready.
        mesh.material = createGemMaterial();
        stones.push(mesh);
      } else {
        // Metal is used exactly as supplied — .3dm normals come from the NURBS
        // surface and the GLB ships its own — so there's nothing to copy.
        // Cloning here doubled peak memory on every large upload for nothing.
        if (!mesh.geometry.attributes.normal) {
          const geo = mesh.geometry.clone();
          geo.computeVertexNormals();
          mesh.geometry = geo;
          owned.add(geo);
        }
        /*
         * Metal too — a shank and its prongs are separate solids and should be
         * separately paintable whatever file they arrived in. The shipped
         * model's metal is one mesh of 675 of them, so without this, clicking a
         * single prong repaints the whole piece.
         */
        if (!mesh.userData.solids) {
          const solids = ensureSolids(mesh.geometry);
          if (solids) mesh.userData.solids = solids;
        }
        mesh.material = createMetalMaterial(finish);
        /*
         * A finish needs UVs, and Rhino render meshes almost never carry them
         * — a texture lookup without them samples one texel for the whole mesh,
         * which reads as the texture having failed rather than as missing data.
         * Box-projected from position, scaled to the unit-normalised piece.
         */
        ensureProjectedUVs(mesh.geometry, 8);
      }
      /*
       * Every mesh gets a part identity here, whatever file it came from.
       *
       * The .3dm loader already tagged its own, from the Rhino layer names, and
       * this leaves those alone. It is the GLB and the procedural fallback that
       * had none — and without a tag they were invisible to both selection and
       * the materials panel, so a swatch click wrote an assignment for zero
       * parts and silently changed nothing.
       *
       * Raw-geometry mode is excluded on purpose: it deliberately renders one
       * flat clay material over everything, so there is nothing to assign to.
       */
      if (!camera?.rawGeometry) {
        ensurePart(mesh, isStone ? "stone" : "metal", seenLabels);
      }

      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    // Recenter at the origin so orbiting feels balanced.
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.position.sub(center);

    const wrapper = new THREE.Group();
    wrapper.add(root);
    // Applied to the inner root so the wrapper stays free for the spin, and set
    // before the fit below measures the rotated bounding box.
    root.rotation.set(...upAxisRotation(camera?.upAxis ?? "y"));
    return { object: wrapper, owned, stones };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, camera?.rawGeometry, camera?.upAxis]);

  // Report the piece's extent so the camera can frame the whole product.
  //
  // This used to zoom to the `gem` mesh whenever it was small relative to the
  // model, assuming a small stone meant "pendant". That fails on any piece
  // where the stone isn't the visual centre — on LP043 the stone sits inside
  // the chain loop, so it framed empty space with the chain jammed against the
  // edges and the pendant itself off-screen. Fit the product; let the user
  // pinch or scroll in on a stone if they want to.
  useEffect(() => {
    const box = new THREE.Box3().setFromObject(object);
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 1;

    // A cylinder about Y bounds a turntable far more tightly than a sphere:
    // spinning only sweeps the XZ footprint, so height stays height. On a
    // portrait phone that difference is what keeps the piece from looking tiny.
    const halfX = Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
    const halfZ = Math.max(Math.abs(box.min.z), Math.abs(box.max.z));
    onFit({
      radius,
      radiusXZ: Math.hypot(halfX, halfZ) || radius,
      halfHeight: Math.max(Math.abs(box.min.y), Math.abs(box.max.y)) || radius,
    });
  }, [object, onFit]);

  /*
   * Publish the selectable stone groups.
   *
   * Read off the built scene rather than passed alongside it, because the scene
   * the viewer renders is a clone — anything carried separately would point at
   * the original's meshes and recolour nothing.
   */
  useEffect(() => {
    onStones?.(collectStoneGroups(object));
    onParts?.(collectParts(object));
  }, [object, onStones, onParts]);

  /*
   * Spin the piece, not the camera.
   *
   * Deliberately separate from the turntable, which orbits the camera: a
   * jeweller checking a setting wants the piece to turn under a fixed light,
   * and the two are different shots.
   *
   * This runs on the render loop, which an export bypasses — frames there are
   * drawn straight through `gl.render`. So a download captures the orientation
   * the piece is at, and never a smear of it advancing mid-clip.
   */
  useFrame((_, delta) => {
    const axis = camera?.spinAxis ?? "none";
    if (axis === "none") return;
    object.rotation[axis] += (camera?.spinSpeed ?? 0) * Math.PI * 2 * Math.min(delta, 0.1);
  });

  // Reset the spin when it is switched off, so the piece does not stay skewed.
  useEffect(() => {
    if ((camera?.spinAxis ?? "none") === "none") object.rotation.set(0, 0, 0);
  }, [object, camera?.spinAxis]);

  /*
   * Live metal updates, without rebuilding the scene.
   *
   * A part with a library material assigned uses it; everything else falls back
   * to the global finish, which is what a freshly opened piece has.
   *
   * This used to identify metal by sniffing `metalness === 1`. That stopped
   * being safe the moment the custom editor could set metalness below 1 — the
   * black-rhodium entry alone would have dropped straight out of every
   * subsequent update and frozen at whatever it was first given. Metal is now
   * identified by what it is, from `userData.part`, with the sniff kept only
   * for GLB and fallback scenes that carry no part tags.
   */
  useEffect(() => {
    // Materials this pass created, so the previous set can be freed. Anything
    // the scene build put on a mesh is not ours to dispose.
    const built: THREE.Material[] = [];

    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const existing = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
        THREE.MeshPhysicalMaterial | undefined;
      if (!existing) return;

      const part = mesh.userData?.part as { id: string; kind: string } | undefined;
      const isMetal = part ? part.kind === "metal" : existing.metalness === 1;
      if (!isMetal) return;

      /*
       * One material per distinct assignment, not one per solid.
       *
       * The mesh is a whole Rhino layer — "Metal 01" is 285 separate solids —
       * so recolouring one of them means splitting the draw into ranges. The
       * decoder made each solid a contiguous run of the index buffer, so the
       * untouched stretches between customised ones stay merged: three
       * recoloured prongs out of 285 cost seven draw calls, not 285.
       */
      const { base, perSolid } = assignmentsFor(metalOverrides ?? {}, part?.id ?? "", parseId);
      const runs = planRuns(
        mesh.userData?.solids as ArrayLike<number> | undefined,
        drawableCount(mesh.geometry),
        base,
        perSolid,
      );
      const specs = runMaterials(runs);
      const slots = runSlots(runs, specs);

      const made = specs.map((spec) => {
        const m = createMetalMaterial(finish);
        if (spec) {
          m.color.set(spec.color);
          m.roughness = spec.roughness;
          m.metalness = spec.metalness;
        }

        /*
         * The finish for this run: the part's own if it has one, otherwise the
         * global surface, which is what a piece has before anyone has touched
         * a part.
         */
        const tex: TextureAssignment | undefined =
          spec?.texture ??
          (finish.surface ? { ...DEFAULT_TEXTURE, finish: finish.surface } : undefined);

        if (!isTextureInert(tex) && tex) {
          const maps = getFinishMaps(tex.finish, tex.channels, tex.scale / 8);
          m.normalMap = maps?.normalMap ?? null;
          m.roughnessMap = maps?.roughnessMap ?? null;
          m.bumpMap = maps?.bumpMap ?? null;
          /*
           * Height, not colour, for a worked METAL finish: hammering changes
           * how light is caught, it does not paint. Only the colour textures —
           * velvet, wood — set a base-colour map, and they are surfaces in
           * their own right rather than a finish over gold.
           */
          if (maps?.map) m.map = maps.map;
          m.normalScale = new THREE.Vector2(tex.strength, tex.strength);
          m.bumpScale = tex.strength * 0.02;
        } else {
          m.normalMap = null;
          m.roughnessMap = null;
          m.bumpMap = null;
        }

        m.needsUpdate = true;
        built.push(m);
        return m;
      });
      if (!made.length) return;

      mesh.geometry.clearGroups();
      if (made.length > 1) {
        runs.forEach((run, i) => mesh.geometry.addGroup(run.start, run.count, slots[i]));
        mesh.material = made;
      } else {
        // An untouched piece stays exactly the single-material mesh it was.
        mesh.material = made[0];
      }
    });

    return () => {
      // Freed on the next pass rather than left to pile up — this effect runs
      // again on every swatch click.
      for (const m of built) m.dispose();
    };
  }, [object, finish, metalOverrides]);

  useEffect(() => {
    return () => {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        // Materials are always ours. Geometry only when we allocated it —
        // freeing a geometry still held by the useGLTF cache would leave the
        // next mount of this model with an emptied buffer.
        if (mesh.geometry && (ownsScene || owned.has(mesh.geometry))) mesh.geometry.dispose();
        (mesh.material as THREE.Material)?.dispose();
      });
      owned.clear();
    };
  }, [object, owned, ownsScene]);

  /*
   * What the stones refract.
   *
   * `useEnvironment` is called unconditionally with a real preset even when the
   * tent is chosen — hooks cannot be skipped, and the preset it loads is the one
   * the scene is already using, so nothing extra is fetched.
   */
  const gemChoice = lighting.separateGemEnvironment
    ? environmentById(lighting.gemEnvironment)
    : environmentById(lighting.environment);
  const presetMap = useEnvironment({
    preset: (gemChoice.preset ??
      environmentById(lighting.environment).preset ??
      "warehouse") as "warehouse",
  });
  const envMap = gemChoice.preset === null ? getLightTent() : presetMap;

  return (
    <>
      <primitive object={object} />
      <GemRefraction
        overrides={stoneColors}
        optics={gemOverrides}
        meshes={stones}
        envMap={envMap}
      />
    </>
  );
}

export function GLBModel({
  url,
  finish,
  onFit,
  camera,
  lighting = DEFAULT_LIGHTING,
  stoneColors,
  metalOverrides,
  gemOverrides,
  onStones,
  onParts,
}: {
  url: string;
  finish: Finish;
  onFit: (fit: Fit) => void;
  camera?: CameraSettings;
  lighting?: LightingSettings;
  stoneColors?: Record<string, string>;
  metalOverrides?: DressedProps["metalOverrides"];
  gemOverrides?: DressedProps["gemOverrides"];
  onStones?: (groups: StoneGroup[]) => void;
  onParts?: (parts: Part[]) => void;
}) {
  // The shipped GLB is Draco-compressed, so a decoder is required rather than
  // optional. Pin it to the same build UploadPiece prefetches on idle, so the
  // two paths share one download instead of pulling drei's default 1.5.5 too.
  const { scene } = useGLTF(url, DRACO_LIB);
  return (
    <DressedScene
      scene={scene}
      finish={finish}
      onFit={onFit}
      camera={camera}
      lighting={lighting}
      stoneColors={stoneColors}
      metalOverrides={metalOverrides}
      gemOverrides={gemOverrides}
      onStones={onStones}
      onParts={onParts}
    />
  );
}

export function FallbackModel({
  finish,
  onFit,
  camera,
  lighting = DEFAULT_LIGHTING,
  stoneColors,
  metalOverrides,
  gemOverrides,
  onStones,
  onParts,
}: {
  finish: Finish;
  onFit: (fit: Fit) => void;
  camera?: CameraSettings;
  lighting?: LightingSettings;
  stoneColors?: Record<string, string>;
  metalOverrides?: DressedProps["metalOverrides"];
  gemOverrides?: DressedProps["gemOverrides"];
  onStones?: (groups: StoneGroup[]) => void;
  onParts?: (parts: Part[]) => void;
}) {
  const scene = useFallbackScene();
  return (
    <DressedScene
      scene={scene}
      finish={finish}
      onFit={onFit}
      camera={camera}
      lighting={lighting}
      stoneColors={stoneColors}
      metalOverrides={metalOverrides}
      gemOverrides={gemOverrides}
      onStones={onStones}
      onParts={onParts}
      ownsScene
    />
  );
}

export function ObjectModel({
  object,
  finish,
  onFit,
  camera,
  lighting = DEFAULT_LIGHTING,
  stoneColors,
  metalOverrides,
  gemOverrides,
  onStones,
  onParts,
}: {
  object: THREE.Object3D;
  finish: Finish;
  onFit: (fit: Fit) => void;
  camera?: CameraSettings;
  lighting?: LightingSettings;
  stoneColors?: Record<string, string>;
  metalOverrides?: DressedProps["metalOverrides"];
  gemOverrides?: DressedProps["gemOverrides"];
  onStones?: (groups: StoneGroup[]) => void;
  onParts?: (parts: Part[]) => void;
}) {
  return (
    <DressedScene
      scene={object}
      finish={finish}
      onFit={onFit}
      camera={camera}
      lighting={lighting}
      stoneColors={stoneColors}
      metalOverrides={metalOverrides}
      gemOverrides={gemOverrides}
      onStones={onStones}
      onParts={onParts}
      ownsScene
    />
  );
}

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import type { Finish } from "@/data/finishes";
import { DRACO_LIB } from "@/lib/loadJewelryFile";
import { createGemMaterial, createMetalMaterial, facetGeometry } from "./materials";
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
  /**
   * True when the caller hands us a scene nobody else holds — an upload or the
   * procedural stand-in. Those we free entirely on unmount, otherwise every
   * replaced upload would strand its GPU buffers. The GLB path is false: its
   * geometry lives in the useGLTF cache and must survive us.
   */
  ownsScene?: boolean;
}

export function DressedScene({ scene, finish, onFit, ownsScene = false }: DressedProps) {
  const { object, owned } = useMemo(() => {
    const root = scene.clone(true);
    // Geometry we allocated here, and must therefore dispose. Anything reused
    // from the caller (the useGLTF cache, or an uploaded scene) is not ours to
    // free — disposing a cached geometry would break the next mount.
    const owned = new Set<THREE.BufferGeometry>();

    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = mesh.name.toLowerCase();

      if (name.includes("gem") || name.includes("stone") || name.includes("diamond")) {
        // Faceting rewrites the geometry, so this one really is a new buffer.
        mesh.geometry = facetGeometry(mesh.geometry.clone());
        owned.add(mesh.geometry);
        mesh.material = createGemMaterial();
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
        mesh.material = createMetalMaterial(finish);
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
    return { object: wrapper, owned };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

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

  // Live metal finish updates without rebuilding the scene.
  useEffect(() => {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshPhysicalMaterial;
      if (mat && mat.metalness === 1) {
        mat.color.set(finish.color);
        mat.roughness = finish.roughness;
        mat.needsUpdate = true;
      }
    });
  }, [object, finish]);

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

  return <primitive object={object} />;
}

export function GLBModel({
  url,
  finish,
  onFit,
}: {
  url: string;
  finish: Finish;
  onFit: (fit: Fit) => void;
}) {
  // The shipped GLB is Draco-compressed, so a decoder is required rather than
  // optional. Pin it to the same build UploadPiece prefetches on idle, so the
  // two paths share one download instead of pulling drei's default 1.5.5 too.
  const { scene } = useGLTF(url, DRACO_LIB);
  return <DressedScene scene={scene} finish={finish} onFit={onFit} />;
}

export function FallbackModel({ finish, onFit }: { finish: Finish; onFit: (fit: Fit) => void }) {
  const scene = useFallbackScene();
  return <DressedScene scene={scene} finish={finish} onFit={onFit} ownsScene />;
}

export function ObjectModel({
  object,
  finish,
  onFit,
}: {
  object: THREE.Object3D;
  finish: Finish;
  onFit: (fit: Fit) => void;
}) {
  return <DressedScene scene={object} finish={finish} onFit={onFit} ownsScene />;
}

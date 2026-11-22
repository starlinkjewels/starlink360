import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { UNIT_MM, buildPieces, disposePiece, type ChainLength, type Kit } from "./jewelry";
import type { Category } from "./catalog";

/*
 * The try-on's procedural pieces, made into ordinary studio pieces.
 *
 * The try-on draws stones and repeated settings as InstancedMeshes, which is
 * right for a live camera and wrong for the studio: the studio finds stones
 * by mesh name, splits each mesh into its separate solids so a single stone
 * can be painted, facets it, measures it, and exports it, all on plain
 * meshes. So the piece is baked flat: every instance's transform applied to a
 * copy of its geometry, then merged into one metal mesh and one stone mesh,
 * exactly the shape a file from Rhino arrives in.
 *
 * Stones are named `gem-ffffff`, which the studio reads as a colourless stone
 * (GemRefraction's stoneColor). The model unit is recorded in millimetres so
 * Model Dimensions reports the real size without anyone typing it in.
 */

export interface ProceduralSpec {
  category: Category;
  style: string;
  carat: number;
  chain?: ChainLength;
}

/** Placeholder materials: the studio dresses every mesh itself. */
function placeholderKit(): Kit {
  const m = new THREE.MeshBasicMaterial();
  return { metal: m, centre: m, accent: m };
}

/** Geometry with exactly the attributes listed, so parts can be merged. */
function only(geo: THREE.BufferGeometry, names: string[]): THREE.BufferGeometry {
  for (const name of Object.keys(geo.attributes)) {
    if (!names.includes(name)) geo.deleteAttribute(name);
  }
  return geo;
}

function bake(root: THREE.Object3D): { metal: THREE.BufferGeometry; stones: THREE.BufferGeometry } {
  root.updateMatrixWorld(true);
  const metal: THREE.BufferGeometry[] = [];
  const stones: THREE.BufferGeometry[] = [];
  const instance = new THREE.Matrix4();

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.userData.occluder) return;
    const isStone = !!o.userData.stones;
    const emit = (matrix: THREE.Matrix4) => {
      // Stones stay non-indexed (flat facets); metal keeps its index and UVs.
      const g = isStone
        ? only(mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone(), [
            "position",
            "normal",
          ])
        : only(mesh.geometry.clone(), ["position", "normal", "uv"]);
      g.applyMatrix4(matrix);
      (isStone ? stones : metal).push(g);
    };
    const inst = mesh as THREE.InstancedMesh;
    if (inst.isInstancedMesh) {
      for (let i = 0; i < inst.count; i++) {
        inst.getMatrixAt(i, instance);
        emit(new THREE.Matrix4().multiplyMatrices(inst.matrixWorld, instance));
      }
    } else {
      emit(mesh.matrixWorld);
    }
  });

  // Metal parts all arrive indexed; any that did not are given an index.
  for (const g of metal) {
    if (!g.index) g.setIndex([...Array(g.getAttribute("position").count).keys()]);
  }
  const metalGeo = mergeGeometries(metal, false) ?? new THREE.BufferGeometry();
  const stoneGeo = mergeGeometries(stones, false) ?? new THREE.BufferGeometry();
  /*
   * The studio splits a mesh into its solids by welding vertices by position
   * over an INDEX buffer, and declines on a geometry without one. A trivial
   * index is enough: each stone's facets share positions along their edges,
   * and separate stones share none, so every stone comes out as one solid.
   */
  stoneGeo.setIndex([...Array(stoneGeo.getAttribute("position")?.count ?? 0).keys()]);
  metal.forEach((g) => g.dispose());
  stones.forEach((g) => g.dispose());
  return { metal: metalGeo, stones: stoneGeo };
}

const cache = new Map<string, THREE.Group>();

/**
 * A studio-ready piece: a group holding one metal mesh and one stone mesh.
 *
 * Cached, and never disposed by the studio (it treats a supplied scene as the
 * caller's), so switching back to it costs nothing.
 */
export function buildStudioPiece(spec: ProceduralSpec): THREE.Group {
  const key = JSON.stringify(spec);
  const hit = cache.get(key);
  if (hit) return hit;

  const kit = placeholderKit();
  const pieces = buildPieces(
    {
      category: spec.category,
      style: spec.style,
      carat: spec.carat,
      chain: spec.chain ?? "princess",
    },
    kit,
  );
  const holder = new THREE.Group();
  const piece = pieces[0].root;
  holder.add(piece);
  if (spec.category === "ring") {
    /*
     * Try-on axes put the finger along +Y and the stone on +Z. A product shot
     * stands the ring up instead: stone on top, seen three-quarter on.
     */
    piece.rotation.set(-Math.PI / 2, 0, 0);
    holder.rotation.set(0, -0.6, 0);
  }

  const { metal, stones } = bake(holder);
  pieces.forEach(disposePiece);
  (kit.metal as THREE.Material).dispose();

  const group = new THREE.Group();
  const metalMesh = new THREE.Mesh(metal, new THREE.MeshStandardMaterial());
  metalMesh.name = "Metal";
  const stoneMesh = new THREE.Mesh(stones, new THREE.MeshStandardMaterial());
  stoneMesh.name = "gem-ffffff";
  group.add(metalMesh, stoneMesh);
  // Real size: one model unit is UNIT_MM millimetres (see jewelry.ts).
  group.userData.detectedMMPerUnit = UNIT_MM[spec.category];
  cache.set(key, group);
  return group;
}

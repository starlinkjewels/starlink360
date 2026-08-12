import { useEffect, useRef } from "react";
import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { collectParts, type Part } from "./selection";
import { MAX_DEPTH, type Stamp } from "./stamps";
import { stampMaps } from "./stampTexture";

/*
 * Hallmarks, struck into the piece.
 *
 * A decal per stamp: a thin skin of geometry clipped out of the metal's own
 * surface, so the mark follows a curved shank instead of floating over it as a
 * flat quad would. `DecalGeometry` does that clipping against the target mesh,
 * which is why each stamp remembers the part it was struck into rather than
 * just a point in space.
 *
 * The decal carries no colour of its own. It borrows the metal's material and
 * overlays a normal and roughness map, so the mark is a change in how light is
 * caught — struck metal, not printed text. A gold shank stays gold inside the
 * hallmark, which is what makes it read as displaced rather than applied.
 */

/** Where the decal sits relative to the surface it copies. */
const POLYGON_OFFSET = -4;

export function StampDecals({
  root,
  stamps,
  font,
  selectedId,
}: {
  /** The dressed scene, whose parts the stamps are pinned to. */
  root: THREE.Object3D;
  stamps: Stamp[];
  font: string;
  /** Lit while its row is focused in the panel, so it can be found on a pave. */
  selectedId?: string | null;
}) {
  const attached = useRef<{ parent: THREE.Object3D; mesh: THREE.Mesh }[]>([]);

  useEffect(() => {
    let live = true;
    const parts = new Map<string, Part>(collectParts(root).map((p) => [p.id, p]));
    const built: { parent: THREE.Object3D; mesh: THREE.Mesh }[] = [];

    const make = async () => {
      for (const stamp of stamps) {
        const part = parts.get(stamp.partId);
        // A stamp whose part is gone renders nothing. `pruneStamps` clears
        // these from the list, but a render can happen in between.
        if (!part?.mesh) continue;

        const maps = await stampMaps(stamp, font);
        if (!live) return;
        if (!maps) continue;

        const target = part.mesh;
        target.updateWorldMatrix(true, false);

        /*
         * The stamp is stored in the part's LOCAL space so it survives the
         * recentring, the fit scale and the turntable. `DecalGeometry` works in
         * WORLD space — three's own example adds the result straight to the
         * scene — so it has to be lifted before projecting and the result put
         * back afterwards.
         */
        const local = new THREE.Vector3().fromArray(stamp.position);
        const position = local.clone().applyMatrix4(target.matrixWorld);
        const normal = new THREE.Vector3()
          .fromArray(stamp.normal)
          .transformDirection(target.matrixWorld)
          .normalize();

        /*
         * The decal's frame looks ALONG the surface normal, then turns about it
         * by the stamp's rotation. Built with a lookAt rather than by hand
         * because getting the Euler wrong tilts the mark off the surface.
         */
        const orient = new THREE.Object3D();
        orient.position.copy(position);
        orient.lookAt(position.clone().add(normal));
        orient.rotateZ(THREE.MathUtils.degToRad(stamp.rotation));

        /*
         * Size is in millimetres, because the file is in millimetres and a
         * hallmark is specified in them — but the projector measures in world
         * units, and the piece is scaled to fit the view on load. So the
         * millimetres are converted through the part's own world scale;
         * without that a 1.2mm mark is whatever size the fit happened to pick.
         */
        const worldScale = new THREE.Vector3();
        target.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), worldScale);
        const mm = stamp.size * worldScale.x;
        /*
         * The third axis is how far through the mesh the projector cuts. It has
         * to clear the wall thickness of a shank or the mark is clipped away
         * where the surface curves; anything it wrongly catches is on the far
         * side of the metal and hidden.
         */
        const extent = new THREE.Vector3(mm * 2.2, mm * 2.2, mm * 4);

        let geometry: THREE.BufferGeometry;
        try {
          geometry = new DecalGeometry(target, position, orient.rotation, extent);
        } catch {
          // A degenerate projection — a stamp placed on a sliver of geometry —
          // must not take the whole scene down with it.
          continue;
        }
        if (!geometry.getAttribute("position")?.count) {
          geometry.dispose();
          continue;
        }
        // Back into the part's space, so the mark rides the piece through every
        // transform instead of hanging in the world where it was struck.
        geometry.applyMatrix4(new THREE.Matrix4().copy(target.matrixWorld).invert());

        const base = (Array.isArray(target.material) ? target.material[0] : target.material) as
          THREE.MeshPhysicalMaterial | undefined;

        /*
         * The metal's own material, cloned, with the mark laid over it. Cloned
         * rather than shared because the maps and the polygon offset belong to
         * this decal alone — setting them on the original would stamp the
         * hallmark across the entire part.
         */
        const material = base?.clone() ?? new THREE.MeshPhysicalMaterial({ metalness: 1 });
        material.normalMap = maps.normalMap;
        material.roughnessMap = maps.roughnessMap;
        /*
         * Depth drives the normal, so the same texture serves any depth and
         * dragging the slider does not rebuild it. A negative depth flips the
         * normal and the punch reads as raised — which is what a cast piece
         * carries from its mould.
         */
        const strength = (stamp.depth / MAX_DEPTH) * 2;
        material.normalScale = new THREE.Vector2(strength, strength);
        material.map = null;
        material.bumpMap = null;
        /*
         * The decal shares its surface with the metal exactly, so without an
         * offset the two z-fight and the mark flickers as the piece turns.
         */
        material.polygonOffset = true;
        material.polygonOffsetFactor = POLYGON_OFFSET;
        material.polygonOffsetUnits = POLYGON_OFFSET;
        material.transparent = true;
        material.depthWrite = false;

        if (stamp.id === selectedId) {
          // Enough to find it on a busy piece, not so much that it reads as the
          // finished look. Dropped the moment the row loses focus.
          material.emissive = new THREE.Color("#22d3ee");
          material.emissiveIntensity = 0.35;
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.stampId = stamp.id;
        // Drawn after the metal, before the selection tint.
        mesh.renderOrder = 5;
        // Never pickable: a click on a hallmark is a click on the part under
        // it, or placing a stamp on top of a stamp would be impossible to undo.
        mesh.raycast = () => {};
        target.add(mesh);
        built.push({ parent: target, mesh });
      }
      if (live) attached.current = built;
    };

    void make();

    return () => {
      live = false;
      for (const { parent, mesh } of [...built, ...attached.current]) {
        parent.remove(mesh);
        mesh.geometry.dispose();
        /*
         * The material is ours — a clone — so it is freed here. Its maps are
         * NOT: they are cached and shared across every stamp using the same
         * mark, and disposing them would blank the others.
         */
        (mesh.material as THREE.Material).dispose();
      }
      attached.current = [];
    };
  }, [root, stamps, font, selectedId]);

  return null;
}

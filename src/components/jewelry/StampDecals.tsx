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

/**
 * The triangles near the strike point, as a mesh of their own.
 *
 * `DecalGeometry` clips the projector against EVERY triangle of the target. On
 * the shipped model the metal is 1.5 million of them and a hallmark covers a
 * few dozen, so striking one measured 5.9 SECONDS — on the main thread, with no
 * GPU, and paid again for every stamp each time the effect re-runs. Dragging
 * the size slider would have re-struck every mark on the piece and locked the
 * tab for minutes.
 *
 * A bounding-box cull first turns that into a few milliseconds. Correctness is
 * unaffected: the projector cannot reach a triangle outside its own extent, so
 * every triangle dropped here would have been clipped away regardless.
 *
 * Returns null when the cull finds nothing, which means the point is not on
 * this mesh and the caller should skip rather than project against emptiness.
 */
function nearbyGeometry(
  target: THREE.Mesh,
  centre: THREE.Vector3,
  reach: number,
): THREE.BufferGeometry | null {
  const geo = target.geometry;
  const pos = geo.getAttribute("position");
  if (!pos) return null;
  const index = geo.getIndex();
  const triangles = index ? index.count / 3 : pos.count / 3;

  // In the target's own space, because that is the space its vertices are in.
  const local = target.worldToLocal(centre.clone());
  const box = new THREE.Box3(local.clone().subScalar(reach), local.clone().addScalar(reach));

  const kept: number[] = [];
  const v = new THREE.Vector3();
  for (let t = 0; t < triangles; t++) {
    for (let c = 0; c < 3; c++) {
      const vi = index ? index.getX(t * 3 + c) : t * 3 + c;
      v.fromBufferAttribute(pos, vi);
      // Any vertex inside the box keeps the whole triangle: a triangle
      // straddling the edge still contributes to the mark.
      if (box.containsPoint(v)) {
        kept.push(index ? index.getX(t * 3) : t * 3);
        kept.push(index ? index.getX(t * 3 + 1) : t * 3 + 1);
        kept.push(index ? index.getX(t * 3 + 2) : t * 3 + 2);
        break;
      }
    }
  }
  if (!kept.length) return null;

  // Shares the position buffer — only the short index is new.
  const near = new THREE.BufferGeometry();
  near.setAttribute("position", pos);
  const normal = geo.getAttribute("normal");
  if (normal) near.setAttribute("normal", normal);
  const uv = geo.getAttribute("uv");
  if (uv) near.setAttribute("uv", uv);
  near.setIndex(kept);
  return near;
}

export function StampDecals({
  root,
  stamps,
  font,
}: {
  /** The dressed scene, whose parts the stamps are pinned to. */
  root: THREE.Object3D;
  stamps: Stamp[];
  font: string;
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
        /*
         * Along the OUTWARD normal, which is what DecalGeometry expects.
         *
         * Turning it inward to cure the mirrored lettering was the wrong fix:
         * it flipped the decal's faces to point into the metal, so they were
         * backface-culled and the mark vanished entirely while still appearing
         * in the list. The mirroring is a property of the TEXTURE, and is
         * corrected in the height field where it belongs.
         */
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
        /*
         * Scaled so the LETTERING measures `size`, not the map.
         *
         * The map is square and the text is fitted inside it, so a long word is
         * width-limited and its capitals fill only a fraction of the height.
         * Cutting the decal to the map gave "@bkpatel" a cap height an eighth
         * of what the panel promised — an illegible speck — while "750" looked
         * correct, because a short mark fills the box.
         */
        const cap = Math.max(maps.capFraction, 0.02);
        const across = (mm / cap) * 1.05;
        const extent = new THREE.Vector3(across, across, mm * 4);

        /*
         * Projected against only the triangles the mark can reach. The full
         * mesh took nearly six seconds per stamp on the shipped model; this is
         * the same result in milliseconds.
         */
        /*
         * The reach is converted into the target's OWN units first.
         *
         * `nearbyGeometry` searches in local space, and `extent` is in world
         * space. The piece is scaled to fit — 0.008 on the shipped necklace —
         * so passing a world reach of 0.05 searched a box 0.05 MILLIMETRES
         * wide on a model measured in millimetres. It culled away the whole
         * mark and left a six-triangle sliver: a speck on the metal, with the
         * panel reporting the stamp as struck.
         */
        const reach = extent.length() / Math.max(worldScale.x, 1e-6);
        const near = nearbyGeometry(target, position, reach);
        if (!near) continue;
        const proxy = new THREE.Mesh(near);
        proxy.applyMatrix4(target.matrixWorld);
        proxy.updateWorldMatrix(false, false);

        let geometry: THREE.BufferGeometry;
        try {
          geometry = new DecalGeometry(proxy, position, orient.rotation, extent);
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
        /*
         * Gain, not depth in millimetres.
         *
         * The height field is deliberately soft — two blur passes over a 512
         * map, so a punch has a shoulder rather than a one-pixel cliff — which
         * makes its gradients gentle by construction. A mark is also the SAME
         * GOLD as the metal around it, lit the same way, on a near-mirror
         * surface: the only thing distinguishing it is the perturbed normal.
         *
         * At the old factor of 2 a shallow 0.05mm punch came out at 0.4 and was
         * invisible, while 0.12mm at 0.96 read fine. Six puts a shallow mark at
         * 1.2 and keeps the deepest inside a range that still looks struck
         * rather than melted.
         */
        const strength = (stamp.depth / MAX_DEPTH) * 6;
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

        /*
         * No highlight for the selected mark.
         *
         * A cyan emissive was meant to help find one on a busy piece. It tints
         * the WHOLE projected patch rather than outlining the lettering, so a
         * selected hallmark rendered as a large blue sticker stuck over the
         * metal — worse than not finding it, because it looks like a fault in
         * the render. Finding a mark is what the list and its coordinates are
         * for.
         */

        /*
         * Dev only: which half failed.
         *
         * A mark that does not appear has two completely different causes with
         * opposite fixes — the projection produced nothing, or it produced
         * geometry that is not being drawn. Guessing between them has cost more
         * time than any other single thing in this feature.
         */
        if (import.meta.env.DEV) {
          const wp = new THREE.Vector3();
          target.getWorldPosition(wp);
          console.log(
            `[stamp] ${stamp.id} on ${stamp.partId}: ` +
              `${geometry.getAttribute("position").count} verts, ` +
              `size=${stamp.size}mm cap=${maps.capFraction.toFixed(2)} ` +
              `extent=${across.toFixed(3)} reach=${reach.toFixed(2)} ` +
              `worldScale=${worldScale.x.toFixed(4)} ` +
              `normalScale=${strength.toFixed(2)} culled=${near.getIndex()?.count ?? 0}`,
          );
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
    /*
     * Deliberately NOT keyed on which mark is selected. Selecting one changes
     * nothing about how it renders, and re-running here would reproject every
     * stamp on the piece for a panel highlight.
     */
  }, [root, stamps, font]);

  return null;
}

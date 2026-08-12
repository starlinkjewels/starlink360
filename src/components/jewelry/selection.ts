import * as THREE from "three";

/*
 * What can be selected, and what is.
 *
 * A "part" is one mesh in the built scene: a group of stones sharing a colour
 * and a layer, or a group of metal sharing a colour and a layer. That grouping
 * is the jeweller's own — "Gem 01", "Metal 02", "Heads" — because it is the only
 * division in the file that means anything to the person clicking.
 *
 * Finer than that is not available and should not be faked. A pavé field is two
 * hundred solids merged into one draw call; splitting them to allow picking one
 * would cost two hundred draw calls and two hundred BVHs on a phone, to support
 * something nobody asks for.
 */

export type PartKind = "metal" | "stone";

/*
 * ── One stone, not one layer ────────────────────────────────────────────────
 *
 * A group is a Rhino layer, and a layer is not a part. "Gem 03" on the client's
 * file is 140 separate diamonds; "Metal 01" is 285 separate solids. Selecting
 * the layer selects all of them, which is right for "make every stone ruby" and
 * useless for "make THIS one ruby".
 *
 * The decoder now hands back, per group, the index-buffer offset of each solid,
 * with the triangles reordered so a solid is one contiguous run. That makes a
 * single stone addressable as an offset and a count — no extra geometry, no
 * extra draw call to point at one.
 *
 * A solid's id is its group's id with `#n` after it. The suffix is what tells
 * the two apart everywhere else, and `n` is stable across loads because the
 * decoder numbers solids in first-seen triangle order.
 */

/*
 * The suffix is "#solid<n>", not "#<n>".
 *
 * A group id ends with its colour — "Metal 01|#93939b" — and a bare "#999"
 * parses as the number 999. A plain "#" separator therefore read the COLOUR as
 * a solid index and pointed the selection at a group called "Metal 01|" that
 * does not exist. A Rhino layer would have to be named to end in "#solid12" to
 * collide with this, which is a fair trade for an id that stays readable.
 */
const SOLID_SUFFIX = /#solid(\d+)$/;

export function solidId(groupId: string, solid: number): string {
  return `${groupId}#solid${solid}`;
}

/** Splits an id back into its group and, if it has one, its solid. */
export function parseId(id: string): { group: string; solid: number | null } {
  const m = SOLID_SUFFIX.exec(id);
  if (!m) return { group: id, solid: null };
  return { group: id.slice(0, m.index), solid: Number(m[1]) };
}

/**
 * Which solid a raycast hit.
 *
 * `faceIndex` is a triangle number, so it is compared against offsets divided
 * by three. Binary search rather than a scan: a pave field is hundreds of
 * solids and this runs on every hover, not just every click.
 */
export function solidAt(solids: ArrayLike<number> | undefined, faceIndex: number): number | null {
  if (!solids || solids.length < 2) return null;
  const target = faceIndex * 3;
  let lo = 0;
  let hi = solids.length - 2;
  if (target < solids[0] || target >= solids[solids.length - 1]) return null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (target < solids[mid]) hi = mid - 1;
    else if (target >= solids[mid + 1]) lo = mid + 1;
    else return mid;
  }
  return null;
}

/** Where a solid lives in the index buffer, for a draw range. */
export function solidRange(
  solids: ArrayLike<number> | undefined,
  solid: number,
): { start: number; count: number } | null {
  if (!solids || solid < 0 || solid + 1 >= solids.length) return null;
  return { start: solids[solid], count: solids[solid + 1] - solids[solid] };
}

export interface Part {
  id: string;
  label: string;
  kind: PartKind;
  mesh: THREE.Mesh;
  /** Index-buffer offsets of the separate solids inside this group. */
  solids?: ArrayLike<number>;
}

/** How many separately selectable solids a group holds. */
export function solidCount(part: Part): number {
  return part.solids && part.solids.length > 1 ? part.solids.length - 1 : 1;
}

/*
 * ── Giving an untagged scene its parts ──────────────────────────────────────
 *
 * The .3dm loader tags every mesh it builds, because it knows the Rhino layer
 * each one came from. Nothing else does: a GLB carries whatever names the
 * exporter wrote, and the procedural fallback piece has none at all.
 *
 * Those scenes were therefore invisible to selection AND to the materials
 * panel — clicking a metal swatch on a GLB wrote an assignment for zero parts
 * and changed nothing, with no error to explain it. Tagging happens in the
 * viewer now, where every path converges, so a piece is selectable whatever
 * file it arrived in.
 */

/** A readable name from whatever the exporter called the mesh. */
export function synthLabel(rawName: string, kind: PartKind): string {
  const cleaned = rawName
    // Exporter decoration: "Cube.001", "mesh_0", "polySurface12".
    .replace(/[._-]?\d+$/, "")
    .replace(/^(mesh|node|object|polysurface)[._-]?/i, "")
    // The prefixes our own .3dm path writes, which are plumbing, not names.
    .replace(/^(metal|gem)-/i, "")
    .replace(/[_-]+/g, " ")
    .trim();

  if (cleaned && !/^[0-9a-f]{6}$/i.test(cleaned)) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return kind === "metal" ? "Metal" : "Stones";
}

/**
 * A collision-free id for a label.
 *
 * Two meshes called "Cube" have to stay separately selectable, so the second
 * one becomes "Cube 2" rather than quietly sharing the first one's identity —
 * which would make a material land on both.
 */
export function uniqueLabel(label: string, seen: Map<string, number>): string {
  const n = (seen.get(label) ?? 0) + 1;
  seen.set(label, n);
  return n === 1 ? label : `${label} ${n}`;
}

/** The colour a mesh name encodes, for stones the .3dm path named. */
function nameColor(rawName: string): string {
  const m = /gem-([0-9a-f]{6})/i.exec(rawName);
  return m ? `#${m[1].toLowerCase()}` : "#ffffff";
}

/**
 * Tags one mesh, if it is not tagged already.
 *
 * Never overwrites: a .3dm mesh already carries the jeweller's own layer name,
 * which is always better than anything derived from a mesh name.
 */
export function ensurePart(mesh: THREE.Mesh, kind: PartKind, seen: Map<string, number>): void {
  if (mesh.userData.part) return;

  const label = uniqueLabel(synthLabel(mesh.name ?? "", kind), seen);
  const id = `${kind}|${label}`;
  mesh.userData.part = { id, label, kind };

  /*
   * Stones need the second identity too. GemRefraction looks up its colour
   * override by `userData.stone.id`, so an untagged stone could never be
   * recoloured — the same silent nothing as above.
   */
  if (kind === "stone" && !mesh.userData.stone) {
    mesh.userData.stone = { id, label, hex: nameColor(mesh.name ?? "") };
  }
}

/** Reads the selectable parts off a built scene, in the order they were added. */
export function collectParts(root: THREE.Object3D): Part[] {
  const parts: Part[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const info = mesh.userData?.part as { id: string; label: string; kind: PartKind } | undefined;
    if (mesh.isMesh && info) {
      parts.push({
        id: info.id,
        label: info.label,
        kind: info.kind,
        mesh,
        solids: mesh.userData?.solids as ArrayLike<number> | undefined,
      });
    }
  });
  return parts;
}

/**
 * Applies a click to a selection.
 *
 * Matches the convention the on-screen help advertises, which is also what
 * every 3D tool does: plain click replaces, ctrl or shift adds and removes.
 * Clicking the only selected thing again clears it, so there is always a way
 * out without reaching for the keyboard.
 */
export function applyClick(
  current: ReadonlySet<string>,
  id: string,
  additive: boolean,
): Set<string> {
  if (additive) {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }
  if (current.size === 1 && current.has(id)) return new Set();
  return new Set([id]);
}

/**
 * Turns selected ids into the meshes and draw ranges that represent them.
 *
 * A group id means the whole mesh; a `#n` id means one solid inside it. Ids
 * whose group is no longer in the scene are dropped rather than throwing —
 * a selection can outlive the piece it was made on for a frame.
 */
export function resolveSelection(
  parts: Part[],
  ids: ReadonlySet<string>,
): { id: string; mesh: THREE.Mesh; start: number; count: number }[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const out: { id: string; mesh: THREE.Mesh; start: number; count: number }[] = [];

  for (const id of ids) {
    const { group, solid } = parseId(id);
    const part = byId.get(group);
    if (!part) continue;

    if (solid === null) {
      const total = part.mesh.geometry?.index?.count ?? 0;
      out.push({ id, mesh: part.mesh, start: 0, count: total });
      continue;
    }
    const range = solidRange(part.solids, solid);
    if (range) out.push({ id, mesh: part.mesh, start: range.start, count: range.count });
  }
  return out;
}

/*
 * ── Showing what is selected ────────────────────────────────────────────────
 *
 * A wireframe bounding box was the first attempt and it does not work. Around a
 * 740k-vertex metal group the box encloses the entire ring, so it says "this
 * piece" rather than "this part", and on a colour group whose stones are spread
 * across the whole piece it encloses everything. Thin lines over a bright,
 * specular render are also close to invisible on a phone.
 *
 * What reads is tinting the part itself. The overlay re-draws the SAME geometry
 * — no new buffers, no BVH, one draw call — as a flat colour over the top, so
 * the selected metal or stone visibly changes colour and nothing else does.
 */

/** Cyan, because no jewellery is cyan. Gold on gold would be invisible. */
export const SELECT_COLOR = "#22d3ee";
export const HOVER_COLOR = "#e8f7fb";

/**
 * A geometry that draws the same buffers, so it can carry its own draw range.
 *
 * NOT `clone()`. Three's clone deep-copies every attribute array, which is a
 * second copy of 740k vertices per selected solid — the exact cost the draw
 * range exists to avoid. This shares the BufferAttribute objects themselves, so
 * the only new allocation is the wrapper.
 *
 * The range cannot simply be set on the original: it is one property on one
 * shared geometry, so two selected solids would fight over it and only the last
 * would show — and the piece itself would stop drawing everything else.
 */
function shareGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    out.setAttribute(name, src.attributes[name]);
  }
  if (src.index) out.setIndex(src.index);
  // Reused rather than recomputed: culling a 740k-vertex bound is not free.
  out.boundingSphere = src.boundingSphere;
  out.boundingBox = src.boundingBox;
  return out;
}

/** Marks the overlay meshes so capture can leave them out of an export. */
export const OVERLAY_FLAG = "selectionOverlay";

/**
 * Builds the tint meshes for a set of parts and parents them to the parts.
 *
 * Parenting rather than positioning: a child at identity inherits the part's
 * world transform for free, so the tint cannot drift when the piece is rotated
 * or re-fitted. Returns the teardown.
 */
export function attachHighlight(
  parts: Part[],
  ids: ReadonlySet<string>,
  color: string,
  opacity: number,
): () => void {
  const chosen = resolveSelection(parts, ids);
  if (chosen.length === 0) return () => {};

  const base = {
    color: new THREE.Color(color),
    transparent: true,
    depthWrite: false,
    // Identical geometry at identical depth, and the default LEQUAL test
    // passes, so the tint lands exactly on the surface without z-fighting.
    side: THREE.DoubleSide,
    toneMapped: false,
  };
  const solidMat = new THREE.MeshBasicMaterial({ ...base, opacity });
  /*
   * A second, fainter pass with the depth test off, so a selected prong behind
   * the shank still shows. Without it, selecting something on the far side of
   * the piece looks like nothing happened.
   */
  const xray = new THREE.MeshBasicMaterial({
    ...base,
    opacity: opacity * 0.28,
    depthTest: false,
  });

  const added: { parent: THREE.Object3D; mesh: THREE.Mesh }[] = [];
  for (const target of chosen) {
    /*
     * One solid is a contiguous run of the group's index buffer, so lighting a
     * single stone out of 140 is a draw range on the geometry that is already
     * there — no second buffer, no copy of 740k vertices.
     *
     * The geometry is shared, so the range cannot be set on it directly: two
     * selected solids in the same group would fight over one drawRange and only
     * the last would show. Each overlay gets a thin clone that shares the same
     * attribute buffers and carries only its own range.
     */
    const geometry = shareGeometry(target.mesh.geometry);
    geometry.setDrawRange(target.start, target.count);

    for (const [i, material] of [solidMat, xray].entries()) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData[OVERLAY_FLAG] = true;
      // Drawn after the piece, and the x-ray pass after the solid one.
      mesh.renderOrder = 900 + i;
      /*
       * Never pickable. The overlay sits directly over the part, so without
       * this every click would hit the tint — which carries no part id — and
       * clicking a selected part to deselect it would silently do nothing.
       */
      mesh.raycast = () => {};
      target.mesh.add(mesh);
      added.push({ parent: target.mesh, mesh });
    }
  }

  return () => {
    for (const { parent, mesh } of added) {
      parent.remove(mesh);
      /*
       * Only the wrapper is ours. `dispose()` on a shared-attribute geometry
       * emits the dispose event, which is what frees the GPU buffers those
       * attributes are bound to — and they are the real mesh's buffers. So the
       * wrapper is dropped, not disposed.
       */
    }
    solidMat.dispose();
    xray.dispose();
  };
}

/**
 * Hides every selection overlay in a scene, returning the restore.
 *
 * An export is a photograph of the piece, not a screenshot of the editor, so
 * the tint must not be baked into it. Capture wraps its render in this.
 */
export function hideOverlays(scene: THREE.Object3D): () => void {
  const hidden: THREE.Object3D[] = [];
  scene.traverse((obj) => {
    if (obj.userData?.[OVERLAY_FLAG] && obj.visible) {
      obj.visible = false;
      hidden.push(obj);
    }
  });
  return () => {
    for (const obj of hidden) obj.visible = true;
  };
}

/** What the HUD says. Named parts read better than a bare count. */
export function describeSelection(parts: Part[], selected: ReadonlySet<string>): string {
  if (selected.size === 0) return "";
  const byId = new Map(parts.map((p) => [p.id, p]));

  const names: string[] = [];
  for (const id of selected) {
    const { group, solid } = parseId(id);
    const part = byId.get(group);
    if (!part) continue;
    // A single solid is named by its group and its number, because "Gem 03"
    // alone would read as all 140 stones rather than the one that is lit.
    names.push(solid === null ? part.label : `${part.label} · ${solid + 1}`);
  }

  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  // Only the whole-group ids can add up to "everything"; a set of solids never
  // covers the piece however many of them there are.
  if (names.length === parts.length && [...selected].every((id) => byId.has(id))) {
    return "everything";
  }
  return `${names.length} parts`;
}

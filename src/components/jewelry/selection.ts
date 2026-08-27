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

/**
 * A part's label with any trailing uniquification number stripped —
 * "Prong 2" and "Prong" both read as "Prong". `uniqueLabel` above is what adds
 * that number in the first place, so this is its inverse: the label two parts
 * would have shared had they not needed telling apart.
 *
 * Used for "link parts with the same name" — visibility and, contextually,
 * anything else that wants "every Prong" from a single click on one of them,
 * without a second, separate name-grouping concept to keep in sync with how
 * labels actually get made.
 */
export function baseName(label: string): string {
  return label.replace(/\s+\d+$/, "").trim();
}

/** Every part sharing `id`'s base name and kind, including `id` itself. */
export function linkedPartIds(parts: Part[], id: string): string[] {
  const part = parts.find((p) => p.id === id);
  if (!part) return [id];
  const base = baseName(part.label);
  return parts.filter((p) => p.kind === part.kind && baseName(p.label) === base).map((p) => p.id);
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
      /*
       * The whole part, counted in whichever units it draws in.
       *
       * This read `index.count` alone, and stones have NO INDEX — faceting
       * de-indexes them for flat shading. So a whole-stone-group selection
       * resolved to a draw range of zero and highlighted nothing at all, while
       * picking the stones one at a time worked perfectly, because that path
       * goes through `solidRange` and the offsets. The fault sat unnoticed
       * until the Objects panel gave anyone a way to select a whole part.
       */
      const geo = part.mesh.geometry;
      const total = geo?.index?.count ?? geo?.getAttribute("position")?.count ?? 0;
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

/*
 * ── Finding solids in a scene that did not come with them ───────────────────
 *
 * The .3dm worker splits every group into its separate solids, because it has
 * the whole file open and a thread to do it on. Nothing else did — so on a GLB
 * the entire pavé was one part, and clicking one stone painted all hundred and
 * forty of them. Per-solid picking silently worked on one file format only.
 *
 * This is the same union-find, run on a THREE geometry, so the capability
 * belongs to the viewer rather than to the importer.
 */

/**
 * Above this, the split is skipped and the group stays the unit.
 *
 * The cost is linear but the constant is real: the client's 740k-vertex metal
 * group takes about 1.4 seconds. That is fine in a worker at load and not fine
 * on the main thread, and metal from a .3dm already arrives split. A pavé — the
 * case that actually needs this — is well under it, at around 80k.
 */
export const MAX_SPLIT_VERTICES = 1_200_000;

/**
 * Splits a geometry into its connected solids, reordering the index buffer so
 * each one is contiguous. Returns the offsets, or null when it declined.
 *
 * MUTATES the index buffer, so the caller must own the geometry — a GLB's is
 * shared with the useGLTF cache and reordering it in place would reorder it for
 * every other mount too.
 */
export function splitSolids(geometry: THREE.BufferGeometry): number[] | null {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  if (!index || !position) return null;

  const vertCount = position.count;
  if (vertCount > MAX_SPLIT_VERTICES) return null;

  const parent = new Int32Array(vertCount);
  for (let i = 0; i < vertCount; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  /*
   * Welded by position, not by index. Separate solids in a merged mesh each
   * carry their own copy of the vertices along their seams, so index sharing
   * alone would cut a single stone into several pieces.
   *
   * The tolerance is RELATIVE to the piece, which matters more than it looks.
   * A fixed 1e-4 assumes a scale: the .3dm path normalises to a unit sphere, a
   * GLB arrives in whatever unit it was exported in. Too coarse for the scale
   * and neighbouring stones fuse into one solid; too fine and a single stone
   * splits into fragments along its own seams. Either way a click lands on
   * something other than the stone under the cursor, which is precisely how it
   * looks when the wrong stones change colour.
   */
  geometry.computeBoundingBox();
  const span = geometry.boundingBox
    ? Math.max(
        geometry.boundingBox.max.x - geometry.boundingBox.min.x,
        geometry.boundingBox.max.y - geometry.boundingBox.min.y,
        geometry.boundingBox.max.z - geometry.boundingBox.min.z,
      )
    : 1;
  // A hundred-thousandth of the piece: far below any real gap between stones,
  // far above the float error along a shared seam.
  const quantum = Math.max(span, 1e-6) * 1e-5;

  const byPos = new Map<string, number>();
  for (let v = 0; v < vertCount; v++) {
    const key = `${Math.round(position.getX(v) / quantum)},${Math.round(
      position.getY(v) / quantum,
    )},${Math.round(position.getZ(v) / quantum)}`;
    const seen = byPos.get(key);
    if (seen === undefined) byPos.set(key, v);
    else union(v, seen);
  }

  const triCount = index.count / 3;
  for (let t = 0; t < triCount; t++) {
    union(index.getX(t * 3), index.getX(t * 3 + 1));
    union(index.getX(t * 3 + 1), index.getX(t * 3 + 2));
  }

  // First-seen order, so the numbering is stable across loads and a saved
  // assignment lands on the same stone next time.
  const order = new Map<number, number>();
  const triRoot = new Int32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const root = find(index.getX(t * 3));
    triRoot[t] = root;
    if (!order.has(root)) order.set(root, order.size);
  }

  // One solid is not a split worth having.
  if (order.size < 2) return null;

  const counts = new Uint32Array(order.size);
  for (let t = 0; t < triCount; t++) counts[order.get(triRoot[t])!]++;

  const starts = new Uint32Array(order.size + 1);
  for (let i = 0; i < order.size; i++) starts[i + 1] = starts[i] + counts[i] * 3;

  const cursor = starts.slice(0, order.size);
  const sorted = new Uint32Array(index.count);
  for (let t = 0; t < triCount; t++) {
    const slot = order.get(triRoot[t])!;
    const to = cursor[slot];
    sorted[to] = index.getX(t * 3);
    sorted[to + 1] = index.getX(t * 3 + 1);
    sorted[to + 2] = index.getX(t * 3 + 2);
    cursor[slot] = to + 3;
  }
  geometry.setIndex(Array.from(sorted));

  // A plain array, because `Object3D.clone` round-trips userData through JSON
  // and a typed array comes back as an object with no length.
  return Array.from(starts);
}

/**
 * The solids of a geometry, computed at most once for it.
 *
 * `splitSolids` is linear but not cheap — the shipped model's metal is 972k
 * vertices and takes about two seconds. DressedScene re-clones the scene
 * whenever the finish or the lighting changes, and a clone's userData is a copy,
 * so caching the result per mount means paying that two seconds again on every
 * swatch click.
 *
 * So the cache lives on the SOURCE geometry, which is the one thing that
 * outlives the clones: it is held by the useGLTF cache for as long as the file
 * is loaded. That means reordering the source's index buffer in place rather
 * than a clone's. Safe, and deliberately so — triangle order in a render mesh
 * carries no meaning, and every mount now reads the same order with the same
 * offsets describing it, which is the property that was missing when each mount
 * reordered a private copy.
 *
 * A geometry that declines the split is remembered too, or a mesh over the cap
 * would pay the rejected attempt on every re-clone.
 */
export function ensureSolids(source: THREE.BufferGeometry): number[] | null {
  const cached = source.userData.solids as number[] | undefined;
  if (cached) return cached;
  if (source.userData.solidsChecked) return null;
  source.userData.solidsChecked = true;
  const solids = splitSolids(source);
  if (solids) source.userData.solids = solids;
  return solids;
}

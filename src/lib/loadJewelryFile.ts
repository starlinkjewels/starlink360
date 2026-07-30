import * as THREE from "three";

import type { DecodedBucket, DecodedDocument } from "./rhinoDecode";

export type LoadProgress = { phase: string; percent: number | null };

export const RHINO_LIB = "https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/";
export const DRACO_LIB = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";

/**
 * Edges meeting at less than this angle get blended normals; sharper edges stay
 * crisp. Rhino tessellates NURBS into flat triangles, so without this every
 * curved band renders visibly faceted.
 */
/*
 * Written out rather than `THREE.MathUtils.degToRad(35)`.
 *
 * That call ran while this module was still initialising, which means it read a
 * binding out of the three.js chunk before that chunk had finished evaluating
 * its own declarations. The bundler exposes the namespace as getters, so the
 * getter handed back a value still in its temporal dead zone and the whole
 * upload died with "Cannot access 'a' before initialization" — a minified name,
 * from a file nobody had touched.
 *
 * Nothing imported may be *called* at module scope for that reason. A literal
 * cannot fail. 35 degrees.
 */
const METAL_CREASE_ANGLE = (35 * Math.PI) / 180;

/** Weld distance, applied after the model is normalised to a unit sphere. */
const WELD_TOLERANCE = 1e-4;

/**
 * Ceiling for the weld+crease fallback, which now only runs when a source
 * supplied no normals at all. Measured on desktop with scripts/bench-ingest.mjs:
 * ~170k verts already costs ~4s and ~500k costs ~11s, and a mid-range phone is
 * 3-5x slower again. Creasing also splits shared vertices, roughly tripling the
 * vertex count. Above this we keep the merged geometry as it came.
 */
const MAX_WELD_VERTICES = 120_000;

/**
 * Hard ceiling on renderable vertices. At 24 bytes per vertex this is ~96 MB of
 * attribute data before the GPU copy, which a mid-range phone can still hold;
 * well past it the tab is killed mid-decode with no explanation.
 */
const MAX_TOTAL_VERTICES = 4_000_000;

/** Let the browser paint the progress bar between blocking phases. */
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Prefetch decoder libs so first upload feels instant. Call this on idle after mount. */
let _preloaded = false;
export function preloadDecoders(): void {
  if (typeof document === "undefined" || _preloaded) return;
  _preloaded = true;
  const add = (href: string, as: "script" | "fetch") => {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const l = document.createElement("link");
    l.rel = "prefetch";
    l.as = as;
    l.crossOrigin = "anonymous";
    l.href = href;
    document.head.appendChild(l);
  };
  add(`${RHINO_LIB}rhino3dm.js`, "script");
  add(`${RHINO_LIB}rhino3dm.wasm`, "fetch");
  add(`${DRACO_LIB}draco_decoder.wasm`, "fetch");
  add(`${DRACO_LIB}draco_wasm_wrapper.js`, "script");
}

/* ── Layer classification ────────────────────────────────────────────────
 *
 * Rhino3dmLoader does NOT nest meshes under layer-named groups — every object
 * is added flat to one root. The layer table lives on `root.userData.layers`
 * and each mesh carries `userData.attributes.layerIndex`. Reading `mesh.parent
 * .name` (the old approach) always saw the root, so no filtering ever happened
 * and construction geometry was merged into the model.
 */

type Bucket = "metal" | "gem";

interface RhinoLayer {
  name?: string;
  fullPath?: string;
  visible?: boolean;
}

const GEM_LAYER = /^gems?\s*[\d._-]*$/i;
const METAL_LAYER = /^metals?\s*[\d._-]*$/i;

/*
 * Vocabularies are deliberately lopsided.
 *
 * Anything unrecognised falls through to metal, which is the safe outcome: it
 * renders, visibly, in gold. So METAL_WORDS can be generous, while GEM_WORDS
 * must be conservative — a false gem match turns a solid part to glass, which
 * looks broken. Ambiguous trade terms ("pave", "round", "oval", "setting") are
 * therefore left out of GEM_WORDS on purpose.
 *
 * Substring matching is fine here; a wrong guess only picks the wrong material
 * and never deletes geometry. Short tokens are anchored so they can't match
 * inside unrelated words.
 */
const GEM_WORDS =
  /gem|stone|diamond|crystal|glass|brilliant|sapphire|ruby|emerald|pearl|opal|topaz|amethyst|garnet|moissanite|melee|marquise|baguette|cushion|briolette|cabochon|zircon|quartz|onyx|turquoise|citrine|peridot|tanzanite|aquamarine|spinel|tourmaline|\bjade\b|\bcz\b/i;

const METAL_WORDS =
  /metal|band|shank|setting|prong|claw|bezel|gold|silver|platinum|palladium|rhodium|brass|bronze|alloy|sterling|mount|head|bail|chain|ring|gallery|halo|basket|collet|finding|clasp|butterfly|hook|wire|frame|link|solder|karat|\bkt\b|\b\d{1,2}k\b/i;

/**
 * Layers Rhino jewellers use for scaffolding that must never be rendered.
 *
 * Every term is word-anchored. Without `\b` these match inside real layer
 * names — "old" hides in "Gold", "text" in "Texture", "scale" in "Scaled" —
 * which silently deleted the metal from any file whose layer was named "Gold".
 */
const CONSTRUCTION_WORDS =
  /\b(finger\s*sizes?|cutting\s*objects?|cutters?|construction|reference|guides?|layouts?|dimensions?|annotations?|texts?|sketch(es)?|scale|notes?|hidden|temp|temporary|backup|old|obsolete|scrap|junk)\b/i;

/**
 * Rhino stores NURBS; only the cached render mesh is drawable. A file saved
 * without those meshes yields nothing for the affected objects, and the loader
 * records it as a warning rather than an error — which is how a ring can arrive
 * with its stones but no band. Nothing client-side can tessellate NURBS, so the
 * best we can do is say precisely what happened.
 */
function missingMeshNotice(root: THREE.Object3D): string | null {
  const warnings = (root.userData as { warnings?: { message?: string }[] }).warnings;
  if (!Array.isArray(warnings)) return null;
  const missing = warnings.filter((w) => /no associated mesh geometry/i.test(w?.message ?? ""));
  if (!missing.length) return null;
  return (
    `${missing.length} part${missing.length === 1 ? "" : "s"} had no render mesh and could not ` +
    `be shown. In Rhino, select all and run Mesh, or re-save with render meshes enabled.`
  );
}

function getLayers(root: THREE.Object3D): RhinoLayer[] {
  const layers = (root.userData as { layers?: unknown }).layers;
  return Array.isArray(layers) ? (layers as RhinoLayer[]) : [];
}

function layerFor(mesh: THREE.Mesh, layers: RhinoLayer[]): RhinoLayer | undefined {
  const attrs = mesh.userData?.attributes as { layerIndex?: number } | undefined;
  const index = attrs?.layerIndex;
  return typeof index === "number" && index >= 0 ? layers[index] : undefined;
}

/** "Jewelry::Metal 01::Prongs" → ["Jewelry", "Metal 01", "Prongs"] */
function layerSegments(layer: RhinoLayer | undefined): string[] {
  if (!layer) return [];
  return (layer.fullPath ?? layer.name ?? "")
    .split("::")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strict pass: honour the `Metal *` / `Gem *` naming convention, leaf layer wins. */
function classifyByConvention(segments: string[]): Bucket | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (GEM_LAYER.test(segments[i])) return "gem";
    if (METAL_LAYER.test(segments[i])) return "metal";
  }
  return null;
}

/** Relaxed pass: guess from any naming hint, then fall back to material. */
function classifyByHeuristic(mesh: THREE.Mesh, segments: string[]): Bucket {
  const attrs = mesh.userData?.attributes as { name?: string } | undefined;
  const hay = `${mesh.name} ${attrs?.name ?? ""} ${segments.join(" ")}`;
  if (GEM_WORDS.test(hay)) return "gem";
  if (METAL_WORDS.test(hay)) return "metal";
  const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
  if (mat?.transparent && (mat.opacity ?? 1) < 0.95) return "gem";
  return "metal";
}

function isConstruction(segments: string[]): boolean {
  // A layer that names a real jewellery part is never scaffolding. Losing the
  // metal is far more damaging than rendering a stray guide, so any jewellery
  // hint wins outright.
  const path = segments.join(" ");
  if (METAL_WORDS.test(path) || GEM_WORDS.test(path)) return false;
  return segments.some((s) => CONSTRUCTION_WORDS.test(s));
}

/**
 * World-space position + normal, so heterogeneous meshes can merge.
 *
 * Keeping the source normals matters more than it looks: rhino3dm's
 * `toThreejsJSON()` ships normals derived from the NURBS surface, which are
 * more faithful than anything reconstructible from the tessellation — and free.
 * Discarding them forced a weld+crease rebuild that cost seconds on a large
 * piece and still produced a worse result.
 *
 * `BufferGeometry.applyMatrix4` transforms normals by the proper normal matrix,
 * so no separate handling is needed here.
 */
function worldGeometry(
  mesh: THREE.Mesh,
): { geometry: THREE.BufferGeometry; hadNormals: boolean } | null {
  const src = mesh.geometry;
  if (!src?.attributes.position) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", src.attributes.position.clone());

  const hadNormals = !!src.attributes.normal;
  if (hadNormals) geo.setAttribute("normal", src.attributes.normal.clone());
  // Keep the index — it keeps memory flat and lets welding work if we need it.
  if (src.index) geo.setIndex(src.index.clone());

  mesh.updateWorldMatrix(true, false);
  geo.applyMatrix4(mesh.matrixWorld);
  return { geometry: geo, hadNormals };
}

interface Candidate {
  geometry: THREE.BufferGeometry;
  /** Source supplied normals — no reconstruction needed. */
  hadNormals: boolean;
  bucket: Bucket;
  box: THREE.Box3;
  triangles: number;
}

function collect(root: THREE.Object3D, layers: RhinoLayer[], strict: boolean): Candidate[] {
  const out: Candidate[] = [];

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;

    // Block instances land as root > instanceWrapper > mesh, and the clone
    // carries the *definition's* layer — which jewellers habitually switch off
    // while the instances still display in Rhino. Honour visibility only for
    // top-level objects, or every block-placed pavé stone disappears.
    const isInstanced = mesh.parent !== root;
    const layer = layerFor(mesh, layers);
    if (!isInstanced) {
      if (!mesh.visible) return;
      if (layer?.visible === false) return;
    }

    const segments = layerSegments(layer);
    let bucket: Bucket | null = classifyByConvention(segments);

    if (strict) {
      if (!bucket) return; // no Metal*/Gem* layer → construction geometry
    } else {
      if (isConstruction(segments)) return;
      bucket ??= classifyByHeuristic(mesh, segments);
    }

    const built = worldGeometry(mesh);
    if (!built) return;
    const { geometry, hadNormals } = built;
    geometry.computeBoundingBox();
    out.push({
      geometry,
      hadNormals,
      bucket,
      box: geometry.boundingBox ?? new THREE.Box3(),
      triangles: (geometry.index?.count ?? geometry.attributes.position.count) / 3,
    });
  });

  return out;
}

/**
 * Rhino files routinely carry a display card, backdrop or cutting plane on an
 * otherwise renderable layer. It reads as a huge, perfectly flat, barely
 * tessellated slab — and renders as a wall of gold behind the piece.
 *
 * All three conditions must hold together. Nothing in real jewellery is
 * simultaneously that large, that flat and that coarse, so genuine flat parts
 * (a pendant tag is 12x26x0.8mm across a 182mm model) are never caught.
 */
function isBackdropSlab(c: Candidate, modelExtent: number): boolean {
  const size = c.box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  const thinnest = Math.min(size.x, size.y, size.z);
  if (longest < modelExtent * 0.6) return false; // not large enough to be a backdrop
  if (thinnest > longest * 0.02) return false; // has real thickness — a solid, not a slab
  return c.triangles < 500; // detailed geometry is jewellery, not scaffolding
}

function dropBackdropSlabs(candidates: Candidate[]): Candidate[] {
  const bounds = new THREE.Box3();
  for (const c of candidates) bounds.union(c.box);
  const size = bounds.getSize(new THREE.Vector3());
  const modelExtent = Math.max(size.x, size.y, size.z);

  let kept = candidates.filter((c) => !isBackdropSlab(c, modelExtent));

  // Never strip the whole model — if everything looks like a slab, the file
  // genuinely is flat and the user still deserves to see it.
  if (!kept.length) return candidates;

  // Likewise never remove the last of the metal. A backdrop is a nice thing to
  // catch; a missing band is a broken product shot.
  const hadMetal = candidates.some((c) => c.bucket === "metal");
  if (hadMetal && !kept.some((c) => c.bucket === "metal")) {
    kept = kept.concat(candidates.filter((c) => c.bucket === "metal"));
  }

  for (const c of candidates) if (!kept.includes(c)) c.geometry.dispose();
  return kept;
}

/**
 * Make a set of geometries mergeable.
 *
 * `mergeGeometries` demands an identical attribute set AND matching
 * index-ness across every input. One mismatch and it returns null, which
 * previously failed the whole upload with "Could not build a renderable mesh".
 * Rhino output is uniform, but GLBs and mixed sources are not — a single
 * non-indexed mesh alongside indexed ones was enough to lose the entire piece.
 *
 * Adding a sequential index is the cheap direction to harmonise: 4 bytes per
 * vertex, versus tripling the vertex count by stripping indexes instead.
 */
function harmoniseForMerge(geometries: THREE.BufferGeometry[]): void {
  for (const g of geometries) if (!g.attributes.normal) g.computeVertexNormals();

  if (!geometries.some((g) => g.index)) return; // uniformly non-indexed is fine
  for (const g of geometries) {
    if (g.index) continue;
    const n = g.attributes.position.count;
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
}

function vertexCount(geometries: THREE.BufferGeometry[]): number {
  return geometries.reduce((n, g) => n + g.attributes.position.count, 0);
}

/**
 * Smooth metal: merge every BRep face into one shell, weld the seams between
 * them, then blend normals only across tangent joins. Welding before creasing
 * is what removes the facet lines along curved surfaces — per-face welding
 * cannot, because the seams lie between faces.
 */
async function shadeMetal(
  geometries: THREE.BufferGeometry[],
  anySourceNormals: boolean,
): Promise<THREE.BufferGeometry | null> {
  const { mergeGeometries, mergeVertices, toCreasedNormals } =
    await import("three/examples/jsm/utils/BufferGeometryUtils.js");

  harmoniseForMerge(geometries);

  const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
  if (!merged) return null;
  if (geometries.length > 1) geometries.forEach((g) => g.dispose());

  // The source already described its own shading — trust it. This is the
  // common path for .3dm and for any GLB exported with normals.
  if (anySourceNormals) return merged;

  // Nothing supplied normals, so rebuild them: weld the seams, then blend only
  // across tangent joins. Expensive — it also roughly triples the vertex count
  // by splitting shared vertices apart — so it is capped and strictly a
  // fallback for sources that gave us nothing to work with.
  if (merged.attributes.position.count > MAX_WELD_VERTICES) return merged;

  const welded = mergeVertices(merged, WELD_TOLERANCE);
  if (welded !== merged) merged.dispose();
  const creased = toCreasedNormals(welded, METAL_CREASE_ANGLE);
  welded.dispose();
  return creased;
}

/**
 * Gems stay flat-shaded — a brilliant cut sparkles precisely because each facet
 * reflects as its own plane. Smoothing them turns the stone into a blob.
 */
async function shadeGem(geometries: THREE.BufferGeometry[]): Promise<THREE.BufferGeometry | null> {
  const { mergeGeometries } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");

  harmoniseForMerge(geometries);

  const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
  if (!merged) return null;
  if (geometries.length > 1) geometries.forEach((g) => g.dispose());

  const flat = merged.index ? merged.toNonIndexed() : merged;
  if (flat !== merged) merged.dispose();
  flat.computeVertexNormals();
  return flat;
}

/**
 * Compresses an arbitrary jewelry scene into exactly two meshes named
 * `metal` and `gem` — far fewer draw calls and a predictable convention.
 */
export async function compressToJewelryScene(
  root: THREE.Object3D,
  onProgress?: (p: LoadProgress) => void,
): Promise<THREE.Group> {
  root.updateMatrixWorld(true);
  const layers = getLayers(root);

  // Prefer the Metal*/Gem* convention. Files that don't follow it (most GLBs,
  // and .3dm files from other studios) fall back to including everything that
  // isn't obviously scaffolding.
  let candidates = collect(root, layers, true);

  // A piece with stones but no metal means the convention was only half
  // followed — the stones sat on "Gem 01" while the metal sat on "Gold" or
  // "Shank" and the strict pass walked straight past it. Retry open-handed
  // rather than presenting a ring with no band.
  if (!candidates.length || !candidates.some((c) => c.bucket === "metal")) {
    for (const c of candidates) c.geometry.dispose();
    candidates = collect(root, layers, false);
  }

  if (!candidates.length) {
    throw new Error(
      missingMeshNotice(root) ??
        "No renderable geometry found. If this is a Rhino file, re-save it with render meshes enabled.",
    );
  }

  candidates = dropBackdropSlabs(candidates);

  // Past this the tab is likely to be killed before it ever renders — a phone
  // holds far less than a desktop. Failing with a clear instruction beats a
  // silent crash halfway through decoding.
  const totalVerts = candidates.reduce((n, c) => n + c.geometry.attributes.position.count, 0);
  if (totalVerts > MAX_TOTAL_VERTICES) {
    for (const c of candidates) c.geometry.dispose();
    throw new Error(
      `This model has ${(totalVerts / 1e6).toFixed(1)}M vertices, past the ${(
        MAX_TOTAL_VERTICES / 1e6
      ).toFixed(0)}M this viewer can hold. Reduce the render mesh density in Rhino ` +
        `(Document Properties → Mesh → Jagged & faster) and re-save.`,
    );
  }

  // Normalise to a unit sphere at the origin before welding, so the tolerance
  // means the same thing for millimetre Rhino files and metre GLBs. Measured
  // after slab removal so a stray backdrop can't shrink the piece.
  const bounds = new THREE.Box3();
  for (const c of candidates) bounds.union(c.box);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const scale = 1 / (sphere.radius || 1);
  const normalise = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(
      new THREE.Matrix4().makeTranslation(-sphere.center.x, -sphere.center.y, -sphere.center.z),
    );
  for (const c of candidates) c.geometry.applyMatrix4(normalise);

  const metalParts = candidates.filter((c) => c.bucket === "metal");
  const metal = metalParts.map((c) => c.geometry);
  const gem = candidates.filter((c) => c.bucket === "gem").map((c) => c.geometry);
  const metalHasSourceNormals = metalParts.some((c) => c.hadNormals);

  const group = new THREE.Group();

  if (metal.length) {
    const willWeld = !metalHasSourceNormals && vertexCount(metal) <= MAX_WELD_VERTICES;
    onProgress?.({ phase: willWeld ? "Smoothing metal" : "Merging metal", percent: 80 });
    await yieldToBrowser();
    const geometry = await shadeMetal(metal, metalHasSourceNormals);
    if (geometry) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
      mesh.name = "metal";
      group.add(mesh);
    }
  }

  if (gem.length) {
    onProgress?.({ phase: "Cutting facets", percent: 92 });
    await yieldToBrowser();
    const geometry = await shadeGem(gem);
    if (geometry) {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
      mesh.name = "gem";
      group.add(mesh);
    }
  }

  if (!group.children.length) {
    throw new Error("Could not build a renderable mesh from this file.");
  }

  const notice = missingMeshNotice(root);
  if (notice) group.userData.notices = [notice];

  group.updateMatrixWorld(true);
  return group;
}

/**
 * Turns the worker's typed arrays into the two-mesh scene the viewer expects.
 * Everything heavy already happened off-thread; this is just wrapping buffers
 * and normalising scale, so it stays well inside one frame's budget.
 */
function buildFromDecoded(decoded: DecodedDocument): THREE.Group {
  const group = new THREE.Group();

  const attach = (bucket: DecodedBucket | null, name: string) => {
    if (!bucket || !bucket.position.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(bucket.position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(bucket.normal, 3));
    geo.setIndex(new THREE.BufferAttribute(bucket.index, 1));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
    mesh.name = name;
    group.add(mesh);
  };

  attach(decoded.metal, "metal");
  // One mesh per stone colour. The name keeps the "gem" prefix the viewer
  // matches on and carries the colour after it, so a piece set with diamond and
  // ruby renders each correctly instead of forcing both to one material.
  for (const gem of decoded.gems) attach(gem, `gem-${gem.color.replace("#", "")}`);

  if (!group.children.length) {
    throw new Error(
      decoded.notices[0] ??
        "No renderable geometry found. If this is a Rhino file, re-save it with render meshes enabled.",
    );
  }

  const total = group.children.reduce(
    (n, c) => n + (c as THREE.Mesh).geometry.attributes.position.count,
    0,
  );
  if (total > MAX_TOTAL_VERTICES) {
    group.traverse((c) => (c as THREE.Mesh).geometry?.dispose?.());
    throw new Error(
      `This model has ${(total / 1e6).toFixed(1)}M vertices, past the ${(
        MAX_TOTAL_VERTICES / 1e6
      ).toFixed(0)}M this viewer can hold. Reduce the render mesh density in Rhino ` +
        `(Document Properties → Mesh → Jagged & faster) and re-save.`,
    );
  }

  // Normalise to a unit sphere at the origin, as the GLB path does.
  const box = new THREE.Box3().setFromObject(group);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const scale = 1 / (sphere.radius || 1);
  group.scale.setScalar(scale);
  group.position.set(-sphere.center.x * scale, -sphere.center.y * scale, -sphere.center.z * scale);
  group.updateMatrixWorld(true);

  if (decoded.notices.length) group.userData.notices = decoded.notices;
  return group;
}

export async function loadJewelryFile(
  file: File,
  onProgress?: (p: LoadProgress) => void,
): Promise<THREE.Group> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  onProgress?.({ phase: "Reading file", percent: 5 });
  const buffer = await file.arrayBuffer();

  let root: THREE.Object3D;

  if (ext === "3dm") {
    onProgress?.({ phase: "Decoding Rhino model", percent: 12 });
    const { decodeRhinoDocument } = await import("./rhinoDecode");
    const decoded = await decodeRhinoDocument(
      buffer,
      RHINO_LIB,
      {
        gemLayer: GEM_LAYER.source,
        metalLayer: METAL_LAYER.source,
        gemWords: GEM_WORDS.source,
        metalWords: METAL_WORDS.source,
        constructionWords: CONSTRUCTION_WORDS.source,
      },
      // Real progress, straight from the object walk — no estimate needed.
      (done, total) =>
        onProgress?.({
          phase: "Decoding Rhino model",
          percent: 12 + Math.round((done / Math.max(total, 1)) * 76),
        }),
    );

    onProgress?.({ phase: "Setting the stones", percent: 92 });
    await yieldToBrowser();
    return buildFromDecoded(decoded);
  } else if (ext === "glb" || ext === "gltf") {
    onProgress?.({ phase: "Decoding model", percent: 30 });
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const { DRACOLoader } = await import("three/examples/jsm/loaders/DRACOLoader.js");
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_LIB);
    loader.setDRACOLoader(draco);
    try {
      root = await new Promise<THREE.Object3D>((resolve, reject) => {
        loader.parse(
          buffer,
          "",
          (gltf) => resolve(gltf.scene),
          () => reject(new Error("Could not read this model file.")),
        );
      });
    } finally {
      draco.dispose();
    }
  } else {
    throw new Error("Unsupported file. Please upload a .3dm, .glb or .gltf file.");
  }

  onProgress?.({ phase: "Sorting layers", percent: 70 });
  await yieldToBrowser();
  const scene = await compressToJewelryScene(root, onProgress);
  onProgress?.({ phase: "Setting the stones", percent: 100 });
  return scene;
}

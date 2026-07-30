/**
 * Reports what the decoder sees in a .3dm — so a colour problem can be
 * diagnosed from a text dump instead of shipping a 70 MB file around.
 *
 * Prints, per layer: how it was classified, and the material colour each of its
 * objects resolves to, including WHICH channel carried the colour. That is
 * normally the answer: a stone whose colour lives somewhere the decoder is not
 * reading comes out white or wrong.
 *
 * Usage: node scripts/inspect-3dm.mjs "piece.3dm"
 */
import { readFileSync } from "node:fs";
import rhino3dm from "rhino3dm";

const path = process.argv[2];
if (!path) {
  console.log("  usage: node scripts/inspect-3dm.mjs <file.3dm>");
  process.exit(1);
}

const rhino = await rhino3dm();
const doc = rhino.File3dm.fromByteArray(new Uint8Array(readFileSync(path)));
const mats = doc.materials();
const layers = doc.layers();
const objs = doc.objects();
const MS = rhino.ObjectMaterialSource;

const GEM =
  /gem|stone|diamond|crystal|glass|brilliant|sapphire|ruby|emerald|pearl|opal|topaz|amethyst|garnet|moissanite|melee|marquise|baguette|cushion|briolette|cabochon|zircon|quartz|onyx|turquoise|citrine|peridot|tanzanite|aquamarine|spinel|tourmaline|\bjade\b|\bcz\b/i;
const METAL =
  /metal|band|shank|setting|prong|bezel|gold|silver|platinum|mount|head|bail|chain|ring|gallery|halo|basket/i;
const GEM_LAYER = /^gems?\s*[\d._-]*$/i;
const METAL_LAYER = /^metals?\s*[\d._-]*$/i;

function classify(name) {
  for (const seg of name.split("::").reverse()) {
    const s = seg.trim();
    if (GEM_LAYER.test(s)) return "GEM (layer convention)";
    if (METAL_LAYER.test(s)) return "METAL (layer convention)";
  }
  if (METAL.test(name)) return "METAL (word match)";
  if (GEM.test(name)) return "GEM (word match)";
  return "METAL (default - nothing matched)";
}

const chroma = (c) => (c ? Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) : 0);
const hex = (c) =>
  c ? "#" + [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, "0")).join("") : "-";

/** Mirrors the decoder's channel choice, and says which one won. */
function colourOf(index) {
  if (index < 0 || index >= mats.count) return { hex: "#ffffff", via: "no material" };
  const M = mats.get(index);
  const dc = M.diffuseColor || { r: 255, g: 255, b: 255 };
  const tc = M.transparentColor;
  let base = null;
  try {
    const pbr = typeof M.physicallyBased === "function" ? M.physicallyBased() : null;
    if (pbr && pbr.supported === true) base = pbr.baseColor || null;
  } catch {
    base = null;
  }
  let pick = dc;
  let via = "diffuse";
  if (chroma(tc) > chroma(pick)) {
    pick = tc;
    via = "transparentColor";
  }
  if (base && chroma(base) > chroma(pick)) {
    pick = base;
    via = "PBR baseColor";
  }
  if (Math.max(pick.r, pick.g, pick.b) < 24)
    return { hex: "#ffffff", via: via + " was near-black -> forced white" };
  return { hex: hex(pick), via, name: M.name || "(unnamed)", pbr: base ? hex(base) : "n/a" };
}

console.log(`\n  ${path}`);
console.log(`  materials=${mats.count}  layers=${layers.count}  objects=${objs.count}\n`);

// Group objects by layer so the report reads the way a jeweller organised it.
const byLayer = new Map();
for (let i = 0; i < objs.count; i++) {
  const a = objs.get(i).attributes();
  const li = a.layerIndex;
  if (!byLayer.has(li)) byLayer.set(li, []);
  byLayer.get(li).push(a);
}

for (const [li, attrs] of [...byLayer.entries()].sort((x, y) => x[0] - y[0])) {
  const L = li >= 0 && li < layers.count ? layers.get(li) : null;
  const name = L ? L.fullPath || L.name : `(layer ${li})`;
  const klass = classify(name);
  console.log(`  LAYER "${name}"  ->  ${klass}`);
  console.log(
    `        layer colour ${hex(L?.color)} (organisational, NOT used)   layer material index ${L?.renderMaterialIndex ?? -1}`,
  );

  const seen = new Map();
  for (const a of attrs) {
    const fromLayer = MS && a.materialSource === MS.MaterialFromLayer;
    const idx = fromLayer || a.materialIndex < 0 ? (L?.renderMaterialIndex ?? -1) : a.materialIndex;
    const c = colourOf(idx);
    const key = `${c.hex}|${c.via}|${c.name ?? ""}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
    const [h, via, mname] = key.split("|");
    console.log(
      `        ${String(n).padStart(5)} object(s) -> ${h}  via ${via}   material "${mname}"`,
    );
  }
  console.log();
}

console.log("  If a stone shows the wrong colour above, the 'via' column says which");
console.log("  channel the decoder read. If it says diffuse but the colour lives on a");
console.log("  PBR baseColor or a texture, that is the gap - send this output over.\n");

/**
 * The material library and its preview swatches.
 *
 * Two things are worth pinning down here. The catalogue is data a jeweller will
 * read off the screen, so a duplicated id or a gemstone with the wrong
 * refractive index is a factual error, not a styling one. And the swatch maths
 * has to produce something distinguishable for every entry — a grid of 42
 * identical grey circles is worse than no grid.
 *
 * Usage: node scripts/test-library.mjs
 */
import {
  METALS,
  GEMS,
  metalById,
  gemById,
  metalGroups,
  gemGroups,
  aberrationFor,
  resolveGem,
  resolveMetal,
} from "../.tmp-jewelry/library.js";
import {
  sphereSpec,
  previewKey,
  hexToRgb,
  rgbToHex,
  lighten,
  darken,
  luminance,
  needsOutline,
  sparklePositions,
} from "../.tmp-jewelry/preview.js";
import { finishById, finishes } from "../.tmp-suite/data/finishes.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

console.log("=== the catalogue is well formed ===");
check(METALS.length === 18, "18 metals", `${METALS.length}`);
check(GEMS.length === 24, "24 gems", `${GEMS.length}`);

const allIds = [...METALS, ...GEMS].map((m) => m.id);
check(new Set(allIds).size === allIds.length, "no duplicate ids across both catalogues");
check(
  [...METALS, ...GEMS].every((m) => /^#[0-9a-f]{6}$/i.test(m.color)),
  "every colour is a full 6-digit hex, which the swatch parser assumes",
);
check(
  [...METALS, ...GEMS].every((m) => m.name.trim().length > 1),
  "everything is named",
);
check(
  METALS.every((m) => m.roughness >= 0 && m.roughness <= 1 && m.metalness >= 0 && m.metalness <= 1),
  "metal roughness and metalness are in range",
);

console.log("\n=== lookups ===");
check(metalById("gold-18k")?.name === "18k Yellow Gold", "a metal resolves by id");
check(gemById("ruby")?.name === "Ruby", "a gem resolves by id");
check(metalById("nope") === undefined, "an unknown id is undefined, not a throw");
check(metalById(undefined) === undefined, "so is no id at all");

const mg = metalGroups();
const gg = gemGroups();
check(
  mg.reduce((n, g) => n + g.items.length, 0) === METALS.length,
  "grouping loses no metals",
  `${mg.length} groups`,
);
check(
  gg.reduce((n, g) => n + g.items.length, 0) === GEMS.length,
  "grouping loses no gems",
  `${gg.length} groups`,
);
check(
  new Set(mg.map((g) => g.group)).size === mg.length,
  "a group appears once, so the panel cannot render two 'Gold' headings",
);

/*
 * These are published mineral constants, not taste. If one of them drifts the
 * render is telling a jeweller something untrue about a stone.
 */
console.log("\n=== the optics are the real ones ===");
const optics = [
  ["diamond", 2.417, 0.044],
  ["moissanite", 2.65, 0.104],
  ["ruby", 1.77, 0.018],
  ["blue-sapphire", 1.77, 0.018],
  ["emerald", 1.577, 0.014],
  ["amethyst", 1.55, 0.013],
];
for (const [id, ior, disp] of optics) {
  const g = gemById(id);
  check(
    g && Math.abs(g.ior - ior) < 1e-6 && Math.abs(g.dispersion - disp) < 1e-6,
    `${g?.name ?? id} — IOR ${ior}, dispersion ${disp}`,
    g ? `got ${g.ior} / ${g.dispersion}` : "missing",
  );
}
check(
  gemById("moissanite").dispersion > gemById("diamond").dispersion,
  "moissanite disperses more than diamond, which is why it throws more fire",
);

console.log("\n=== dispersion maps to the shader's aberration ===");
// Diamond is the anchor: its look is already signed off at 0.035.
check(
  Math.abs(aberrationFor(0.044) - 0.035) < 1e-9,
  "diamond lands exactly on the value it has always rendered at",
  `${aberrationFor(0.044)}`,
);
check(aberrationFor(0.104) > aberrationFor(0.044), "more dispersion, more aberration");
check(aberrationFor(0) >= 0.008, "a zero-dispersion stone still has a floor, not dead glass");
check(aberrationFor(5) <= 0.09, "an absurd value is clamped rather than tearing the shader");

console.log("\n=== patches layer over the catalogue ===");
{
  const ruby = gemById("ruby");
  check(resolveGem(ruby).color === "#a5182b", "no patch keeps the catalogue colour");
  check(resolveGem(ruby, { color: "#00ff00" }).color === "#00ff00", "a patched colour wins");
  check(
    resolveGem(ruby, { ior: 99 }).ior === 3,
    "an out-of-range IOR is clamped, not passed to the shader",
  );
  check(
    resolveGem(ruby, { color: "#00ff00" }).ior === ruby.ior,
    "patching one field leaves the others at the catalogue value",
  );
  check(
    Math.abs(resolveGem(ruby).aberration - aberrationFor(ruby.dispersion)) < 1e-9,
    "no patch keeps the dispersion-derived fire",
  );
  check(
    Math.abs(resolveGem(ruby, { aberration: 0.06 }).aberration - 0.06) < 1e-9,
    "a patched fire overrides the catalogue's dispersion entirely",
  );
  check(
    resolveGem(ruby, { aberration: 5 }).aberration <= 0.09,
    "a patched fire past the ceiling is clamped like everything else, not passed raw to the shader",
  );
  check(
    resolveGem(ruby, { color: "#00ff00" }).aberration === resolveGem(ruby).aberration,
    "patching colour leaves fire at the catalogue value",
  );
  const gold = metalById("gold-18k");
  check(resolveMetal(gold, { roughness: 5 }).roughness === 1, "roughness is clamped");
  check(resolveMetal(gold, {}).metalness === 1, "an empty patch changes nothing");
}

console.log("\n=== colour helpers ===");
check(rgbToHex(hexToRgb("#a5182b")) === "#a5182b", "hex survives a round trip");
check(rgbToHex(hexToRgb("#abc")) === "#aabbcc", "shorthand hex expands");
check(lighten("#000000", 1) === "#ffffff", "fully lightened is white");
check(darken("#ffffff", 1) === "#000000", "fully darkened is black");
check(lighten("#808080", 0) === "#808080", "zero changes nothing");
check(luminance("#ffffff") > 0.99 && luminance("#000000") < 0.01, "luminance spans the range");
check(
  needsOutline("#141419") && needsOutline("#ffffff") && !needsOutline("#a5182b"),
  "only near-black and near-white swatches get a hairline",
);

console.log("\n=== every swatch is shaded, and they differ ===");
{
  const specs = [
    ...METALS.map((m) => ({
      id: m.id,
      spec: sphereSpec({
        kind: "metal",
        color: m.color,
        roughness: m.roughness,
        metalness: m.metalness,
      }),
      key: previewKey(
        { kind: "metal", color: m.color, roughness: m.roughness, metalness: m.metalness },
        44,
      ),
    })),
    ...GEMS.map((g) => ({
      id: g.id,
      spec: sphereSpec({
        kind: "gem",
        color: g.color,
        ior: g.ior,
        dispersion: g.dispersion,
        opaque: g.opaque,
      }),
      key: previewKey(
        { kind: "gem", color: g.color, ior: g.ior, dispersion: g.dispersion, opaque: g.opaque },
        44,
      ),
    })),
  ];

  check(
    specs.every((s) => s.spec.stops.length >= 3),
    "every sphere has a gradient",
  );
  check(
    specs.every((s) => s.spec.stops.every((st) => /^#[0-9a-f]{6}$/i.test(st.color))),
    "every gradient stop is a valid colour, so canvas cannot silently drop one",
  );
  check(
    specs.every((s) => {
      const at = s.spec.stops.map((x) => x.at);
      return at.every((v, i) => i === 0 || v > at[i - 1]) && at[0] >= 0 && at[at.length - 1] <= 1;
    }),
    "stops ascend and stay in 0..1, which addColorStop requires",
  );
  check(
    new Set(specs.map((s) => s.key)).size === specs.length,
    "every entry caches under its own key — no two swatches share an image",
    `${new Set(specs.map((s) => s.key)).size} of ${specs.length}`,
  );
}

console.log("\n=== metal and stone are shaded differently ===");
{
  const polished = sphereSpec({ kind: "metal", color: "#f2cf76", roughness: 0.1, metalness: 1 });
  const brushed = sphereSpec({ kind: "metal", color: "#f2cf76", roughness: 0.8, metalness: 1 });
  check(polished.specular !== null, "polished metal has a tight highlight");
  check(brushed.specular === null, "brushed metal has none — that is the visible difference");
  check(
    brushed.stops[1].at > polished.stops[1].at,
    "roughness spreads the reflection out",
    `${polished.stops[1].at.toFixed(2)} to ${brushed.stops[1].at.toFixed(2)}`,
  );

  const ruby = sphereSpec({ kind: "gem", color: "#a5182b", ior: 1.77, dispersion: 0.018 });
  const onyx = sphereSpec({
    kind: "gem",
    color: "#141419",
    ior: 1.53,
    dispersion: 0.013,
    opaque: true,
  });
  check(ruby.sparkles.length > 0, "a transmissive stone gets fire");
  check(onyx.sparkles.length === 0, "an opaque one does not — onyx must not glitter");
  check(
    luminance(ruby.stops[0].color) > luminance(ruby.stops[3].color),
    "a stone is pale at the centre and saturated at the rim, the opposite of metal",
  );

  const diamond = sphereSpec({ kind: "gem", color: "#ffffff", ior: 2.417, dispersion: 0.044 });
  const moissanite = sphereSpec({ kind: "gem", color: "#fdfdf6", ior: 2.65, dispersion: 0.104 });
  check(
    moissanite.sparkles.length > diamond.sparkles.length,
    "and more dispersion shows as more glints",
    `${diamond.sparkles.length} to ${moissanite.sparkles.length}`,
  );
}

console.log("\n=== sparkles are stable ===");
{
  const a = sparklePositions(0.044);
  const b = sparklePositions(0.044);
  check(
    JSON.stringify(a) === JSON.stringify(b),
    "the same stone glints identically every render, so nothing shimmers on re-render",
  );
  check(
    a.every((s) => Math.hypot(s.x - 0.5, s.y - 0.5) < 0.5),
    "every glint lands inside the sphere",
  );
}

console.log();
console.log("=== the quick picks are library metals, not a second list ===");
{
  /*
   * These were two lists for one thing: the piece rendered a "yellow-gold" the
   * Materials grid had never heard of, so opening the panel lit no swatch at
   * all while the metal was plainly there on screen.
   */
  check(finishes.length === 5, "five quick picks", String(finishes.length));
  check(
    finishes.every((f) => metalById(f.id) !== undefined),
    "every one is a real library metal",
    finishes.map((f) => f.id).join(" "),
  );
  check(
    finishes.every((f) => {
      const m = metalById(f.id);
      return m.color === f.color && m.roughness === f.roughness && m.name === f.name;
    }),
    "and carries the library's own numbers, so the two cannot drift",
  );

  // Ids stored before the lists merged must still resolve, or a saved project
  // silently reverts to the first quick pick.
  check(finishById("yellow-gold")?.id === "gold-18k", "the old yellow-gold id still resolves");
  check(finishById("platinum")?.id === "platinum-950", "and the old platinum id");
  check(finishById("gold-14k")?.id === "gold-14k", "a full library id resolves to itself");
  check(finishById("nonsense") === undefined, "and an unknown id is undefined, not a wrong metal");
  check(finishById(undefined) === undefined, "so is nothing at all");
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);

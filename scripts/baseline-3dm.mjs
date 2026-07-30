/** Decodes a .3dm and prints the metal/gem split, for regression comparison. */
import { readFileSync } from "node:fs";
import rhino3dm from "rhino3dm";
import { WORKER_SOURCE } from "../.tmp-jewelry/rhinoDecode.js";
let done;
globalThis.self = {
  onmessage: null,
  importScripts: () => {},
  rhino3dm: (o) => rhino3dm(o),
  postMessage: (m) => {
    if (m.type !== "progress") done = m;
  },
};
(0, eval)(WORKER_SOURCE);
await self.onmessage({
  data: {
    type: "decode",
    buffer: readFileSync(process.argv[2]).buffer,
    libraryPath: "./node_modules/rhino3dm/",
    rules: {
      gemLayer: "^gems?\s*[\d._-]*$",
      metalLayer: "^metals?\s*[\d._-]*$",
      gemWords:
        process.env.GEM_WORDS ||
        "gem|stone|diamond|crystal|glass|brilliant|sapphire|ruby|emerald|pearl",
      metalWords:
        "metal|band|shank|setting|prong|bezel|gold|silver|platinum|mount|head|bail|chain|ring|gallery|halo|basket",
      constructionWords:
        "\b(finger\s*sizes?|cutting\s*objects?|construction|reference|guides?|old)\b",
    },
  },
});
for (let i = 0; i < 8000 && !done; i++) await new Promise((r) => setTimeout(r, 50));
if (!done || done.type === "error") {
  console.log("  FAILED:", done?.message ?? "timeout");
  process.exit(1);
}
const n = (x) => x.toLocaleString("en-US");
console.log(
  `  metal        ${done.metal ? n(done.metal.position.length / 3) + " verts" : "(none)"}`,
);
console.log(`  gem groups   ${(done.gems ?? []).length}`);
for (const g of done.gems ?? [])
  console.log(`    ${g.color}  ${n(g.position.length / 3)} verts  material="${g.material}"`);
console.log(`  missingMesh  ${done.missingMesh}`);

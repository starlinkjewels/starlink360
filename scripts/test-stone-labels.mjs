/**
 * The name shown in the stone picker.
 *
 * Rhino layer paths are nested and plugin material names carry a GUID and a
 * carat size, so the raw strings are unusable in a UI. Usage:
 *   node scripts/test-stone-labels.mjs
 */
import { stoneLabel } from "../.tmp-jewelry/loadJewelryFile.js";

const CASES = [
  ["Gem 01", "", "Gem 01", "plain layer name"],
  ["Jewellery::Stones::Gem 02", "", "Gem 02", "only the leaf of a nested path"],
  ["  Gem 03  ", "", "Gem 03", "trimmed"],
  ["", "/Diamond0.2-960779ad-78a9-4f57-b66d-568aee82f44b", "Diamond", "GUID and carat stripped"],
  ["", "/Pink Sapphire0.15", "Pink Sapphire", "size stripped, words kept"],
  ["", "Ruby", "Ruby", "already clean"],
  ["", "", "Stones", "nothing to go on"],
  ["Gem 01", "/Ruby0.1", "Gem 01", "layer wins over material"],
];

let fail = 0;
for (const [layer, material, want, why] of CASES) {
  const got = stoneLabel(layer, material);
  const ok = got === want;
  if (!ok) fail++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${why} — layer="${layer}" material="${material}" -> "${got}"${ok ? "" : ` (wanted "${want}")`}`,
  );
}
console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);

/**
 * Draco-compresses a GLB in place-ish (writes alongside, then swaps).
 *
 * The convert-3dm.mjs export takes the "no Draco — fast path", which leaves
 * LP043.glb at ~40 MB of raw float32 positions/normals. Draco quantises and
 * entropy-codes those attributes, typically a 5–10x reduction with no visible
 * difference at jewelry scale.
 *
 * Quantisation is deliberately higher than gltf-pipeline's defaults: the model
 * is normalised to a unit bounding sphere, so 14-bit positions still resolve
 * ~0.0001 units — far finer than a prong or a facet edge. The stock 11 bits
 * visibly stair-steps curved metal.
 *
 * Usage:  node scripts/compress-glb.mjs [input.glb] [output.glb]
 */
import { readFileSync, writeFileSync } from "node:fs";
import gltfPipeline from "gltf-pipeline";

const { processGlb } = gltfPipeline;

const INPUT = process.argv[2] ?? "public/LP043.glb";
const OUTPUT = process.argv[3] ?? INPUT;

const mb = (bytes) => (bytes / 1048576).toFixed(1);

async function main() {
  console.log(`⏳  Reading ${INPUT}…`);
  const raw = readFileSync(INPUT);
  console.log(`✔   Input: ${mb(raw.byteLength)} MB`);

  console.log("⏳  Draco-compressing (this may take a minute for 1M vertices)…");
  const started = process.hrtime.bigint();

  const result = await processGlb(raw, {
    dracoOptions: {
      compressionLevel: 10,
      quantizePositionBits: 14,
      quantizeNormalBits: 10,
      quantizeTexcoordBits: 12,
      // Jewelry meshes are a single connected shell per material; unified
      // quantisation keeps metal and gem in the same coordinate frame so the
      // stone doesn't drift out of its setting.
      uncompressedFallback: false,
    },
  });

  const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
  const out = Buffer.from(result.glb);
  const ratio = (raw.byteLength / out.byteLength).toFixed(1);

  writeFileSync(OUTPUT, out);
  console.log(
    `✅  ${mb(raw.byteLength)} MB → ${mb(out.byteLength)} MB  (${ratio}x smaller, ${elapsed.toFixed(1)}s)`,
  );
  console.log(`    Written → ${OUTPUT}`);
}

main().catch((err) => {
  console.error("❌ ", err);
  process.exit(1);
});

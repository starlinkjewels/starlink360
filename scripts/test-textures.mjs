/**
 * Procedural surface finishes.
 *
 * The two things that would ruin these are invisible in code review and obvious
 * on a ring: a pattern that does not tile leaves a seam running round the band,
 * and a normal map decoded as sRGB tilts every surface normal. Both are checked
 * numerically here.
 *
 * Usage: node scripts/test-textures.mjs
 */
import * as THREE from "three";
import {
  DEFAULT_CHANNELS,
  DEFAULT_TEXTURE,
  SURFACE_FINISHES,
  colourAt,
  createFinishMaps,
  ensureProjectedUVs,
  getFinishMaps,
  heightAt,
  isColourTexture,
  isTextureInert,
} from "../.tmp-jewelry/textures.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

const FINISHES = SURFACE_FINISHES.filter((f) => f.id !== "none").map((f) => f.id);

console.log("=== every finish tiles, so no seam runs round the band ===");
for (const f of FINISHES) {
  let worstU = 0;
  let worstV = 0;
  for (let i = 0; i < 64; i++) {
    const t = i / 64;
    worstU = Math.max(worstU, Math.abs(heightAt(f, 0, t) - heightAt(f, 0.999999, t)));
    worstV = Math.max(worstV, Math.abs(heightAt(f, t, 0) - heightAt(f, t, 0.999999)));
  }
  check(
    worstU < 0.2 && worstV < 0.2,
    `"${f}" wraps on both axes`,
    `u ${worstU.toFixed(3)} v ${worstV.toFixed(3)}`,
  );
}

console.log("\n=== every finish has real relief, and stays in range ===");
for (const f of FINISHES) {
  let lo = 1,
    hi = 0;
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 48; x++) {
      const h = heightAt(f, x / 48, y / 48);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  check(hi - lo > 0.08, `"${f}" is not flat`, `range ${lo.toFixed(2)}..${hi.toFixed(2)}`);
  check(
    lo >= -0.001 && hi <= 1.001,
    `"${f}" stays within 0..1`,
    `${lo.toFixed(3)}..${hi.toFixed(3)}`,
  );
}

console.log("\n=== the same finish is always identical ===");
check(
  heightAt("hammer", 0.31, 0.62) === heightAt("hammer", 0.31, 0.62),
  "deterministic, no Math.random",
);
check(getFinishMaps("brushed") === getFinishMaps("brushed"), "built once and cached");

console.log("\n=== maps ===");
check(createFinishMaps("none") === null, "polished builds nothing at all");
const maps = createFinishMaps("hammer");
check(maps !== null, "a finish builds both maps");
for (const [name, tex] of [
  ["normal", maps.normalMap],
  ["roughness", maps.roughnessMap],
]) {
  check(
    tex.colorSpace === THREE.NoColorSpace,
    `${name} map is data, not colour — an sRGB decode would corrupt it`,
    tex.colorSpace,
  );
  check(
    tex.wrapS === THREE.RepeatWrapping && tex.wrapT === THREE.RepeatWrapping,
    `${name} repeats`,
  );
  check(tex.generateMipmaps === true, `${name} has mipmaps, or it shimmers at distance`);
}
// A flat surface must encode as +Z, or the whole model is subtly tilted.
{
  const d = maps.normalMap.image.data;
  let maxZ = 0;
  for (let i = 2; i < d.length; i += 4) maxZ = Math.max(maxZ, d[i]);
  check(maxZ > 200, "flat areas point straight out of the surface", `peak blue ${maxZ}`);
}

console.log("\n=== projected UVs, for geometry that has none ===");
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
  );
  geo.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  check(ensureProjectedUVs(geo, 4) === true, "UVs are generated when missing");
  check(geo.attributes.uv.count === 3, "one UV per vertex", `${geo.attributes.uv?.count}`);
  const uvs = Array.from(geo.attributes.uv.array);
  check(
    uvs.some((n) => n !== 0),
    "they are not all zero — that is the flat-tint failure",
    JSON.stringify(uvs),
  );
  check(ensureProjectedUVs(geo, 4) === false, "existing UVs are never overwritten");

  // A face pointing along X must project from a different pair of axes than
  // one pointing along Z, or curved bands smear.
  const side = new THREE.BufferGeometry();
  side.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1]), 3),
  );
  side.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]), 3),
  );
  ensureProjectedUVs(side, 1);
  check(
    side.attributes.uv.getX(2) === 1,
    "an X-facing face projects from Z/Y",
    `${side.attributes.uv.getX(2)}`,
  );

  const bare = new THREE.BufferGeometry();
  check(
    ensureProjectedUVs(bare, 1) === false,
    "geometry with no position is skipped, not thrown on",
  );
}

console.log("\n=== the three hammer weights are actually different ===");
{
  /*
   * Three entries that render identically would be three lies in the grid. The
   * physical difference is the hammer face: fewer, wider dimples dish deeper.
   */
  const spread = (id) => {
    let lo = 1;
    let hi = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const h = heightAt(id, x / 64, y / 64);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    return hi - lo;
  };
  const one = spread("hammer");
  const two = spread("hammer2");
  const three = spread("hammer3");
  check(one > 0.05 && two > 0.05 && three > 0.05, "each hammer has real relief");
  check(
    three > two && two > one,
    "and a heavier hammer dishes deeper",
    `${one.toFixed(2)} < ${two.toFixed(2)} < ${three.toFixed(2)}`,
  );

  // A finish that does not tile shows a seam running round the band.
  for (const id of ["hammer", "hammer2", "hammer3", "velour-velvet", "oak-veneer"]) {
    let worst = 0;
    for (let i = 0; i < 64; i++) {
      const v = i / 64;
      worst = Math.max(worst, Math.abs(heightAt(id, 0, v) - heightAt(id, 0.999999, v)));
      worst = Math.max(worst, Math.abs(heightAt(id, v, 0) - heightAt(id, v, 0.999999)));
    }
    check(worst < 0.06, `${id} tiles without a seam`, worst.toFixed(3));
  }
}

console.log("\n=== colour textures paint, metal finishes never do ===");
{
  check(isColourTexture("velour-velvet"), "velvet is a colour texture");
  check(isColourTexture("oak-veneer"), "so is oak");
  check(!isColourTexture("hammer"), "a hammer is not");
  check(!isColourTexture("none"), "and neither is polished");

  /*
   * The whole reason for the split: a colour map on a hammered finish would
   * paint gold grey, which looks plausible in a screenshot and is wrong.
   */
  check(colourAt("hammer", 0.3, 0.4) === null, "a metal finish has no colour to apply");
  const oak = colourAt("oak-veneer", 0.3, 0.4);
  check(oak !== null && oak.r > oak.g && oak.g > oak.b, "oak is brown", JSON.stringify(oak));
  const velvet = colourAt("velour-velvet", 0.3, 0.4);
  check(velvet !== null && velvet.b > velvet.g, "velvet is not grey", JSON.stringify(velvet));

  let varies = false;
  for (let i = 1; i < 40 && !varies; i++) {
    const a = colourAt("oak-veneer", 0.1, 0.02 * i);
    const b = colourAt("oak-veneer", 0.1, 0);
    if (Math.abs(a.r - b.r) > 8) varies = true;
  }
  check(varies, "and its grain actually varies across the tile");
}

console.log("\n=== channels turn maps on and off ===");
{
  const all = createFinishMaps("hammer", 1, {
    color: true,
    roughness: true,
    normal: true,
    bump: true,
  });
  check(!!all.normalMap && !!all.roughnessMap && !!all.bumpMap, "every channel builds its map");
  check(
    all.map === null,
    "but a metal finish has no colour map even with the channel on — it cannot tint gold",
  );

  const normalOnly = createFinishMaps("hammer", 1, {
    color: false,
    roughness: false,
    normal: true,
    bump: false,
  });
  check(!!normalOnly.normalMap, "normal alone builds the normal map");
  check(
    normalOnly.roughnessMap === null && normalOnly.bumpMap === null,
    "and nothing else, so a switched-off channel costs no memory",
  );

  const oak = createFinishMaps("oak-veneer", 1, {
    color: true,
    roughness: true,
    normal: true,
    bump: false,
  });
  check(!!oak.map, "a colour texture does build a colour map");
  check(createFinishMaps("none", 1) === null, "polished builds nothing at all");
}

console.log("\n=== a texture setting knows when it does nothing ===");
{
  const on = { ...DEFAULT_TEXTURE, finish: "hammer" };
  check(!isTextureInert(on), "a chosen, enabled finish is live");
  check(isTextureInert(undefined), "no setting at all is inert");
  check(isTextureInert({ ...on, finish: "none" }), "polished is inert");
  check(isTextureInert({ ...on, enabled: false }), "and so is a disabled one");
  check(
    isTextureInert({
      ...on,
      channels: { color: false, roughness: false, normal: false, bump: false },
    }),
    "every channel off is inert too — otherwise it would build maps nobody reads",
  );
}

console.log("\n=== scale is baked into the cached texture ===");
{
  /*
   * `repeat` lives on the texture, and textures are shared between every part
   * using the finish. A caller setting it afterwards would change the scale for
   * every other part, and the last one to render would win.
   */
  const a = getFinishMaps("hammer", DEFAULT_CHANNELS, 1);
  const b = getFinishMaps("hammer", DEFAULT_CHANNELS, 4);
  check(a !== b, "two scales are two cache entries, not one shared texture");
  check(a.normalMap.repeat.x === 1 && b.normalMap.repeat.x === 4, "each carrying its own repeat");
  check(
    getFinishMaps("hammer", DEFAULT_CHANNELS, 1) === a,
    "and the same request comes back from cache",
  );

  const chanA = getFinishMaps("hammer", { ...DEFAULT_CHANNELS, normal: false }, 1);
  check(chanA !== a, "different channels are a different entry too");
  check(chanA.normalMap === null, "and honour their own channel set");
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);

/**
 * The light rig and the shadow camera.
 *
 * Two things are load-bearing here. The default rig has to reproduce the render
 * that was already signed off — these are transcribed numbers, not taste — and
 * the shadow camera has to refuse settings that make the shadow silently vanish
 * rather than error, which is the failure that reads as a broken feature.
 *
 * Usage: node scripts/test-lights.mjs
 */
import {
  DEFAULT_LIGHTS,
  addLight,
  casterOf,
  deleteLight,
  describeLights,
  duplicateLight,
  fieldsFor,
  isDefaultRig,
  nextId,
  resetLights,
  setCaster,
  updateLight,
} from "../.tmp-jewelry/lights.js";
import {
  DEFAULT_SHADOWS,
  SHADOW_MAP_SIZES,
  clampMapSize,
  clampShadows,
  shadowDensity,
  shadowFrustum,
  shadowWarning,
} from "../.tmp-jewelry/shadows.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

console.log("=== the default rig is the render that was signed off ===");
{
  /*
   * These are transcribed from the viewport JSX as it stood. Changing any of
   * them changes every render anyone has already approved, so they are asserted
   * literally rather than described.
   */
  const by = (id) => DEFAULT_LIGHTS.find((l) => l.id === id);
  check(DEFAULT_LIGHTS.length === 5, "five lights", `${DEFAULT_LIGHTS.length}`);

  const key = by("key");
  check(
    key.type === "spot" && key.intensity === 5.5 && key.color === "#fff6ee",
    "the key is a 5.5 spot at #fff6ee",
  );
  check(
    JSON.stringify(key.position) === "[2.8,6,3.5]" && key.angle === 0.38 && key.penumbra === 0.55,
    "at [2.8, 6, 3.5], cone 0.38, penumbra 0.55",
  );
  check(by("fill").intensity === 1.4 && by("fill").color === "#b8ccff", "the fill is 1.4, cool");
  check(by("rim").intensity === 1.1 && by("rim").color === "#ffd8a0", "the rim is 1.1, warm");
  check(by("ambient").intensity === 0.12, "ambient is 0.12");
  check(
    by("sparkle").intensity === 1.6 && by("sparkle").distance === 10,
    "the sparkle point is 1.6",
  );

  check(
    DEFAULT_LIGHTS.filter((l) => l.castShadow).length === 1,
    "exactly one light casts, as before",
  );
  check(new Set(DEFAULT_LIGHTS.map((l) => l.id)).size === 5, "every id is unique");
}

console.log("\n=== reset really resets ===");
{
  const rig = resetLights();
  check(isDefaultRig(rig), "a fresh rig is the default rig");
  const moved = updateLight(rig, "key", { intensity: 9 });
  check(!isDefaultRig(moved), "and a changed one is not, so Reset can be offered");
  // Mutating a returned rig must not corrupt the defaults for the next reset.
  rig[0].position[0] = 99;
  check(resetLights()[0].position[0] === 2.8, "the defaults are copied, not handed out");
}

console.log("\n=== the status line ===");
check(describeLights(DEFAULT_LIGHTS) === "5 lights · 5 on", "counts and actives");
check(
  describeLights(updateLight(DEFAULT_LIGHTS, "fill", { visible: false })) === "5 lights · 4 on",
  "a hidden light is still listed",
);
check(describeLights([DEFAULT_LIGHTS[0]]) === "1 light · 1 on", "and one light is singular");

console.log("\n=== adding, duplicating, deleting ===");
{
  let rig = resetLights();
  rig = addLight(rig, "point");
  check(rig.length === 6, "a light is added");
  // The default rig has no light called "point", so the first one may take it.
  check(rig[5].type === "point" && rig[5].id === "point", "with a free id", rig[5].id);

  rig = addLight(rig, "point");
  check(rig[6].id === "point-2", "and the next takes the first free suffix", rig[6].id);

  rig = addLight(rig, "spot");
  check(rig[7].id === "spot", "a different type starts from its own name", rig[7].id);
  check(new Set(rig.map((l) => l.id)).size === rig.length, "so ids never collide");

  const dup = duplicateLight(rig, "key");
  check(dup.length === rig.length + 1, "duplicate adds one");
  check(
    dup[1].id !== "key" && dup[1].label.includes("copy"),
    "next to the original, named as a copy",
  );
  check(
    dup[1].position[0] !== dup[0].position[0],
    "offset, because a copy in the same place looks like nothing happened",
  );
  check(
    dup[1].castShadow !== true,
    "and it does not also cast — two casters is a doubled shadow pass",
  );

  check(duplicateLight(rig, "nope").length === rig.length, "duplicating nothing does nothing");
  check(deleteLight(rig, "fill").some((l) => l.id === "fill") === false, "delete removes it");
  check(deleteLight(rig, "nope").length === rig.length, "deleting nothing does nothing");

  const before = resetLights();
  addLight(before, "spot");
  check(before.length === 5, "none of these mutate the input");
}

console.log("\n=== exactly one shadow caster ===");
{
  const rig = setCaster(resetLights(), "fill");
  check(rig.filter((l) => l.castShadow).length === 1, "setting a caster clears the old one");
  check(casterOf(rig)?.id === "fill", "and it is the one asked for");

  // Ambient has no direction, so it cannot cast whatever the user clicks.
  const bad = setCaster(resetLights(), "ambient");
  check(bad.filter((l) => l.castShadow).length === 0, "a light with no direction cannot cast");
  check(casterOf(bad) === null, "so nothing casts");

  const hidden = updateLight(setCaster(resetLights(), "key"), "key", { visible: false });
  check(casterOf(hidden) === null, "a hidden caster does not cast either");
}

console.log("\n=== which fields a type has ===");
check(fieldsFor("ambient").position === false, "ambient has no position");
check(fieldsFor("spot").angle && fieldsFor("spot").distance, "a spot has a cone and a falloff");
check(!fieldsFor("directional").angle, "a directional has no cone");
check(!fieldsFor("point").shadow, "and a point light is not offered as the caster");

console.log("\n=== shadow settings are brought into range ===");
{
  check(DEFAULT_SHADOWS.mode === "contact", "contact stays the default, so no render restyles");
  check(
    DEFAULT_SHADOWS.opacity === 0.42 &&
      DEFAULT_SHADOWS.blur === 2.6 &&
      DEFAULT_SHADOWS.spread === 6,
    "with the values the old settings had",
  );

  /*
   * The one that matters. near >= far does not throw — it produces a depth
   * range with nothing in it, and the shadow just disappears.
   */
  const inverted = clampShadows({ ...DEFAULT_SHADOWS, near: 10, far: 2 });
  check(
    inverted.far > inverted.near,
    "far is always beyond near",
    `${inverted.near}..${inverted.far}`,
  );
  const same = clampShadows({ ...DEFAULT_SHADOWS, near: 5, far: 5 });
  check(same.far > same.near, "even when they were typed equal");

  check(clampShadows({ ...DEFAULT_SHADOWS, opacity: 9 }).opacity === 1, "opacity is clamped");
  check(
    clampShadows({ ...DEFAULT_SHADOWS, samples: 0.4 }).samples === 1,
    "samples is a whole number",
  );
  check(clampShadows({ ...DEFAULT_SHADOWS, samples: 999 }).samples === 64, "and bounded");
  check(
    clampShadows({ ...DEFAULT_SHADOWS, left: 5 }).left === 0,
    "the left plane cannot cross zero",
  );
  check(clampShadows({ ...DEFAULT_SHADOWS, right: -5 }).right === 0, "nor the right");
}

console.log("\n=== map sizes are powers of two ===");
{
  for (const s of SHADOW_MAP_SIZES) check(clampMapSize(s) === s, `${s} is kept`);
  check(clampMapSize(1000) === 1024, "1000 snaps to 1024");
  check(clampMapSize(3000) === 2048, "3000 snaps to 2048", `${clampMapSize(3000)}`);
  check(clampMapSize(99999) === 4096, "and anything huge lands on the largest");
  check(clampMapSize(1) === 512, "anything tiny on the smallest");
}

console.log("\n=== the frustum scales with the piece ===");
{
  /*
   * Pieces are normalised to a unit sphere on load, so a frustum in absolute
   * units would need re-tuning for every ring. These are relative.
   */
  const small = shadowFrustum(DEFAULT_SHADOWS, 1);
  const big = shadowFrustum(DEFAULT_SHADOWS, 4);
  check(big.right > small.right, "a larger piece gets a larger frustum");
  check(big.far > small.far, "and a deeper one");
  check(small.left < 0 && small.right > 0, "the piece sits inside it");
  check(shadowFrustum(DEFAULT_SHADOWS, 0).far > 0, "a degenerate piece does not divide by zero");

  const dense = shadowDensity(DEFAULT_SHADOWS, 1);
  const stretched = shadowDensity({ ...DEFAULT_SHADOWS, size: 40 }, 1);
  check(dense > stretched, "covering more ground with one map means fewer texels per unit");
}

console.log("\n=== the warnings fire before the render, not after ===");
{
  check(shadowWarning(DEFAULT_SHADOWS, 1) === null, "the defaults are quiet");
  check(
    shadowWarning({ ...DEFAULT_SHADOWS, mode: "directional", enabled: false }, 1) === null,
    "a disabled shadow says nothing",
  );
  check(
    shadowWarning({ ...DEFAULT_SHADOWS, mode: "contact", mapWidth: 4096, mapHeight: 4096 }, 1) ===
      null,
    "and contact mode ignores the shadow-camera settings entirely",
  );
  const huge = shadowWarning(
    { ...DEFAULT_SHADOWS, mode: "directional", mapWidth: 4096, mapHeight: 4096 },
    1,
  );
  check(!!huge && /GPU/.test(huge), "a 4096 map warns about the cost", huge?.slice(0, 40));
  const stretched = shadowWarning({ ...DEFAULT_SHADOWS, mode: "directional", size: 40 }, 1);
  check(!!stretched && /blocky/.test(stretched), "a stretched map warns it will look blocky");
  const many = shadowWarning({ ...DEFAULT_SHADOWS, mode: "directional", samples: 40 }, 1);
  check(!!many && /softer/.test(many), "and pointless samples say so");
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);

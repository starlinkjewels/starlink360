/**
 * Ground plane and reflector gating.
 *
 * The important assertions here are not about looks. They are that the default
 * leaves the viewer exactly as it was, that a phone can never be handed a
 * reflection buffer it cannot afford, and that the ground and the contact
 * shadow are never coplanar — which z-fights into a flicker that only shows up
 * once someone orbits, i.e. after it has shipped.
 *
 * Usage: node scripts/test-ground.mjs
 */
import {
  DEFAULT_GROUND,
  REFLECTION_RESOLUTIONS,
  clampResolution,
  groundSize,
  groundY,
  maxReflectionResolution,
  reflectionWarning,
  clampGround,
  groundDimensions,
  usesReflector,
} from "../.tmp-jewelry/ground.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

console.log("=== the default changes nothing ===");
check(DEFAULT_GROUND.enabled === false, "ground is off, so today's look is untouched");
check(DEFAULT_GROUND.style === "matte", "matte is the starting style, not the expensive one");

console.log("\n=== a phone is never handed a buffer it cannot afford ===");
check(
  maxReflectionResolution(true) === 512,
  "coarse pointer caps at 512",
  `${maxReflectionResolution(true)}`,
);
check(maxReflectionResolution(false) === 2048, "desktop allows 2048");
check(
  clampResolution(2048, true) === 512,
  "a desktop setting opened on a phone is clamped, not honoured",
  `2048 -> ${clampResolution(2048, true)}`,
);
check(clampResolution(2048, false) === 2048, "desktop keeps what it asked for");
check(clampResolution(1024, true) === 512, "1024 on a phone clamps to 512");
check(clampResolution(256, true) === 256, "a value under the cap is left alone");
check(
  REFLECTION_RESOLUTIONS.every((r) => clampResolution(r, true) <= 512),
  "no listed resolution can escape the phone cap",
);
check(
  REFLECTION_RESOLUTIONS.every((r) => REFLECTION_RESOLUTIONS.includes(clampResolution(r, false))),
  "clamping always lands on a real option, never an arbitrary number",
);
// Junk from a stale saved setting must not produce something unusable.
check(
  clampResolution(1, true) === 256,
  "an absurdly small value floors at the smallest option",
  `1 -> ${clampResolution(1, true)}`,
);
check(clampResolution(99999, false) === 2048, "an absurdly large value ceilings at the cap");

console.log("\n=== ground and shadow are never coplanar ===");
for (const [halfHeight, radius, label] of [
  [1, 1, "unit piece"],
  [0.18, 1, "flat bangle"],
  [2.5, 3, "long necklace"],
  [0, 0, "degenerate model"],
]) {
  const { ground, shadow } = groundY(halfHeight, radius);
  check(
    ground < shadow,
    `${label}: ground sits below the shadow`,
    `${ground.toFixed(5)} < ${shadow.toFixed(5)}`,
  );
  const gap = shadow - ground;
  check(
    gap > 0 && gap < Math.max(radius, 1) * 0.02,
    `${label}: gap is small enough to be invisible`,
    gap.toExponential(2),
  );
}
check(
  groundY(1, 1).shadow === -1.08,
  "the shadow stays exactly where it already was",
  `${groundY(1, 1).shadow}`,
);

console.log("\n=== footprint ===");
check(groundSize(0.5, 12) === 6, "scales with the piece", `0.5 x 12 = ${groundSize(0.5, 12)}`);
check(
  groundSize(0, 12) > 0,
  "a zero-footprint model still gets a real plane",
  `${groundSize(0, 12)}`,
);

console.log("\n=== warnings say something, or nothing ===");
check(reflectionWarning(DEFAULT_GROUND, false) === null, "silent while the ground is off");
check(
  reflectionWarning({ ...DEFAULT_GROUND, enabled: true, style: "matte" }, true) === null,
  "silent for matte, even on a phone — matte is free",
);
const phone = reflectionWarning({ ...DEFAULT_GROUND, enabled: true, style: "mirror" }, true);
check(
  phone !== null && /twice/.test(phone),
  "warns on a phone, and says why",
  phone?.slice(0, 46) + "...",
);
const big = reflectionWarning(
  { ...DEFAULT_GROUND, enabled: true, style: "mirror", resolution: 2048 },
  false,
);
check(big !== null && /2048/.test(big), "warns about the most expensive setting");
const ok = reflectionWarning(
  { ...DEFAULT_GROUND, enabled: true, style: "mirror", resolution: 1024 },
  false,
);
check(
  ok !== null && /4K/.test(ok),
  "explains the soft reflection in a 4K export rather than leaving it a mystery",
);

console.log();
console.log("=== blank means auto, and zero does not ===");
{
  const auto = groundDimensions(DEFAULT_GROUND, 2);
  check(
    auto.width > 0 && auto.width === auto.length,
    "a blank square fits the piece",
    `${auto.width}`,
  );
  check(auto.segments === 64, "a blank circle gets a smooth default", `${auto.segments}`);
  check(auto.radius === auto.width / 2, "and a radius that matches the square's reach");

  const bigger = groundDimensions(DEFAULT_GROUND, 4);
  check(bigger.width > auto.width, "auto tracks the piece's own footprint");

  const fixed = groundDimensions({ ...DEFAULT_GROUND, width: 5, length: 9 }, 2);
  check(fixed.width === 5 && fixed.length === 9, "an explicit size wins over auto");

  /*
   * Zero is a legitimate thing to type and means a plane with no size. Treating
   * it as "blank" would make the field impossible to clear back to auto.
   */
  const zero = groundDimensions({ ...DEFAULT_GROUND, width: 0 }, 2);
  check(zero.width === 0, "zero is honoured, not read as blank");
  check(zero.length === auto.length, "and only the field that was set changes");

  check(
    groundDimensions({ ...DEFAULT_GROUND, segments: 2 }, 2).segments === 3,
    "a two-sided circle is not a shape, so it is floored at three",
  );
  check(
    groundDimensions({ ...DEFAULT_GROUND, segments: 5000 }, 2).segments === 256,
    "and a huge one is capped rather than building thousands of triangles",
  );
  check(
    groundDimensions({ ...DEFAULT_GROUND, segments: 40.6 }, 2).segments === 41,
    "segments are whole numbers",
  );
}

console.log();
console.log("=== the reflector's twelve parameters ===");
{
  const keys = [
    "resolution",
    "blurX",
    "blurY",
    "mixBlur",
    "mixStrength",
    "mixContrast",
    "mirror",
    "depthScale",
    "minDepthThreshold",
    "maxDepthThreshold",
    "depthToBlurRatioBias",
    "distortion",
  ];
  check(
    keys.every((k) => k in DEFAULT_GROUND),
    "all twelve are settings, not hardcoded",
    `${keys.filter((k) => k in DEFAULT_GROUND).length} of 12`,
  );

  /*
   * The one worth guarding. max below min does not error — it inverts the depth
   * fade, so the reflection appears exactly where it should have vanished,
   * which looks like a shader bug rather than a bad number.
   */
  const inverted = clampGround({ ...DEFAULT_GROUND, minDepthThreshold: 5, maxDepthThreshold: 1 });
  check(
    inverted.maxDepthThreshold >= inverted.minDepthThreshold,
    "max depth is never below min",
    `${inverted.minDepthThreshold}..${inverted.maxDepthThreshold}`,
  );

  check(clampGround({ ...DEFAULT_GROUND, mirror: 8 }).mirror === 1, "mirror is 0..1");
  check(clampGround({ ...DEFAULT_GROUND, blurX: -5 }).blurX === 0, "blur cannot go negative");
  check(
    clampGround({ ...DEFAULT_GROUND, width: null }).width === null,
    "clamping leaves auto as auto rather than turning it into a number",
  );
  check(
    clampGround({ ...DEFAULT_GROUND, segments: 900 }).segments === 256,
    "and still caps an explicit segment count",
  );
}

console.log();
console.log("=== the reflector is only paid for when it is on ===");
{
  check(!usesReflector(DEFAULT_GROUND), "off by default");
  check(
    !usesReflector({ ...DEFAULT_GROUND, style: "mirror" }),
    "a mirror on a hidden ground still costs nothing",
  );
  check(
    usesReflector({ ...DEFAULT_GROUND, enabled: true, style: "mirror" }),
    "and only counts when the ground is actually shown",
  );
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);

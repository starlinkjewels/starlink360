/**
 * Lighting defaults and the light tent.
 *
 * Two jobs.
 *
 * 1. The defaults are the photographic combination — studio environment, gem
 *    fire on — chosen deliberately rather than transcribed from whatever was
 *    already on screen. They are asserted literally so a stray edit cannot
 *    quietly drift the default look away from what was decided.
 *
 * 2. The tent is measured through the display path it will actually go through
 *    — ACES tone mapping at the viewer's exposure, then sRGB — because linear
 *    radiance says nothing about whether a facet reads as black on screen.
 *
 * Usage: node scripts/test-lighting.mjs
 */
import * as THREE from "three";
import {
  DEFAULT_LIGHTING,
  ENVIRONMENTS,
  createLightTent,
  environmentById,
  getLightTent,
  tentRadiance,
} from "../.tmp-jewelry/lighting.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

console.log("=== defaults are the photographic combination ===");
const APPROVED = {
  // Studio was tried here and reverted — see lighting.ts. At this product's
  // boosted envMapIntensity it punches black crescents into every chain link.
  environment: "warehouse",
  separateGemEnvironment: true,
  exposure: 1.4,
};
for (const [k, want] of Object.entries(APPROVED)) {
  check(DEFAULT_LIGHTING[k] === want, `${k} is ${want}`, `got ${DEFAULT_LIGHTING[k]}`);
}

/*
 * The individual light levels and the ground shadow used to live here too, and
 * their values are still asserted — in test:lights, against DEFAULT_LIGHTS and
 * DEFAULT_SHADOWS, which is where they moved when the rig became a list and the
 * shadow gained a real camera.
 *
 * They are checked as ABSENT here because leaving them behind was a real bug:
 * nothing rendered them any more, so four sliders in the Lighting panel moved
 * and changed no pixel. A field that no longer drives anything must not survive
 * in the settings object, or the panel will grow a control for it again.
 */
const RETIRED = [
  "ambient",
  "keyLight",
  "fillLight",
  "rimLight",
  "shadows",
  "shadowOpacity",
  "shadowBlur",
  "shadowSpread",
];
for (const k of RETIRED) {
  check(!(k in DEFAULT_LIGHTING), `${k} is gone, not left driving nothing`);
}
check(
  DEFAULT_LIGHTING.separateGemEnvironment === true,
  "the stones get their own light tent by default, so they show real fire",
);

console.log("\n=== environment list ===");
check(ENVIRONMENTS[0].id === "warehouse", "warehouse is first, and is the default");
check(
  ENVIRONMENTS.filter((e) => e.preset === null).length === 1,
  "exactly one generated environment (the tent); the rest are drei presets",
);
check(new Set(ENVIRONMENTS.map((e) => e.id)).size === ENVIRONMENTS.length, "ids are unique");
check(environmentById("nonsense").id === "warehouse", "an unknown id falls back, never throws");
check(environmentById("tent").preset === null, "the tent is looked up correctly");

console.log("\n=== the tent, as it will actually render ===");
/* three's ACESFilmicToneMapping, scalar form, then sRGB. */
const aces = (c) => {
  c *= DEFAULT_LIGHTING.exposure / 0.6;
  const a = c * (c + 0.0245786) - 0.000090537;
  const b = c * (0.983729 * c + 0.432951) + 0.238081;
  return Math.min(1, Math.max(0, a / b));
};
const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const screen = (r) => Math.round(srgb(aces(r)) * 255);

const N = 200000;
const GA = Math.PI * (3 - Math.sqrt(5));
const px = [];
for (let i = 0; i < N; i++) {
  const y = 1 - (i / (N - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = GA * i;
  px.push(screen(tentRadiance(Math.cos(th) * r, y, Math.sin(th) * r)));
}
px.sort((a, b) => a - b);
const pc = (f) => (px.filter(f).length / N) * 100;
const q = (p) => px[Math.floor(N * p)];

console.log(
  `        on screen 0-255: min ${px[0]}  p05 ${q(0.05)}  median ${q(0.5)}  max ${px[N - 1]}`,
);
check(
  pc((v) => v < 90) === 0,
  "nothing renders as a black hole (<90)",
  `${pc((v) => v < 90).toFixed(1)}%`,
);
check(px[0] >= 120, "even the darkest direction is a readable grey", `min ${px[0]}`);
const bright = pc((v) => v >= 180);
check(
  bright > 50 && bright < 85,
  "most of the sphere is bright, but not all of it",
  `${bright.toFixed(1)}%`,
);
const mid = pc((v) => v >= 90 && v < 180);
check(mid > 15, "midtones survive — this is what stops it going milky", `${mid.toFixed(1)}%`);

console.log("\n=== the baked texture ===");
const t0 = Date.now();
const tex = createLightTent();
const ms = Date.now() - t0;
const { data, width, height } = tex.image;
console.log(`        ${width}x${height} in ${ms}ms, ${(data.byteLength / 1048576).toFixed(2)} MB`);

check(
  tex.mapping === THREE.EquirectangularReflectionMapping,
  "equirectangular — the refraction shader samples with equirectUv, not a cube atlas",
);
check(tex.colorSpace === THREE.LinearSRGBColorSpace, "linear, since the values are radiance");
check(tex.type === THREE.HalfFloatType, "half-float, so highlights above 1 survive");
check(tex.generateMipmaps === true, "mipmaps on, or facet edges alias badly");
check(data.byteLength < 2 * 1048576, "about a megabyte, cheap enough to build on a phone");

const row = (y) => {
  let s = 0;
  for (let x = 0; x < width; x++) s += THREE.DataUtils.fromHalfFloat(data[(y * width + x) * 4]);
  return s / width;
};
check(
  row(height - 1) > row(0) * 3,
  "ceiling is bright and floor is not — the map is the right way up",
  `up ${row(height - 1).toFixed(2)} vs down ${row(0).toFixed(2)}`,
);

let nonFinite = 0;
let tinted = 0;
for (let i = 0; i < data.length; i += 4) {
  const r = THREE.DataUtils.fromHalfFloat(data[i]);
  if (!Number.isFinite(r)) nonFinite++;
  if (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2]) tinted++;
}
check(nonFinite === 0, "no NaN or Infinity anywhere in the map");
check(tinted === 0, "perfectly neutral — a stone takes its colour from itself, not the room");

check(getLightTent() === getLightTent(), "baked once and cached, not per model");

{
  check(ENVIRONMENTS.length === 12, "twelve to choose from", String(ENVIRONMENTS.length));
  check(new Set(ENVIRONMENTS.map((e) => e.id)).size === 12, "every id is unique");
  check(
    ENVIRONMENTS.every((e) => /^#[0-9a-f]{6}$/i.test(e.sky) && /^#[0-9a-f]{6}$/i.test(e.ground)),
    "every one has a sky and a ground colour for its swatch",
  );
  /*
   * A grid of twelve identical circles tells nobody anything. Each has to be
   * visibly its own thing, and each has to read as lit from above.
   */
  check(
    new Set(ENVIRONMENTS.map((e) => e.sky + e.ground)).size === 12,
    "and no two swatches are the same pair",
  );
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return (((n >> 16) & 255) * 0.2126 + ((n >> 8) & 255) * 0.7152 + (n & 255) * 0.0722) / 255;
  };
  check(
    ENVIRONMENTS.every((e) => lum(e.sky) > lum(e.ground)),
    "sky is lighter than ground in all of them, so none reads upside down",
  );
}

{
  check(
    DEFAULT_LIGHTING.environmentRotation === 0 && DEFAULT_LIGHTING.environmentIntensity === 1,
    "zero and one — the environment exactly as it was before these existed",
  );
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);

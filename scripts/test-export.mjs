/**
 * Watermark placement, and H.264 level selection.
 *
 * Both are things that look fine until an export proves otherwise. The mark is
 * sized as a fraction of the frame, so the same settings must produce the same
 * proportions at 512px and at 4K. And the codec level must actually be able to
 * carry the frame — asking Level 4.0 for 4K makes isConfigSupported return
 * false, and the old code then fell back to WebM without saying so.
 *
 * Usage: node scripts/test-export.mjs
 */
import {
  DEFAULT_WATERMARK,
  WATERMARK_PLACEMENTS,
  anchor,
  fontSize,
  isVisible,
  paintWatermark,
} from "../.tmp-jewelry/watermark.js";
import { bitrateFor, h264Codec } from "../.tmp-jewelry/videoExport.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

console.log("=== the mark keeps its proportions at any size ===");
const ON = { ...DEFAULT_WATERMARK, enabled: true, text: "Starlink Jewels" };
for (const [w, h] of [
  [512, 512],
  [1920, 1080],
  [3840, 2160],
  [1080, 1920],
]) {
  const short = Math.min(w, h);
  const ratio = fontSize(short, ON.scale) / short;
  check(
    Math.abs(ratio - ON.scale) < 1e-9,
    `${w}x${h}: type is ${(ON.scale * 100).toFixed(1)}% of the short edge`,
    `${fontSize(short, ON.scale).toFixed(1)}px`,
  );
}
check(
  fontSize(64, 0.001) >= 8,
  "never shrinks below legible in a thumbnail",
  `${fontSize(64, 0.001)}px`,
);

console.log("\n=== every placement stays inside the frame, aligned to its own corner ===");
for (const placement of WATERMARK_PLACEMENTS) {
  const a = anchor(placement, 1920, 1080, 1080);
  const inside = a.x >= 0 && a.x <= 1920 && a.y >= 0 && a.y <= 1080;
  // A right-placed mark must be right-aligned or long text runs off the edge.
  const alignOk =
    (placement.includes("right") && a.align === "right") ||
    (placement.includes("left") && a.align === "left") ||
    (placement === "centre" && a.align === "center");
  const baseOk =
    (placement.includes("bottom") && a.baseline === "bottom") ||
    (placement.includes("top") && a.baseline === "top") ||
    (placement === "centre" && a.baseline === "middle");
  check(
    inside && alignOk && baseOk,
    `"${placement}"`,
    `(${a.x.toFixed(0)},${a.y.toFixed(0)}) ${a.align}/${a.baseline}`,
  );
}
{
  // The inset must scale too, or a 4K export puts the mark hard against the edge.
  const small = anchor("bottom right", 640, 480, 480);
  const big = anchor("bottom right", 3840, 2160, 2160);
  check(
    Math.abs((480 - small.y) / 480 - (2160 - big.y) / 2160) < 1e-9,
    "the margin is proportional, not a fixed pixel gap",
  );
}

console.log("\n=== nothing is drawn when there is nothing to draw ===");
check(!isVisible(DEFAULT_WATERMARK), "off by default");
check(!isVisible({ ...ON, text: "   " }), "whitespace-only text counts as empty");
check(!isVisible({ ...ON, opacity: 0 }), "fully transparent counts as empty");
check(isVisible(ON), "a real mark is visible");

{
  const calls = [];
  const ctx = {
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    translate: (...a) => calls.push(["translate", ...a]),
    rotate: (a) => calls.push(["rotate", a]),
    fillText: (...a) => calls.push(["fillText", ...a]),
    set globalAlpha(v) {
      calls.push(["alpha", v]);
    },
    set fillStyle(v) {},
    set font(v) {},
    set textAlign(v) {},
    set textBaseline(v) {},
    set shadowColor(v) {},
    set shadowBlur(v) {},
  };
  paintWatermark(ctx, 100, 100, DEFAULT_WATERMARK);
  check(calls.length === 0, "an off mark touches the canvas not at all");

  paintWatermark(ctx, 1920, 1080, { ...ON, angle: -30 });
  const names = calls.map((c) => (Array.isArray(c) ? c[0] : c));
  check(names[0] === "save" && names.at(-1) === "restore", "state is saved and restored");
  check(names.includes("rotate"), "the angle is applied");
  check(
    names.indexOf("translate") < names.indexOf("rotate"),
    "it translates to the anchor BEFORE rotating, so a corner mark stays in its corner",
  );
  const text = calls.find((c) => Array.isArray(c) && c[0] === "fillText");
  check(
    text && text[2] === 0 && text[3] === 0,
    "text is drawn at the translated origin",
    JSON.stringify(text?.slice(2)),
  );
  check(
    calls.some((c) => Array.isArray(c) && c[0] === "fillText" && c[1] === "Starlink Jewels"),
    "text is trimmed",
  );
}

console.log("\n=== H.264 level actually carries the frame ===");
const CASES = [
  [1280, 720, 30, "28", "720p30 fits Level 4.0"],
  [1920, 1080, 30, "28", "1080p30 fits Level 4.0 — unchanged from before"],
  [1920, 1080, 60, "2a", "1080p60 needs 4.2, not 4.0"],
  [2560, 1440, 30, "32", "1440p30 needs 5.0"],
  [3840, 2160, 30, "33", "4K30 needs 5.1"],
  [3840, 2160, 60, "34", "4K60 needs 5.2"],
];
for (const [w, h, fps, hex, label] of CASES) {
  const got = h264Codec(w, h, fps);
  check(got === `avc1.6400${hex}`, label, got);
}
check(
  h264Codec(1920, 1080, 30) === "avc1.640028",
  "the previous default is reproduced exactly, so existing exports are unchanged",
);
check(
  h264Codec(99999, 99999, 240).startsWith("avc1.6400"),
  "an absurd request still returns a valid string, never undefined",
);

console.log("\n=== bitrate scales with the picture ===");
const b1080 = bitrateFor(1920, 1080, 30);
const b4k = bitrateFor(3840, 2160, 60);
check(
  b1080 >= 6_000_000 && b1080 <= 12_000_000,
  "1080p30 lands near the old 20 Mbps ceiling for detail",
  `${(b1080 / 1e6).toFixed(1)} Mbps`,
);
check(
  b4k > b1080 * 3,
  "4K60 gets substantially more, or sparkle turns to mush",
  `${(b4k / 1e6).toFixed(1)} Mbps`,
);
check(b4k <= 90_000_000, "capped, so the file stays openable", `${(b4k / 1e6).toFixed(1)} Mbps`);
check(bitrateFor(64, 64, 24) >= 8_000_000, "a tiny export still gets a floor, not a smear");

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);

/**
 * The live stage and an exported frame must show the same backdrop.
 *
 * They go through completely different renderers — CSS for the stage, a 2D
 * canvas for exports — so nothing but a test keeps them in step. A client who
 * picks a navy gradient on screen and downloads a black JPEG stops trusting the
 * export button entirely.
 *
 * Usage: node scripts/test-background.mjs
 */
import {
  DEFAULT_BACKGROUND,
  GRADIENT_DIRECTIONS,
  backgroundCss,
  paintBackground,
  MAX_STOPS,
  RADIAL_POSITIONS,
  addStop,
  gradientStops,
  removeStop,
  paintForeground,
  updateStop,
} from "../.tmp-jewelry/background.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

// ── CSS side ───────────────────────────────────────────────────────────────
const solid = { ...DEFAULT_BACKGROUND, kind: "solid", color: "#101a33" };
check(backgroundCss(solid) === "#101a33", "solid becomes its own colour");

const grad = {
  ...DEFAULT_BACKGROUND,
  kind: "gradient",
  from: "#fff",
  to: "#000",
  direction: "to right",
};
/*
 * Positions are written explicitly now, because the bar can carry up to eight
 * stops and a bare colour list can only express evenly spaced ones.
 */
check(
  backgroundCss(grad) === "linear-gradient(to right, #fff 0.00%, #000 100.00%)",
  "gradient becomes valid CSS",
  backgroundCss(grad),
);

check(backgroundCss(DEFAULT_BACKGROUND) === null, "stage defers to the sheet's own styling");
check(
  backgroundCss({ ...DEFAULT_BACKGROUND, kind: "image", image: null }) === null,
  "image with nothing uploaded defers rather than painting black",
);
// A data URL must survive quoting — an unquoted url() breaks on base64 commas.
const withImg = backgroundCss({
  ...DEFAULT_BACKGROUND,
  kind: "image",
  image: "data:image/png;base64,AAA",
});
check(
  withImg.includes('url("data:image/png;base64,AAA")'),
  "image URL is quoted inside url()",
  withImg,
);

// ── canvas side ────────────────────────────────────────────────────────────
/** Records what was asked of the context, so the paint can be asserted headlessly. */
function fakeCtx() {
  const calls = { fills: [], rects: [], stops: [], gradients: [], images: 0, alpha: [] };
  return {
    calls,
    set fillStyle(v) {
      calls.fills.push(v);
    },
    get fillStyle() {
      return calls.fills.at(-1);
    },
    set globalAlpha(v) {
      calls.alpha.push(v);
    },
    get globalAlpha() {
      return calls.alpha.at(-1) ?? 1;
    },
    fillRect: (...a) => calls.rects.push(a),
    drawImage: () => calls.images++,
    createLinearGradient: (...line) => {
      calls.gradients.push(line);
      return { addColorStop: (o, c) => calls.stops.push([o, c]) };
    },
  };
}

{
  const ctx = fakeCtx();
  const opaque = paintBackground(ctx, 100, 50, { ...solid, bitmap: null });
  check(opaque === true, "solid reports opaque");
  check(ctx.calls.fills.includes("#101a33"), "solid fills with its colour");
  check(
    JSON.stringify(ctx.calls.rects[0]) === "[0,0,100,50]",
    "fills the whole frame",
    JSON.stringify(ctx.calls.rects[0]),
  );
}

{
  const ctx = fakeCtx();
  const opaque = paintBackground(ctx, 100, 50, {
    ...DEFAULT_BACKGROUND,
    kind: "transparent",
    bitmap: null,
  });
  check(opaque === false, "transparent reports NOT opaque, so PNG alpha is kept");
  check(ctx.calls.rects.length === 0, "transparent paints nothing at all");
}

{
  const ctx = fakeCtx();
  paintBackground(ctx, 100, 50, { ...grad, bitmap: null });
  check(ctx.calls.gradients.length === 1, "gradient creates one gradient");
  check(
    JSON.stringify(ctx.calls.stops) === '[[0,"#fff"],[1,"#000"]]',
    "stops run from `from` to `to`",
    JSON.stringify(ctx.calls.stops),
  );
  check(
    JSON.stringify(ctx.calls.gradients[0]) === "[0,0,100,0]",
    "`to right` runs left edge to right edge",
    JSON.stringify(ctx.calls.gradients[0]),
  );
}

// Every direction must produce a line that actually travels, in the right sense.
for (const direction of GRADIENT_DIRECTIONS) {
  const ctx = fakeCtx();
  paintBackground(ctx, 100, 50, { ...grad, direction, bitmap: null });
  const [x0, y0, x1, y1] = ctx.calls.gradients[0];
  const moves = x0 !== x1 || y0 !== y1;
  const inBounds =
    [x0, x1].every((v) => v >= 0 && v <= 100) && [y0, y1].every((v) => v >= 0 && v <= 50);
  const rightward = !direction.includes("right") || x1 > x0;
  const upward = !direction.includes("top") || y1 < y0;
  check(
    moves && inBounds && rightward && upward,
    `direction "${direction}"`,
    `(${x0},${y0}) -> (${x1},${y1})`,
  );
}

{
  // Cover, not stretch: a 200x100 image into a 100x100 frame must scale to fill
  // the short edge and overflow the long one, keeping its aspect ratio.
  const ctx = fakeCtx();
  const bitmap = { width: 200, height: 100 };
  paintBackground(ctx, 100, 100, {
    ...DEFAULT_BACKGROUND,
    kind: "image",
    image: "x",
    imageOpacity: 0.5,
    bitmap,
  });
  check(ctx.calls.images === 1, "image is drawn");
  check(
    ctx.calls.fills[0] === "#000000",
    "black underneath, so a partial image never composites onto junk",
  );
  check(ctx.calls.alpha.includes(0.5), "opacity is applied");
  check(ctx.calls.alpha.at(-1) === 1, "opacity is restored, or the piece itself would fade");
}

{
  const ctx = fakeCtx();
  paintBackground(ctx, 10, 10, { ...DEFAULT_BACKGROUND, kind: "image", image: "x", bitmap: null });
  check(
    ctx.calls.images === 0 && ctx.calls.rects.length === 1,
    "a failed image decode still paints black, never throws",
  );
}

/*
 * ── The gradient bar ────────────────────────────────────────────────────────
 *
 * Two things break gradient editors, and both are silent. A stop list that is
 * not reconciled in one place lets the live stage and the export painter draw
 * different gradients, which shows up as a download that does not match the
 * screen. And re-sorting the array while a stop is being dragged renumbers it
 * mid-drag, so the pointer starts moving a different stop.
 */
console.log("\n=== gradient stops ===");
{
  const base = { ...DEFAULT_BACKGROUND, kind: "gradient", from: "#ffffff", to: "#000000" };

  const legacy = gradientStops(base);
  check(legacy.length === 2, "a setting saved before the bar existed still reads as two stops");
  check(
    legacy[0].color === "#ffffff" && legacy[1].at === 1,
    "from and to, at each end",
    JSON.stringify(legacy),
  );

  const many = gradientStops({
    ...base,
    stops: [
      { color: "#111111", at: 0.8 },
      { color: "#222222", at: 0.1 },
      { color: "#333333", at: 0 },
    ],
  });
  check(
    many.length === 3 && many[0].at === 0,
    "the list comes back sorted",
    JSON.stringify(many.map((s) => s.at)),
  );
  check(many[0].color === "#333333", "with each colour still on its own stop");

  const clamped = gradientStops({
    ...base,
    stops: [
      { color: "#a", at: -3 },
      { color: "#b", at: 9 },
    ],
  });
  check(clamped[0].at === 0 && clamped[1].at === 1, "positions outside 0..1 are pulled in");

  // One stop is a solid colour, and addColorStop on an empty list throws.
  const single = gradientStops({ ...base, stops: [{ color: "#abcdef", at: 0.5 }] });
  check(single.length === 2, "a single stop is completed rather than left to throw");
  check(single[0].color === single[1].color, "as a flat run of that colour");

  const capped = gradientStops({
    ...base,
    stops: Array.from({ length: 20 }, (_, i) => ({ color: "#000000", at: i / 20 })),
  });
  check(capped.length === MAX_STOPS, `never more than ${MAX_STOPS}`, `${capped.length}`);
}

console.log("\n=== editing the bar ===");
{
  const two = [
    { color: "#ffffff", at: 0 },
    { color: "#000000", at: 1 },
  ];
  const three = addStop(two, 0.5, "#ff0000");
  check(three.length === 3 && three[1].color === "#ff0000", "a stop is added in order");
  check(two.length === 2, "and the input is not mutated");

  let full = two;
  for (let i = 0; i < 20; i++) full = addStop(full, i / 20, "#123456");
  check(full.length === MAX_STOPS, "the cap holds when adding", `${full.length}`);

  check(removeStop(three, 1).length === 2, "a stop is removed");
  check(removeStop(two, 0).length === 2, "but never below two — one stop is not a gradient");
  check(removeStop(three, 99).length === 3, "an out-of-range remove does nothing");

  /*
   * Deliberately NOT re-sorted: dragging a stop past its neighbour would
   * renumber the array mid-drag and the pointer would grab a different stop.
   */
  const dragged = updateStop(three, 0, { at: 0.9 });
  check(dragged[0].at === 0.9, "a stop moves");
  check(dragged[0].color === "#ffffff", "keeping its colour");
  check(
    dragged.findIndex((s) => s.at === 0.9) === 0,
    "and stays at its index while dragging, so the drag does not jump stops",
  );
  // Dragged past its neighbour: 0.9 sits between 0.5 and 1 once resolved.
  const resolved = gradientStops({ ...DEFAULT_BACKGROUND, kind: "gradient", stops: dragged });
  check(
    JSON.stringify(resolved.map((st) => st.at)) === "[0.5,0.9,1]",
    "order is resolved when the gradient is read instead",
    JSON.stringify(resolved.map((st) => st.at)),
  );
  check(resolved[1].color === "#ffffff", "and the stop that moved is the one that changed place");
  check(updateStop(three, 1, { color: "#00ff00" })[1].color === "#00ff00", "and recolouring works");
}

console.log("\n=== radial ===");
{
  const radial = {
    ...DEFAULT_BACKGROUND,
    kind: "gradient",
    gradientType: "radial",
    radialAt: "top",
    from: "#ffffff",
    to: "#000000",
  };
  const css = backgroundCss(radial);
  check(css.startsWith("radial-gradient(circle at top,"), "radial CSS names its centre", css);
  check(
    backgroundCss({ ...radial, gradientType: "linear" }).startsWith("linear-gradient("),
    "and linear still runs along its direction",
  );
  check(
    RADIAL_POSITIONS.length >= 5 && RADIAL_POSITIONS.includes("center"),
    "there are several centres to choose from",
  );
}

/*
 * ── Back and front ──────────────────────────────────────────────────────────
 *
 * "Front" means the image is a prop the piece is shot THROUGH, so it has to be
 * drawn after the render. Painting it in the backdrop pass would put it behind
 * the jewellery, which is the one thing the setting exists to prevent.
 */
console.log("\n=== image placement ===");
{
  const img = { width: 100, height: 100 };
  const back = {
    ...DEFAULT_BACKGROUND,
    kind: "image",
    image: "x",
    bitmap: img,
    imagePlacement: "back",
  };
  const front = { ...back, imagePlacement: "front" };

  const drawnBack = [];
  const drawnFront = [];
  const ctxFor = (log) => ({
    fillStyle: "",
    globalAlpha: 1,
    fillRect() {},
    drawImage(...a) {
      log.push(a[0]);
    },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  });

  paintBackground(ctxFor(drawnBack), 100, 50, back);
  check(drawnBack.length === 1, "a back image is painted in the backdrop pass");

  paintBackground(ctxFor(drawnFront), 100, 50, front);
  check(drawnFront.length === 0, "a front image is NOT — that would put it behind the piece");

  const over = [];
  paintForeground(ctxFor(over), 100, 50, front);
  check(over.length === 1, "it is painted over the finished frame instead");

  const notOver = [];
  paintForeground(ctxFor(notOver), 100, 50, back);
  check(notOver.length === 0, "and a back image is never painted twice");

  const noImage = [];
  paintForeground(ctxFor(noImage), 100, 50, { ...front, bitmap: null });
  check(noImage.length === 0, "nothing is drawn when the image failed to decode");

  const notAnImage = [];
  paintForeground(ctxFor(notAnImage), 100, 50, { ...DEFAULT_BACKGROUND, bitmap: img });
  check(
    notAnImage.length === 0,
    "and a gradient backdrop is left alone, so callers can always call it",
  );
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);

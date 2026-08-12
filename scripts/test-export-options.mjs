/**
 * Export options and project files.
 *
 * Two areas where a silent mistake is expensive. DPI metadata is invisible until
 * a client places the image in InDesign and it lands at the wrong size — and a
 * malformed chunk corrupts the file outright rather than being ignored. And a
 * project file is user-supplied JSON that goes straight into a renderer, so it
 * has to survive being older, newer, truncated or hostile.
 *
 * Usage: node scripts/test-export-options.mjs
 */
import { deflateSync } from "node:zlib";
import {
  DPI_CHOICES,
  ROTATION_MODES,
  loopsCleanly,
  printSize,
  readJpegDpi,
  readPngDpi,
  resolveFileName,
  sweepRadians,
  withJpegDpi,
  withPngDpi,
} from "../.tmp-suite/components/jewelry/exportOptions.js";
import {
  PROJECT_VERSION,
  loadProject,
  pieceMismatch,
  projectFileName,
  projectJson,
  saveProject,
} from "../.tmp-suite/components/jewelry/project.js";
import { DEFAULT_CAMERA } from "../.tmp-suite/components/jewelry/camera.js";
import { DEFAULT_LIGHTING } from "../.tmp-suite/components/jewelry/lighting.js";
import { resetLights } from "../.tmp-suite/components/jewelry/lights.js";
import { DEFAULT_SHADOWS } from "../.tmp-suite/components/jewelry/shadows.js";
import { DEFAULT_GROUND } from "../.tmp-suite/components/jewelry/ground.js";
import { DEFAULT_BACKGROUND } from "../.tmp-suite/components/jewelry/background.js";
import { DEFAULT_POST } from "../.tmp-suite/components/jewelry/bloom.js";
import { DEFAULT_WATERMARK } from "../.tmp-suite/components/jewelry/watermark.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

console.log("=== file names ===");
check(
  resolveFileName("", "LP-043_front_2048.png", "png") === "LP-043_front_2048.png",
  "blank uses the generated name",
);
check(
  resolveFileName("Emerald ring", "gen.png", "png") === "Emerald ring.png",
  "a typed name gets the extension",
);
check(
  resolveFileName("Emerald ring.png", "gen.png", "png") === "Emerald ring.png",
  "and is not doubled up when it already has one",
);
check(
  resolveFileName("Ring.PNG", "gen.png", "png") === "Ring.PNG",
  "whatever case it was typed in",
);
/*
 * A name with a slash means a filename, not a path. Rejecting it would be
 * pedantic; substituting underscores makes an ugly name. Dropping is the least
 * surprising of the three.
 */
check(
  resolveFileName('Ring / "Emerald" <2>', "gen.png", "png") === "Ring Emerald 2.png",
  "path and reserved characters are dropped",
  resolveFileName('Ring / "Emerald" <2>', "gen.png", "png"),
);
check(resolveFileName("   ", "gen.png", "png") === "gen.png", "whitespace only is still blank");
check(resolveFileName("x".repeat(400), "gen.png", "png").length <= 124, "and a huge name is cut");

console.log("\n=== rotation modes ===");
{
  const TAU = Math.PI * 2;
  check(ROTATION_MODES.length === 4, "four modes offered");
  check(Math.abs(sweepRadians("full", 1, 0) - TAU) < 1e-9, "360 is one turn");
  check(Math.abs(sweepRadians("half", 1, 0) - Math.PI) < 1e-9, "180 is half");
  check(
    Math.abs(sweepRadians("duration", 3, 0) - TAU * 3) < 1e-9,
    "duration honours the turn count",
  );
  check(Math.abs(sweepRadians("custom", 1, 90) - Math.PI / 2) < 1e-9, "custom is degrees");

  /*
   * Clamped rather than wrapped. Someone typing 720 means two turns; wrapping
   * it to zero would produce a still frame with nothing to explain it.
   */
  check(sweepRadians("custom", 1, 720) > TAU, "720 degrees is two turns, not zero");
  check(sweepRadians("custom", 1, -50) === 0, "a negative is floored rather than reversed");
  check(
    sweepRadians("duration", 0, 0) > 0,
    "a zero turn count still moves, so the clip is not frozen",
  );

  // A clip that stops at 350 degrees visibly jumps when it loops.
  check(loopsCleanly("full", 1, 0), "360 loops cleanly");
  check(loopsCleanly("duration", 2, 0), "so do whole turns");
  check(!loopsCleanly("half", 1, 0), "180 does not");
  check(!loopsCleanly("custom", 1, 350), "and nor does 350");
  check(loopsCleanly("custom", 1, 360), "but 360 typed by hand does");
}

console.log("\n=== print size ===");
{
  check(DPI_CHOICES.includes(300), "300 is offered, which is what print asks for");
  const a = printSize(3000, 300);
  check(Math.abs(a.inches - 10) < 1e-9, "3000px at 300dpi is 10 inches", a.inches.toFixed(2));
  check(Math.abs(a.mm - 254) < 1e-6, "which is 254mm", a.mm.toFixed(1));
  check(printSize(1000, 0).inches > 0, "a zero DPI does not divide by zero");
}

console.log("\n=== PNG density ===");
{
  /** The smallest real PNG: signature, IHDR, one IDAT, IEND. */
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    Buffer.from(data).copy(out, 8);
    // CRC over type + data.
    let c = 0xffffffff;
    for (const b of out.subarray(4, 8 + data.length)) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  check(readPngDpi(new Uint8Array(png)) === null, "a fresh PNG carries no density");

  const at300 = withPngDpi(new Uint8Array(png), 300);
  check(readPngDpi(at300) === 300, "300 is written and reads back", String(readPngDpi(at300)));
  check(
    at300.length === png.length + 21,
    "as exactly one 21-byte chunk",
    `${at300.length - png.length}`,
  );

  /*
   * A decoder reads the FIRST pHYs it meets, so writing twice must replace
   * rather than append — otherwise the second setting is silently ignored.
   */
  const at72 = withPngDpi(at300, 72);
  check(readPngDpi(at72) === 72, "writing again replaces it", String(readPngDpi(at72)));
  check(at72.length === at300.length, "without growing the file", `${at72.length - at300.length}`);

  // pHYs must precede IDAT, and the signature and IHDR must be untouched.
  const idatAt = at300.indexOf(0x49, 8);
  const physAt = Array.from(at300).findIndex(
    (_, i) =>
      at300[i] === 0x70 && at300[i + 1] === 0x48 && at300[i + 2] === 0x59 && at300[i + 3] === 0x73,
  );
  check(physAt > 0 && physAt < idatAt + 40, "and sits before the image data");
  check(Buffer.from(at300.subarray(0, 8)).equals(png.subarray(0, 8)), "the signature survives");
  check(
    Buffer.from(at300.subarray(8, 8 + 25)).equals(png.subarray(8, 8 + 25)),
    "and so does IHDR, byte for byte",
  );
  // Round-tripping through Node's own inflate proves the stream is still intact.
  check(
    Buffer.from(at300).includes(Buffer.from("IEND")),
    "IEND is still there, so the file is complete",
  );

  const notPng = new Uint8Array([1, 2, 3, 4]);
  check(withPngDpi(notPng, 300) === notPng, "a non-PNG is returned untouched, not corrupted");
}

console.log("\n=== JPEG density ===");
{
  // SOI, a JFIF APP0 at 96dpi, then EOI.
  const withHeader = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
    0x00, 0x60, 0x00, 0x00, 0xff, 0xd9,
  ]);
  check(readJpegDpi(withHeader) === 96, "the fixture reads as 96", String(readJpegDpi(withHeader)));
  const set = withJpegDpi(withHeader, 300);
  check(readJpegDpi(set) === 300, "and is rewritten to 300");
  check(set.length === withHeader.length, "in place, without resizing the segment");

  // A JPEG with no JFIF segment at all — legal, and common from canvas.
  const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0x00, 0xff, 0xd9]);
  const added = withJpegDpi(bare, 300);
  check(readJpegDpi(added) === 300, "a JPEG with no JFIF gets one inserted");
  check(
    added[0] === 0xff && added[1] === 0xd8,
    "immediately after SOI, which is the only legal place",
  );
  check(
    added.length === bare.length + 18,
    "as one minimal APP0 segment",
    `${added.length - bare.length}`,
  );
  check(
    Buffer.from(added.subarray(added.length - 2)).equals(Buffer.from([0xff, 0xd9])),
    "and the rest of the file follows intact",
  );

  const notJpeg = new Uint8Array([1, 2, 3]);
  check(withJpegDpi(notJpeg, 300) === notJpeg, "a non-JPEG is returned untouched");
}

console.log("\n=== saving a project ===");
const INPUT = {
  piece: { name: "Lumière Pendant", ref: "LP 043" },
  finish: { id: "gold-18k", surface: "hammer" },
  materials: { "Gem 01|#ffffff": { material: "ruby" } },
  textures: {},
  camera: DEFAULT_CAMERA,
  lighting: DEFAULT_LIGHTING,
  lights: resetLights(),
  shadows: DEFAULT_SHADOWS,
  ground: DEFAULT_GROUND,
  background: DEFAULT_BACKGROUND,
  post: DEFAULT_POST,
  watermark: DEFAULT_WATERMARK,
  animation: { move: "turntable", objectMove: "drop", seconds: 8 },
};
{
  const saved = saveProject(INPUT, "2026-08-12T10:00:00Z");
  check(saved.version === PROJECT_VERSION, "the version is stamped");
  check(saved.app === "RenderGod", "and the app, for anyone opening it in an editor");

  const round = loadProject(projectJson(saved));
  check(round.project !== null, "a saved project loads");
  check(round.notices.length === 0, "with nothing to report");
  check(round.project.lights.length === saved.lights.length, "the rig survives");
  check(round.project.finish.surface === "hammer", "and the surface finish");
  check(
    round.project.materials["Gem 01|#ffffff"].material === "ruby",
    "and the material assignments, keyed as they were",
  );
  check(
    JSON.stringify(round.project.camera) === JSON.stringify(DEFAULT_CAMERA),
    "settings round-trip exactly",
  );
  check(
    round.project.animation.move === "turntable" &&
      round.project.animation.objectMove === "drop" &&
      round.project.animation.seconds === 8,
    "and so does the chosen shot",
    JSON.stringify(round.project.animation),
  );
}

console.log("\n=== a project file is never trusted ===");
{
  check(loadProject("not json").project === null, "junk is refused, not thrown on");
  check(/JSON/.test(loadProject("not json").notices[0]), "with a reason");
  check(loadProject("[]").project === null, "an array is not a project");
  check(loadProject("{}").project === null, "and neither is an object with no version");

  /*
   * A file from a newer build loads anyway. Its extra fields are ignored, which
   * is a better outcome than refusing to open someone's work.
   */
  const newer = loadProject(JSON.stringify({ version: 99, piece: {}, whatever: true }));
  check(newer.project !== null, "a newer file still opens");
  check(
    newer.notices.some((n) => /newer/.test(n)),
    "and says so",
  );

  /*
   * A project saved with the old `{ autoRotate, rotateSpeed }` animation shape.
   * Those fields described an OrbitControls spin that no longer exists, so they
   * must contribute nothing rather than being coerced into the new shape — the
   * file should open with no move, not with a move invented from a boolean.
   */
  const legacySpin = loadProject(
    JSON.stringify({ version: 1, piece: {}, animation: { autoRotate: true, rotateSpeed: 2 } }),
  );
  check(
    legacySpin.project.animation.move === null,
    "a project from before the move library opens with no move",
  );
  check(legacySpin.project.animation.objectMove === "none", "and the piece at rest");
  check(legacySpin.project.animation.seconds === 6, "with a usable default length");

  // Older files simply lack fields, which must fall back rather than break.
  const older = loadProject(JSON.stringify({ version: 1, piece: { ref: "X" } }));
  check(older.project !== null, "an older file opens");
  check(
    JSON.stringify(older.project.ground) === JSON.stringify(DEFAULT_GROUND),
    "with anything missing taken from the defaults",
  );

  // Hostile values reach a renderer, so every one is checked.
  const hostile = loadProject(
    JSON.stringify({
      version: 1,
      piece: { ref: "X" },
      camera: { fov: "big", nearFactor: NaN, projection: 42 },
      lighting: { exposure: Infinity },
      lights: [{ id: "a", type: "laser", color: "javascript:alert(1)", intensity: "loads" }],
      shadows: { near: 50, far: 1 },
    }),
  );
  const p = hostile.project;
  check(p !== null, "a hostile file still opens rather than crashing the picker");
  check(p.camera.fov === DEFAULT_CAMERA.fov, "a string where a number belongs is rejected");
  check(Number.isFinite(p.camera.nearFactor), "NaN is rejected");
  check(Number.isFinite(p.lighting.exposure), "and Infinity");
  check(p.lights[0].type === "directional", "an unknown light type falls back");
  check(p.lights[0].color === "#ffffff", "a non-colour string never reaches a shader");
  check(p.lights[0].intensity === 1, "and neither does a non-numeric intensity");
  check(p.shadows.far > p.shadows.near, "cross-field rules are still enforced on load");

  // A rig with no lights renders a black frame, which reads as a broken file.
  const dark = loadProject(JSON.stringify({ version: 1, piece: {}, lights: [] }));
  check(dark.project.lights.length > 0, "an empty rig is replaced rather than rendering black");
  check(
    dark.notices.some((n) => /lights/.test(n)),
    "and the user is told",
  );
}

console.log("\n=== opening a project against another piece ===");
{
  const saved = saveProject(INPUT, "2026-08-12T10:00:00Z");
  check(pieceMismatch(saved, "LP 043") === null, "the same piece says nothing");
  const other = pieceMismatch(saved, "AB 001");
  check(!!other && /LP 043/.test(other), "a different one names what it was saved for");
  check(
    /materials/.test(other),
    "and warns that part-keyed materials will not match, rather than leaving it a mystery",
  );
  check(pieceMismatch(saved, "") === null, "an unknown current piece stays quiet");
}

console.log("\n=== project file names ===");
check(projectFileName("LP 043") === "LP-043.rendergod.json", "a ref becomes a filename");
check(projectFileName("REF. LP 043") === "LP-043.rendergod.json", "the REF prefix is dropped");
check(projectFileName("") === "project.rendergod.json", "and nothing at all still has a name");

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);

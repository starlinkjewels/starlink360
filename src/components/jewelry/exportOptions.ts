/*
 * Export options: file name, DPI, and how far a turntable turns.
 *
 * The DPI half is the interesting one. `canvas.toBlob` always writes 96 DPI, so
 * a 4000px render placed in InDesign lands at 42 inches wide and someone has to
 * retype the size on every image. The pixels are already right — only the
 * metadata is wrong — so this rewrites that metadata in the encoded bytes
 * rather than re-encoding anything.
 */

/**
 * The settings that apply to a DOWNLOAD rather than to the render.
 *
 * Kept here rather than in the panel because exporting a constant from a
 * component file breaks fast refresh — the same rule the toolbar hit.
 */
export interface ExportOptions {
  imageName: string;
  dpi: number;
  videoName: string;
  rotationMode: RotationMode;
  customDegrees: number;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  imageName: "",
  dpi: 300,
  videoName: "",
  // The old behaviour: turn for as long as the clip lasts.
  rotationMode: "duration",
  customDegrees: 360,
};

export type RotationMode = "duration" | "half" | "full" | "custom";

export const ROTATION_MODES: { value: RotationMode; label: string; hint: string }[] = [
  { value: "duration", label: "Duration", hint: "Turns for as long as the clip lasts" },
  { value: "half", label: "180°", hint: "Half a turn, front to back" },
  { value: "full", label: "360°", hint: "One complete turn" },
  { value: "custom", label: "Custom", hint: "An exact number of degrees" },
];

/**
 * How far the turntable sweeps, in radians.
 *
 * "Duration" is the old behaviour: `turns` complete revolutions however long
 * the clip is. The fixed modes exist because a loop has to close — a clip that
 * stops at 350° visibly jumps when it repeats, and getting there by tuning
 * seconds against speed is guesswork.
 */
export function sweepRadians(mode: RotationMode, turns: number, customDegrees: number): number {
  const TAU = Math.PI * 2;
  switch (mode) {
    case "half":
      return Math.PI;
    case "full":
      return TAU;
    case "custom":
      // Clamped, not wrapped: someone typing 720 means two turns, and wrapping
      // it to zero would produce a still frame with no explanation.
      return (Math.min(3600, Math.max(0, customDegrees)) * Math.PI) / 180;
    default:
      return TAU * Math.max(0.01, turns);
  }
}

/** True when the sweep closes on itself, so the clip loops without a jump. */
export function loopsCleanly(mode: RotationMode, turns: number, customDegrees: number): boolean {
  const TAU = Math.PI * 2;
  const sweep = sweepRadians(mode, turns, customDegrees);
  const remainder = Math.abs(sweep % TAU);
  return remainder < 1e-6 || Math.abs(remainder - TAU) < 1e-6;
}

/**
 * The name a download is given.
 *
 * A typed name wins; blank falls back to the generated one, which is a name a
 * client can file without renaming. The typed name is stripped of anything a
 * filesystem would reject rather than being refused — someone typing
 * "Ring / Emerald" means a filename, not a path.
 */
export function resolveFileName(custom: string, generated: string, ext: string): string {
  const cleaned = custom
    .trim()
    // Path separators and the Windows-reserved set. Dropped, not substituted,
    // because a name full of underscores is worse than a shorter one.
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim();
  if (!cleaned) return generated;
  // Do not double up an extension the user already typed.
  return cleaned.toLowerCase().endsWith(`.${ext}`) ? cleaned : `${cleaned}.${ext}`;
}

/** Print sizes a jeweller is actually asked for. */
export const DPI_CHOICES = [72, 96, 150, 300, 600] as const;

/** Physical size of a render at a chosen DPI, for the panel to show. */
export function printSize(pixels: number, dpi: number): { inches: number; mm: number } {
  const d = Math.max(1, dpi);
  const inches = pixels / d;
  return { inches, mm: inches * 25.4 };
}

/* ── DPI metadata ────────────────────────────────────────────────────────── */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Writes a pHYs chunk into a PNG, so it opens at the intended physical size.
 *
 * pHYs carries pixels per METRE, not per inch, and a decoder reads the first
 * one it meets — so an existing chunk is replaced rather than a second appended.
 * The chunk must also come before IDAT; inserting immediately after IHDR is the
 * only placement that is unconditionally legal.
 *
 * Returns the input untouched if it is not a PNG, rather than corrupting it.
 */
export function withPngDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (bytes.length < 8 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return bytes;

  const perMetre = Math.round((Math.max(1, dpi) * 10000) / 254);

  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9); // length of the data section
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, perMetre);
  view.setUint32(12, perMetre);
  chunk[16] = 1; // unit specifier: metres
  view.setUint32(17, crc32(chunk.subarray(4, 17)));

  // Walk the chunks: find where IHDR ends, and drop any pHYs already present.
  let at = 8;
  let insertAt = -1;
  const drop: { start: number; end: number }[] = [];
  while (at + 8 <= bytes.length) {
    const len = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const end = at + 12 + len;
    if (end > bytes.length) break;
    if (type === "IHDR") insertAt = end;
    if (type === "pHYs") drop.push({ start: at, end });
    if (type === "IEND") break;
    at = end;
  }
  if (insertAt < 0) return bytes;

  const out = new Uint8Array(
    bytes.length + chunk.length - drop.reduce((n, d) => n + (d.end - d.start), 0),
  );
  let w = 0;
  let r = 0;
  const write = (from: number, to: number) => {
    out.set(bytes.subarray(from, to), w);
    w += to - from;
  };
  write(0, insertAt);
  out.set(chunk, w);
  w += chunk.length;
  r = insertAt;
  for (const d of drop) {
    if (d.start < r) continue;
    write(r, d.start);
    r = d.end;
  }
  write(r, bytes.length);
  return out.subarray(0, w);
}

/**
 * Writes the density into a JPEG's JFIF header.
 *
 * JFIF is optional, so a file without one gets a minimal APP0 segment inserted
 * straight after SOI — which is the only place it is allowed to be.
 *
 * Returns the input untouched if it is not a JPEG.
 */
export function withJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));

  // An existing JFIF APP0 is at offset 2 if it is there at all.
  const hasJfif =
    bytes[2] === 0xff &&
    bytes[3] === 0xe0 &&
    bytes[6] === 0x4a &&
    bytes[7] === 0x46 &&
    bytes[8] === 0x49 &&
    bytes[9] === 0x46;

  if (hasJfif) {
    const out = bytes.slice();
    out[13] = 1; // units: dots per inch
    out[14] = (d >> 8) & 0xff;
    out[15] = d & 0xff;
    out[16] = (d >> 8) & 0xff;
    out[17] = d & 0xff;
    return out;
  }

  const app0 = new Uint8Array([
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x01,
    (d >> 8) & 0xff,
    d & 0xff,
    (d >> 8) & 0xff,
    d & 0xff,
    0x00,
    0x00,
  ]);
  const out = new Uint8Array(bytes.length + app0.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(bytes.subarray(2), 2 + app0.length);
  return out;
}

/** Reads the DPI back out of a PNG. Used by the suite, and to verify a write. */
export function readPngDpi(bytes: Uint8Array): number | null {
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (type === "pHYs") {
      const perMetre = new DataView(bytes.buffer, bytes.byteOffset + at + 8, 4).getUint32(0);
      return Math.round((perMetre * 254) / 10000);
    }
    if (type === "IEND") break;
    at += 12 + len;
  }
  return null;
}

export function readJpegDpi(bytes: Uint8Array): number | null {
  if (bytes[2] !== 0xff || bytes[3] !== 0xe0) return null;
  if (bytes[13] !== 1) return null;
  return (bytes[14] << 8) | bytes[15];
}

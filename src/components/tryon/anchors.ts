/*
 * Where a piece sits on the body, from Google MediaPipe landmarks.
 *
 * Everything here is pure maths on plain {x,y,z} points: no three.js, no DOM.
 * That is what lets scripts/test-tryon.mjs check every pose against
 * synthetic hands and faces with known answers, which matters because a
 * sign error here does not crash. It quietly puts the diamond on the palm
 * side of the finger, and nobody notices until a client does.
 *
 * ## Coordinate spaces
 *
 * MediaPipe reports image landmarks normalised to the frame: x right, y DOWN,
 * z depth where smaller is closer, on roughly the same scale as x. World
 * landmarks (hands, pose) are metric, with the same axis directions.
 *
 * The stage is the overlay the jewellery is drawn into, in CSS pixels, origin
 * at the centre, x right, y UP, z TOWARD the viewer (three.js convention).
 * The video fills the stage with `object-fit: cover`, so part of the frame is
 * cropped away; `mapPoint` applies the same crop so a landmark lands exactly
 * on the pixel of the video it came from. With the selfie mirror on, x is
 * flipped after the crop, exactly as the CSS transform on the <video> does.
 *
 * Pose orientation is always returned as an orthonormal, right-handed basis.
 * Mirroring is a reflection, so it is applied to the vectors BEFORE the basis
 * is built, never to the finished rotation. A reflected rotation matrix would
 * turn every piece inside out.
 */

import type { Pt } from "./filters.js";
export type { Pt };

export interface StageFrame {
  /** Overlay size in CSS pixels. */
  stageW: number;
  stageH: number;
  /** Intrinsic camera frame size. */
  videoW: number;
  videoH: number;
  /** Selfie view: the video is shown flipped left-to-right. */
  mirrored: boolean;
}

/** Where and how a piece sits, in stage space. */
export interface Anchor {
  position: Pt;
  /** Orthonormal right-handed basis: x = y × z. */
  xAxis: Pt;
  yAxis: Pt;
  zAxis: Pt;
  /** Size of one model unit, in stage pixels. */
  scale: number;
}

/* ---------------------------------------------------------------- vectors */

export const v = (x: number, y: number, z: number): Pt => ({ x, y, z });
export const add = (a: Pt, b: Pt): Pt => v(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Pt, b: Pt): Pt => v(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a: Pt, s: number): Pt => v(a.x * s, a.y * s, a.z * s);
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Pt, b: Pt): Pt =>
  v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a: Pt): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: Pt, b: Pt): number => len(sub(a, b));
export const lerp = (a: Pt, b: Pt, t: number): Pt => add(a, mul(sub(b, a), t));
export const mid = (a: Pt, b: Pt): Pt => lerp(a, b, 0.5);
export function norm(a: Pt, fallback: Pt = v(0, 1, 0)): Pt {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : fallback;
}

/**
 * A right-handed orthonormal basis whose y is exactly `primary` and whose z
 * is as close to `towards` as that allows (Gram-Schmidt).
 */
export function basisYZ(primary: Pt, towards: Pt): { x: Pt; y: Pt; z: Pt } {
  const y = norm(primary);
  let z = sub(towards, mul(y, dot(towards, y)));
  // Degenerate when the two are parallel; any perpendicular will do.
  if (len(z) < 1e-6) z = Math.abs(y.z) < 0.9 ? cross(v(1, 0, 0), y) : cross(v(0, 1, 0), y);
  z = norm(z);
  return { x: cross(y, z), y, z };
}

/* ---------------------------------------------------------------- mapping */

/** How the cover-fitted video sits inside the stage. */
export function coverFit(f: StageFrame): {
  scale: number;
  ox: number;
  oy: number;
  dw: number;
  dh: number;
} {
  const scale = Math.max(f.stageW / f.videoW, f.stageH / f.videoH);
  const dw = f.videoW * scale;
  const dh = f.videoH * scale;
  return { scale, ox: (f.stageW - dw) / 2, oy: (f.stageH - dh) / 2, dw, dh };
}

/** A normalised image landmark, to stage space. */
export function mapPoint(f: StageFrame, p: Pt): Pt {
  const { ox, oy, dw, dh } = coverFit(f);
  let px = ox + p.x * dw;
  const py = oy + p.y * dh;
  if (f.mirrored) px = f.stageW - px;
  // z is scaled like x by MediaPipe, so it takes the displayed width.
  return v(px - f.stageW / 2, f.stageH / 2 - py, -p.z * dw);
}

/** A direction in MediaPipe camera axes (world landmarks), to stage axes. */
export function mapDir(f: StageFrame, d: Pt): Pt {
  return v(f.mirrored ? -d.x : d.x, -d.y, -d.z);
}

export const mapPoints = (f: StageFrame, pts: readonly Pt[]): Pt[] =>
  pts.map((p) => mapPoint(f, p));
export const mapDirs = (f: StageFrame, pts: readonly Pt[]): Pt[] => pts.map((p) => mapDir(f, p));

/* ------------------------------------------------------------------ hands */

/*
 * MediaPipe hand landmark indices.
 * https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
 */
export const HAND = {
  WRIST: 0,
  THUMB_MCP: 2,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  RING_MCP: 13,
  RING_PIP: 14,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
} as const;

export type Finger = "index" | "middle" | "ring" | "pinky";

export const FINGERS: Record<Finger, { mcp: number; pip: number; neighbours: number[] }> = {
  index: { mcp: HAND.INDEX_MCP, pip: HAND.INDEX_PIP, neighbours: [HAND.MIDDLE_MCP] },
  middle: {
    mcp: HAND.MIDDLE_MCP,
    pip: HAND.MIDDLE_PIP,
    neighbours: [HAND.INDEX_MCP, HAND.RING_MCP],
  },
  ring: { mcp: HAND.RING_MCP, pip: HAND.RING_PIP, neighbours: [HAND.MIDDLE_MCP, HAND.PINKY_MCP] },
  pinky: { mcp: HAND.PINKY_MCP, pip: HAND.PINKY_PIP, neighbours: [HAND.RING_MCP] },
};

/*
 * Fit constants, from hand anthropometry rather than eyeballing.
 *
 * Adjacent knuckle (MCP joint) centres are ~19 mm apart on an adult hand and a
 * ring finger's proximal phalanx is ~17–18 mm wide where a ring sits, so a
 * ring's INNER radius is ~0.46 of the knuckle spacing. A ring sits a little
 * under halfway from the knuckle to the middle joint.
 */
export const RING_SEAT = 0.42;
export const RING_INNER_PER_SPACING = 0.46;

/*
 * Wrist pieces are sized from the index-to-pinky knuckle distance ("palm
 * width", ~62 mm on an adult). Model units for bracelets and bangles ARE palm
 * widths, so the builders and the occluder agree by construction.
 */
export const BRACELET_BACK = 0.12; // hand-lengths down the forearm from the wrist landmark
export const BANGLE_BACK = 0.24;
export const WRIST_HALF_WIDTH = 0.42; // palm widths
export const WRIST_HALF_DEPTH = 0.3;

/**
 * Which way the back of the hand faces, from the knuckle triangle.
 *
 * cross(indexMCP - wrist, pinkyMCP - wrist) is the PALM normal for a right
 * hand and the back-of-hand normal for a left one. Which one we have is the
 * handedness as it appears in the camera frame; mirroring for display is a
 * reflection and flips the cross product again.
 *
 * `rightInImage` is whether the hand LOOKS like a right hand in the raw,
 * unmirrored camera frame. MediaPipe labels assume a mirrored selfie input,
 * so on the raw frame we feed it, its "Left" means a right-looking hand.
 */
export function dorsalNormal(dirs: readonly Pt[], rightInImage: boolean, mirrored: boolean): Pt {
  const a = sub(dirs[HAND.INDEX_MCP], dirs[HAND.WRIST]);
  const b = sub(dirs[HAND.PINKY_MCP], dirs[HAND.WRIST]);
  const sign = (rightInImage ? -1 : 1) * (mirrored ? -1 : 1);
  return norm(mul(cross(a, b), sign), v(0, 0, 1));
}

/** Converts MediaPipe's handedness label (raw frame) to on-image chirality. */
export const rightInImageFromLabel = (label: string): boolean => label.toLowerCase() === "left";

/**
 * The ring pose: y along the finger toward the tip, z out of the back of the
 * hand (where the centre stone goes), one unit = the ring's inner radius.
 *
 * `img` are stage-mapped image landmarks, `dirs` stage-mapped world landmarks
 * (or image landmarks again if world ones are unavailable; only directions
 * are taken from them).
 */
export function ringAnchor(
  img: readonly Pt[],
  dirs: readonly Pt[],
  finger: Finger,
  rightInImage: boolean,
  mirrored: boolean,
): Anchor & { dorsalFacing: number; fingerLength: number } {
  const f = FINGERS[finger];
  const mcp = img[f.mcp];
  const pip = img[f.pip];
  const along = sub(dirs[f.pip], dirs[f.mcp]);
  const dorsal = dorsalNormal(dirs, rightInImage, mirrored);
  const b = basisYZ(along, dorsal);

  const spacing = f.neighbours.reduce((s, n) => s + dist(mcp, img[n]), 0) / f.neighbours.length;
  return {
    position: lerp(mcp, pip, RING_SEAT),
    xAxis: b.x,
    yAxis: b.y,
    zAxis: b.z,
    scale: spacing * RING_INNER_PER_SPACING,
    // +1 when the back of the hand faces the camera; the UI coaches on it.
    dorsalFacing: b.z.z,
    fingerLength: dist(mcp, pip),
  };
}

/**
 * Bracelet / bangle pose: y up the hand (wrist toward knuckles), z out of the
 * back of the wrist, one unit = palm width.
 */
export function wristAnchor(
  img: readonly Pt[],
  dirs: readonly Pt[],
  rightInImage: boolean,
  mirrored: boolean,
  back: number,
): Anchor {
  const wrist = img[HAND.WRIST];
  const along = sub(dirs[HAND.MIDDLE_MCP], dirs[HAND.WRIST]);
  const dorsal = dorsalNormal(dirs, rightInImage, mirrored);
  const b = basisYZ(along, dorsal);
  const palm = dist(img[HAND.INDEX_MCP], img[HAND.PINKY_MCP]);
  const handLen = dist(wrist, img[HAND.MIDDLE_MCP]);
  return {
    position: sub(wrist, mul(b.y, handLen * back)),
    xAxis: b.x,
    yAxis: b.y,
    zAxis: b.z,
    scale: palm,
  };
}

/* ------------------------------------------------------------------- face */

/*
 * MediaPipe Face Mesh indices (478-point topology).
 * 234 / 454 are the outermost silhouette points level with the ear's tragus;
 * 132 / 361 are the jaw-line silhouette points below them, near earlobe level.
 */
export const FACE = {
  FOREHEAD: 10,
  CHIN: 152,
  NOSE_TIP: 1,
  SIDE_A: 234,
  SIDE_B: 454,
  JAW_A: 132,
  JAW_B: 361,
} as const;

/*
 * Earlobe position relative to the silhouette, in face widths. The lobe hangs
 * a little below and behind the point where the face contour meets the ear.
 */
export const EAR_DOWN = 0.12;
export const EAR_BACK = 0.07;
export const EAR_OUT = 0.015;
/** How far toward the jaw point the lobe sits, between tragus and jaw. */
export const EAR_JAW_MIX = 0.35;

export interface HeadPose {
  /** Head basis: x across the face (side A → side B), y up, z out of the face. */
  basis: { x: Pt; y: Pt; z: Pt };
  centre: Pt;
  /** Face width in stage pixels; earring model units. */
  width: number;
  ears: {
    side: "A" | "B";
    lobe: Pt;
    /** Unit vector away from the head, at this ear. */
    outward: Pt;
    /** Dot of outward with the view direction: below ~-0.5 the ear faces away. */
    facing: number;
  }[];
}

export function headPose(img: readonly Pt[]): HeadPose {
  const a = img[FACE.SIDE_A];
  const b = img[FACE.SIDE_B];
  const centre = mid(a, b);
  const across = sub(b, a);
  const width = len(across);
  const up0 = sub(img[FACE.FOREHEAD], img[FACE.CHIN]);
  // Face forward is perpendicular to across and up; pick the sign that points
  // at the nose, which is independent of mirroring.
  let fwd = norm(cross(norm(across), norm(up0)), v(0, 0, 1));
  if (dot(fwd, sub(img[FACE.NOSE_TIP], centre)) < 0) fwd = mul(fwd, -1);
  // y = up, z = forward, x = y × z.
  const basis = basisYZ(up0, fwd);

  const ear = (side: "A" | "B") => {
    const top = side === "A" ? a : b;
    const jaw = img[side === "A" ? FACE.JAW_A : FACE.JAW_B];
    const outward = norm(sub(top, centre));
    const lobe = add(
      add(lerp(top, jaw, EAR_JAW_MIX), mul(basis.y, -EAR_DOWN * width)),
      add(mul(basis.z, -EAR_BACK * width), mul(outward, EAR_OUT * width)),
    );
    return { side, lobe, outward, facing: outward.z };
  };

  return { basis, centre, width, ears: [ear("A"), ear("B")] };
}

/** Earring anchor: y up (head up), z forward, x lateral; one unit = face width. */
export function earAnchor(head: HeadPose, side: "A" | "B"): Anchor {
  const ear = head.ears.find((e) => e.side === side)!;
  return {
    position: ear.lobe,
    xAxis: head.basis.x,
    yAxis: head.basis.y,
    zAxis: head.basis.z,
    scale: head.width,
  };
}

/* ------------------------------------------------------------------- pose */

/*
 * MediaPipe Pose landmark indices (33-point BlazePose topology).
 * 11 is the subject's LEFT shoulder, 12 the right.
 */
export const POSE = { NOSE: 0, L_SHOULDER: 11, R_SHOULDER: 12 } as const;

/**
 * Necklace pose: origin on the shoulder line midway between the shoulders,
 * y up, z out of the chest; one unit = shoulder width.
 *
 * Position comes from image landmarks, orientation from world landmarks (pose
 * image z is too noisy to trust for yaw). Shoulder width is corrected for yaw
 * so turning sideways does not shrink the necklace.
 */
export function neckAnchor(
  img: readonly Pt[],
  dirs: readonly Pt[] | null,
): Anchor & { yaw: number } {
  const l = img[POSE.L_SHOULDER];
  const r = img[POSE.R_SHOULDER];
  const across3 = dirs ? norm(sub(dirs[POSE.L_SHOULDER], dirs[POSE.R_SHOULDER])) : norm(sub(l, r));
  const across2 = Math.hypot(l.x - r.x, l.y - r.y);
  const planar = Math.max(0.45, Math.hypot(across3.x, across3.y));
  const width = across2 / planar;

  // Up is perpendicular to the shoulders, as close to screen-up as possible.
  let up = sub(v(0, 1, 0), mul(across3, across3.y));
  up = norm(up);
  let fwd = norm(cross(across3, up), v(0, 0, 1));
  // A person trying on a necklace faces the camera.
  if (fwd.z < 0) fwd = mul(fwd, -1);
  const b = basisYZ(up, fwd);
  const centre = mid(l, r);
  return {
    position: v(centre.x, centre.y, 0),
    xAxis: b.x,
    yAxis: b.y,
    zAxis: b.z,
    scale: width,
    yaw: Math.atan2(b.z.x, b.z.z),
  };
}

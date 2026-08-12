/*
 * Camera moves, as maths.
 *
 * A turntable is one shot. A jeweller shooting a collection wants a set of
 * them — the overhead reveal that tips down onto the face, the push in onto a
 * setting, the slow rise that walks the highlight along a shank — and wants to
 * see each one before committing three minutes of encoding to it.
 *
 * Two decisions shape this file.
 *
 * ONE SOURCE. The preview and the export call the same `poseAt`. The exporter
 * used to carry its own hard-coded shots that the panel never showed, so what
 * you watched and what you downloaded were two different pieces of code with
 * no reason to agree. A move is defined once, here.
 *
 * SPHERICAL, NOT CARTESIAN. Every pose is an azimuth, an elevation and a
 * distance multiplier — never an xyz. A piece is normalised to a unit sphere on
 * load, so angles work on a ring and a necklace alike, while positions would
 * need retuning per model. It also makes "never go through the floor" a bound
 * on one number instead of a collision test.
 */

/** Where the camera is, relative to the piece. */
export interface CameraPose {
  /** Radians around Y. 0 is the front. */
  azimuth: number;
  /** Radians above the horizon. Positive is above; +PI/2 is straight overhead. */
  elevation: number;
  /** Multiplier on the distance that frames the whole piece. 1 is the full shot. */
  distance: number;
}

export interface AnimationPreset {
  id: string;
  label: string;
  hint: string;
  /**
   * True when the pose at t=1 matches t=0.
   *
   * Social platforms loop everything, and a move that ends somewhere else
   * visibly jumps on repeat. Asserted in the suite rather than trusted.
   */
  loops: boolean;
  pose(t: number): CameraPose;
}

const TAU = Math.PI * 2;

/**
 * Ease in and out, as a cosine.
 *
 * Linear camera moves look mechanical — the giveaway that a render is a render.
 * Every move that starts and stops uses this; the ones that loop must NOT,
 * because easing at both ends of a loop produces a visible stall each time it
 * repeats.
 */
function ease(t: number): number {
  return 0.5 - Math.cos(Math.PI * clamp01(t)) / 2;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/*
 * Elevation is bounded well short of the poles.
 *
 * At exactly +/-PI/2 the camera's up vector is parallel to its view direction
 * and `lookAt` has no way to decide roll — the frame snaps to an arbitrary
 * rotation, which reads as the render glitching. Every move stays inside this.
 */
export const MAX_ELEVATION = Math.PI / 2 - 0.06;
/** Below the horizon is allowed, but not far: nobody shoots up through a bench. */
export const MIN_ELEVATION = -0.35;

const elev = (e: number) => Math.min(MAX_ELEVATION, Math.max(MIN_ELEVATION, e));

/** The three-quarter view the viewer opens on, as a pose. */
const HOME: CameraPose = { azimuth: 0.22, elevation: 0.18, distance: 1 };

export const ANIMATIONS: AnimationPreset[] = [
  {
    id: "turntable",
    label: "Turntable",
    hint: "One full turn at a fixed height. The standard catalogue shot",
    loops: true,
    pose: (t) => ({ azimuth: HOME.azimuth + TAU * t, elevation: HOME.elevation, distance: 1 }),
  },
  {
    id: "top-down",
    label: "Top to front",
    hint: "Starts overhead and tips down onto the face, turning as it comes",
    loops: false,
    pose: (t) => {
      const e = ease(t);
      return {
        // A quarter turn while descending, so it arrives on the three-quarter
        // rather than dropping straight onto the front like a lift.
        azimuth: lerp(HOME.azimuth - 0.5, HOME.azimuth + 0.3, e),
        elevation: elev(lerp(MAX_ELEVATION, 0.16, e)),
        // Pulls in slightly as it lands, which is what makes it read as arrival
        // rather than as the camera merely moving.
        distance: lerp(1.05, 0.82, e),
      };
    },
  },
  {
    id: "dolly",
    label: "Push in",
    hint: "Straight in from the full piece to the setting. No turn",
    loops: false,
    pose: (t) => ({
      azimuth: HOME.azimuth,
      elevation: HOME.elevation,
      distance: lerp(1.1, 0.42, ease(t)),
    }),
  },
  {
    id: "hero",
    label: "Hero rise",
    hint: "Low and close, rising and turning away. The one that sells a band",
    loops: false,
    pose: (t) => {
      const e = ease(t);
      return {
        azimuth: lerp(HOME.azimuth - 0.35, HOME.azimuth + 0.9, e),
        elevation: elev(lerp(-0.12, 0.55, e)),
        distance: lerp(0.6, 1.0, e),
      };
    },
  },
  {
    id: "crane",
    label: "Crane",
    hint: "A full turn that rises to overhead and comes back down",
    loops: true,
    pose: (t) => ({
      azimuth: HOME.azimuth + TAU * t,
      // One full cosine over the clip, so the height it starts at is the height
      // it ends at — which is what lets a rising move still loop.
      elevation: elev(0.18 + (1 - Math.cos(TAU * t)) * 0.42),
      distance: 1,
    }),
  },
  {
    id: "pendulum",
    label: "Pendulum",
    hint: "Swings across the front and back. For a piece with no interesting back",
    loops: true,
    pose: (t) => ({
      // A full sine: out to one side, through the middle, out to the other, and
      // home. Never shows the back, which on a pendant is a clasp and a wire.
      azimuth: HOME.azimuth + Math.sin(TAU * t) * 0.85,
      elevation: HOME.elevation,
      distance: 0.95,
    }),
  },
  {
    id: "macro",
    label: "Macro orbit",
    hint: "A tight turn in close on the setting",
    loops: true,
    pose: (t) => ({
      azimuth: HOME.azimuth + TAU * t,
      elevation: 0.1,
      distance: 0.45,
    }),
  },
  {
    id: "float",
    label: "Float",
    hint: "A slow drift and bob. Reads as a still that is alive",
    loops: true,
    pose: (t) => ({
      azimuth: HOME.azimuth + Math.sin(TAU * t) * 0.22,
      // Twice the azimuth's rate, so the path is a figure of eight rather than
      // a line the camera retraces.
      elevation: elev(HOME.elevation + Math.sin(TAU * t * 2) * 0.1),
      distance: 0.92 + Math.sin(TAU * t) * 0.03,
    }),
  },
  {
    id: "reveal",
    label: "Reveal",
    hint: "Swings round from behind onto the face",
    loops: false,
    pose: (t) => {
      const e = ease(t);
      return {
        azimuth: lerp(Math.PI + 0.4, HOME.azimuth, e),
        elevation: elev(lerp(0.4, 0.16, e)),
        distance: lerp(1.15, 0.85, e),
      };
    },
  },
];

export function animationById(id: string): AnimationPreset {
  return ANIMATIONS.find((a) => a.id === id) ?? ANIMATIONS[0];
}

/**
 * The pose at a point through a move, clamped and bounded.
 *
 * The single entry point: preview and export both come through here, so a move
 * cannot behave differently in the two places.
 */
export function poseAt(preset: AnimationPreset, t: number): CameraPose {
  const p = preset.pose(clamp01(t));
  return {
    azimuth: p.azimuth,
    elevation: elev(p.elevation),
    // Never zero: a camera at the centre of the piece is inside it, and
    // `lookAt` has no direction to work with.
    distance: Math.max(0.05, p.distance),
  };
}

/**
 * A pose as a camera position, given the distance that frames the piece.
 *
 * Y-up, matching the scene. Azimuth 0 puts the camera on +Z, which is the front
 * the piece is normalised to face.
 */
export function posePosition(pose: CameraPose, fittedDistance: number): [number, number, number] {
  const r = Math.max(1e-4, fittedDistance * pose.distance);
  const cosE = Math.cos(pose.elevation);
  return [
    r * cosE * Math.sin(pose.azimuth),
    r * Math.sin(pose.elevation),
    r * cosE * Math.cos(pose.azimuth),
  ];
}

/** Whether a move actually returns to where it started, to two decimals. */
export function returnsHome(preset: AnimationPreset): boolean {
  const a = poseAt(preset, 0);
  const b = poseAt(preset, 1);
  const sameAngle = (x: number, y: number) => Math.abs(((x - y) % TAU) % TAU) < 0.01;
  return (
    sameAngle(a.azimuth, b.azimuth) &&
    Math.abs(a.elevation - b.elevation) < 0.01 &&
    Math.abs(a.distance - b.distance) < 0.01
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Object moves: the piece moves, the camera holds still.
 *
 * A camera move shows a piece off. These are the other half — the piece
 * arriving. Dropped and settling, swinging as if just let go of, tumbling in
 * and landing. That is what the "falling from a hand, hitting something" shots
 * in the market actually are, and none of them are camera work.
 *
 * Simulated in closed form, not stepped.
 *
 * A physics engine would need a fixed timestep, and a video export renders
 * frames as fast as the machine manages rather than in real time — so a stepped
 * simulation would land the piece in a different place on a fast desktop than
 * on a phone, and the same export would differ run to run. Every move here is a
 * pure function of t, so frame 300 of 600 is identical everywhere.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Where the piece is, relative to where it normally rests. */
export interface ObjectPose {
  /** Height above the resting position, in piece radii. 0 is at rest. */
  lift: number;
  /** Radians. Z reads as swing, X as tumble. */
  rotX: number;
  rotY: number;
  rotZ: number;
}

export const AT_REST: ObjectPose = { lift: 0, rotX: 0, rotY: 0, rotZ: 0 };

export interface ObjectMove {
  id: string;
  label: string;
  hint: string;
  loops: boolean;
  pose(t: number): ObjectPose;
}

/**
 * A bouncing fall, in closed form.
 *
 * Each bounce is a parabola whose height and duration shrink by `restitution`,
 * so the piece lands, rebounds lower, and settles — the arc a real object makes
 * on a bench. Solved by walking the bounce boundaries rather than integrating,
 * which keeps it a pure function of t.
 */
export function bounceHeight(t: number, height: number, restitution = 0.42): number {
  if (t <= 0) return height;

  /*
   * The spans are worked out first and the clip is scaled to fit them.
   *
   * A bounce sequence has its own natural length — first fall, then each
   * rebound shorter by sqrt(restitution) — and that length is not 1. Left
   * unscaled the piece is still bouncing when the clip ends, which is exactly
   * what "the move does not finish" looks like. Normalising means the last
   * bounce lands on t=1 whatever the restitution.
   */
  const spans: number[] = [];
  const heights: number[] = [];
  let h = height;
  let span = 1;
  for (let i = 0; i < 12; i++) {
    spans.push(span);
    heights.push(h);
    h *= restitution;
    span *= Math.sqrt(restitution);
    // Below a hundredth of the drop nobody can see it, and continuing would
    // chase an asymptote forever.
    if (h < height * 0.01) break;
  }
  const total = spans.reduce((a, b) => a + b, 0);

  let at = t * total;
  for (let i = 0; i < spans.length; i++) {
    if (at < spans[i]) {
      const local = at / spans[i];
      // The first is half a parabola — falling from the top to the ground.
      // Every bounce after it is a whole one, up and back down.
      return i === 0 ? heights[i] * (1 - local * local) : heights[i] * 4 * local * (1 - local);
    }
    at -= spans[i];
  }
  return 0;
}

/** A swing that loses energy, ending upright. */
export function dampedSwing(t: number, amplitude: number, swings = 3, damping = 4.5): number {
  /*
   * Damping is chosen so the swing is visually stopped by the end of the clip,
   * not merely smaller. `exp(-4.5)` is about 1%, which at any usable amplitude
   * is under a pixel — a piece still visibly moving when the clip cuts reads as
   * the export having been truncated.
   */
  return amplitude * Math.exp(-damping * t) * Math.cos(TAU * swings * t);
}

export const OBJECT_MOVES: ObjectMove[] = [
  {
    id: "none",
    label: "Still",
    hint: "The piece stays where it is",
    loops: true,
    pose: () => AT_REST,
  },
  {
    id: "drop",
    label: "Drop",
    hint: "Falls, bounces and settles, the way it would onto a bench",
    loops: false,
    pose: (t) => ({ ...AT_REST, lift: bounceHeight(clamp01(t), 1.6) }),
  },
  {
    id: "drop-spin",
    label: "Tumble in",
    hint: "Falls turning, and settles square",
    loops: false,
    pose: (t) => {
      const c = clamp01(t);
      return {
        lift: bounceHeight(c, 1.8),
        // Rotation eases to a stop rather than cutting off, or the piece
        // appears to be caught rather than to come to rest.
        rotX: (1 - ease(c)) * 0.9,
        rotY: (1 - ease(c)) * TAU * 0.75,
        rotZ: 0,
      };
    },
  },
  {
    id: "hand-drop",
    label: "Let go",
    hint: "Swings as if just released, and comes to rest",
    loops: false,
    pose: (t) => {
      const c = clamp01(t);
      return {
        // A short fall onto the chain, then the swing takes over.
        lift: bounceHeight(c, 0.35, 0.2),
        rotX: 0,
        rotY: 0,
        rotZ: dampedSwing(c, 0.55),
      };
    },
  },
  {
    id: "sway",
    label: "Sway",
    hint: "Hangs and moves gently. Loops, for a display",
    loops: true,
    pose: (t) => ({ ...AT_REST, rotZ: Math.sin(TAU * t) * 0.12 }),
  },
  {
    id: "spin-settle",
    label: "Spin down",
    hint: "Turns fast and slows to a stop, like a coin settling",
    loops: false,
    pose: (t) => {
      const c = clamp01(t);
      // Exponential decay in RATE, so it slows without ever reversing.
      return { ...AT_REST, rotY: TAU * 2 * (1 - Math.exp(-3 * c)) };
    },
  },
];

export function objectMoveById(id: string): ObjectMove {
  return OBJECT_MOVES.find((m) => m.id === id) ?? OBJECT_MOVES[0];
}

/** The pose at a point through an object move, bounded. */
export function objectPoseAt(move: ObjectMove, t: number): ObjectPose {
  const p = move.pose(clamp01(t));
  return {
    // Never below the rest position: a piece that sinks through its own ground
    // reads as a bug, not as a bounce.
    lift: Math.max(0, p.lift),
    rotX: p.rotX,
    rotY: p.rotY,
    rotZ: p.rotZ,
  };
}

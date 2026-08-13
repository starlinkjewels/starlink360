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

/**
 * Ease that starts hard and settles softly, like a weighted camera head.
 *
 * `ease` is symmetric, which is right for a move that travels between two
 * points. It is wrong for anything meant to feel driven — a whip round, a snap
 * to a stop — where the energy belongs at the start and the end should glide
 * in. Cubic decay is the classic shape for that.
 */
function settle(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

/** The reverse: creeps away, then accelerates. Used for a fall-away exit. */
function gather(t: number): number {
  const x = clamp01(t);
  return x * x * x;
}

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

  /* ── The showpieces ──────────────────────────────────────────────────────
   *
   * Everything above moves the camera from one sensible place to another. These
   * are shot to be watched: each one has a moment in it. They are also the ones
   * that survive being posted, because a phone feed rewards a clip that has
   * changed noticeably by the second it is scrolled past.
   */

  {
    id: "spiral",
    label: "Orbit and close",
    hint: "Circles the piece while drawing in — the whole thing, then the setting",
    loops: false,
    pose: (t) => {
      const e = ease(t);
      return {
        /*
         * A turn and a quarter rather than a clean revolution. Ending square-on
         * to where it began reads as a loop that failed to close; three hundred
         * and thirty degrees past the start reads as deliberate.
         */
        azimuth: HOME.azimuth + TAU * 1.25 * e,
        // Lifts as it comes in, so the last frames look down into the setting
        // rather than across it.
        elevation: elev(lerp(0.08, 0.42, e)),
        distance: lerp(1.15, 0.5, e),
      };
    },
  },
  {
    id: "figure-eight",
    label: "Figure eight",
    hint: "Sweeps across and back through a slow S. Both flanks, one take",
    loops: true,
    pose: (t) => ({
      /*
       * A lemniscate: the azimuth swings once and the elevation swings twice.
       * Two-to-one is what turns a circle into a crossing figure, and because
       * both are whole sine cycles the pose at t=1 is exactly the pose at t=0.
       */
      azimuth: HOME.azimuth + Math.sin(TAU * t) * 0.85,
      elevation: elev(HOME.elevation + Math.sin(TAU * 2 * t) * 0.3),
      // Breathes in on the crossings, which is where the piece faces the lens.
      distance: 0.92 - Math.cos(TAU * 2 * t) * 0.08,
    }),
  },
  {
    id: "whip",
    label: "Whip and settle",
    hint: "Snaps round fast and glides to a stop on the face. Sharp, modern",
    loops: false,
    pose: (t) => {
      const s = settle(t);
      return {
        // Three quarters of a turn, most of it spent in the first third — the
        // stones streak, then resolve. Cubic decay is what makes it land rather
        // than merely arrive.
        azimuth: lerp(HOME.azimuth - TAU * 0.75, HOME.azimuth, s),
        elevation: elev(lerp(0.05, HOME.elevation, s)),
        distance: lerp(1.05, 0.78, s),
      };
    },
  },
  {
    id: "fall-away",
    label: "Hold and fall away",
    hint: "Sits on the detail, then pulls out to the whole piece. A closing shot",
    loops: false,
    pose: (t) => {
      /*
       * Gathers rather than eases: nothing happens for the first half, which is
       * the point — the viewer reads the setting — and then it leaves. Easing
       * would start drifting immediately and lose the hold.
       */
      const g = gather(t);
      return {
        azimuth: HOME.azimuth + g * 0.6,
        elevation: elev(lerp(0.1, 0.38, g)),
        distance: lerp(0.42, 1.2, g),
      };
    },
  },
  {
    id: "catwalk",
    label: "Rise and turn",
    hint: "Comes up from below the girdle, turning onto the face. Full of drama",
    loops: false,
    pose: (t) => {
      const e = ease(t);
      return {
        azimuth: lerp(HOME.azimuth - 1.1, HOME.azimuth + 0.35, e),
        // Starts under the piece, which is the angle nobody shoots and exactly
        // why it reads as expensive.
        elevation: elev(lerp(MIN_ELEVATION, 0.5, e)),
        distance: lerp(0.72, 0.95, e),
      };
    },
  },
  {
    id: "sparkle",
    label: "Sparkle pass",
    hint: "A tight, quick arc across the stones so they fire one after another",
    loops: true,
    pose: (t) => ({
      /*
       * Short and fast, not a tour.
       *
       * A diamond flashes when the angle between the lens, the stone and the
       * light crosses a narrow band, so what makes a pave come alive is
       * traversing many of those angles quickly — not seeing every side of the
       * piece slowly. A third of a turn at a shallow height crosses far more
       * of them per second than a full revolution does.
       */
      azimuth: HOME.azimuth + Math.sin(TAU * t) * 0.55,
      elevation: elev(HOME.elevation + Math.sin(TAU * t + Math.PI / 2) * 0.12),
      distance: 0.62,
    }),
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

/**
 * Compresses a move into the first part of the clip, so the piece then RESTS.
 *
 * This is the difference between a physics demo and a film. Left alone, every
 * arrival here filled its whole length — the piece was still bouncing on the
 * last frame, so a viewer never once saw it sitting still, and a camera move
 * running alongside meant everything on screen moved for the entire clip. That
 * reads as busy and, oddly, as boring: nothing is ever resolved.
 *
 * Landing at just over half lets the piece arrive, settle, and then be looked
 * at while the camera carries the rest. A jeweller filming on a bench does the
 * same thing, for the same reason.
 */
function landing(t: number, landAt = 0.55): number {
  return clamp01(clamp01(t) / landAt);
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
    hint: "Falls a short way, settles, and is still. Restrained, not bouncy",
    loops: false,
    /*
     * Half a radius, not one and a half.
     *
     * The fall used to start high enough to leave the frame and rebound like a
     * rubber ball. A gold pendant dropped onto velvet does not do that: it
     * falls a little, takes one soft bounce and stops. Low restitution is what
     * makes it read as heavy, and weight is the whole impression a precious
     * object has to give.
     */
    pose: (t) => ({ ...AT_REST, lift: bounceHeight(landing(t), 0.55, 0.18) }),
  },
  {
    id: "drop-spin",
    label: "Tumble in",
    hint: "Falls turning, and settles square",
    loops: false,
    pose: (t) => {
      const c = landing(t);
      return {
        lift: bounceHeight(c, 0.7, 0.18),
        // Rotation eases to a stop rather than cutting off, or the piece
        // appears to be caught rather than to come to rest. A third of a turn,
        // not three quarters — enough to read as tumbling, little enough to
        // arrive square without appearing to spin on landing.
        rotX: (1 - ease(c)) * 0.45,
        rotY: (1 - ease(c)) * TAU * 0.33,
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
      const c = landing(t, 0.7);
      return {
        // A short fall onto the chain, then the swing takes over. Given more of
        // the clip than a drop, because a swing dying away IS the shot.
        lift: bounceHeight(c, 0.18, 0.15),
        rotX: 0,
        rotY: 0,
        rotZ: dampedSwing(c, 0.4),
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
      const c = landing(t, 0.75);
      // Exponential decay in RATE, so it slows without ever reversing, and it
      // is stopped well before the clip is, so the piece can be looked at.
      return { ...AT_REST, rotY: TAU * 1.5 * (1 - Math.exp(-4 * c)) };
    },
  },

  /* ── The ones a jewellery film actually opens on ─────────────────────────
   *
   * Everything above is the piece arriving. These are the piece being
   * PRESENTED: slower, deliberate, and shot to hold an eye rather than to get
   * the object into frame. Each is still a pure function of t, so a phone and a
   * desktop render frame 300 identically.
   */

  {
    id: "present",
    label: "Present",
    hint: "Rises gently and turns a quarter, as if offered up. The opener",
    loops: false,
    pose: (t) => {
      const e = ease(landing(t, 0.8));
      return {
        /*
         * Lifted, and set back down. A full half-sine, so it returns to the
         * bench exactly.
         *
         * This peaked at 0.85 of the arc before, which left the piece hanging
         * in mid-air on the final frame — floating with nothing beneath it,
         * which reads as the render having stalled rather than as a piece being
         * presented.
         */
        lift: Math.sin(e * Math.PI) * 0.28,
        rotX: 0,
        rotY: e * TAU * 0.25,
        rotZ: 0,
      };
    },
  },
  {
    id: "turn-face",
    label: "Turn to face",
    hint: "Starts edge-on and turns its face to the camera, settling square",
    loops: false,
    pose: (t) => {
      const c = landing(t, 0.7);
      /*
       * Overshoots by a few degrees and eases back — a damped arrival rather
       * than a linear one. Stopping dead on the target is the single clearest
       * tell that a move was computed rather than performed.
       */
      const swing = 1 - Math.exp(-4 * c) * Math.cos(c * 7);
      return { ...AT_REST, rotY: -Math.PI * 0.5 * (1 - swing) };
    },
  },
  {
    id: "breathe",
    label: "Breathe",
    hint: "Hangs and drifts, barely. A loop that never distracts",
    loops: true,
    pose: (t) => ({
      /*
       * Deliberately tiny. This is the move for a page that leaves the viewer
       * running behind other content — enough life that the piece does not look
       * like a photograph, little enough that nobody watches it instead of
       * reading. Lift runs at twice the swing so the two never quite repeat
       * together, which is what stops it looking mechanical.
       */
      lift: 0.04 + Math.sin(TAU * 2 * t) * 0.03,
      rotX: 0,
      rotY: Math.sin(TAU * t) * 0.06,
      rotZ: Math.sin(TAU * t + Math.PI / 3) * 0.045,
    }),
  },
  {
    id: "flip",
    label: "Show the back",
    hint: "Turns right over to the reverse and back again. For an engraved piece",
    loops: true,
    pose: (t) => {
      /*
       * A full turn out and back, with a hold at each end.
       *
       * The pauses are the point: a continuous rotation never lets anyone READ
       * the back, which is the only reason to turn a piece over. Eased on both
       * halves and symmetric about the midpoint, so it closes exactly.
       */
      const c = clamp01(t);
      const half = c < 0.5 ? ease(c * 2) : ease((1 - c) * 2);
      return { ...AT_REST, lift: half * 0.12, rotY: half * Math.PI };
    },
  },
  {
    id: "settle-tilt",
    label: "Tilt and rest",
    hint: "Leans back to catch the light, then eases level",
    loops: false,
    pose: (t) => {
      const c = landing(t, 0.8);
      /*
       * Tilting the face toward the key light is how a bench jeweller shows a
       * stone: the fire only appears across a narrow band of angles, and this
       * crosses it slowly rather than settling outside it.
       */
      const arc = Math.sin(ease(c) * Math.PI);
      return { lift: arc * 0.08, rotX: -arc * 0.38, rotY: 0, rotZ: arc * 0.1 };
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

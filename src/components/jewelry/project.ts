/*
 * Save Project.
 *
 * Everything the studio holds, written to one JSON file and read back. The
 * point is not backup — it is that a jeweller who spends twenty minutes
 * lighting a piece should be able to open the next piece and put it under the
 * same lights, and send that setup to a colleague.
 *
 * Three rules, all learned from formats that got them wrong:
 *
 * 1. THE MODEL IS NOT IN THE FILE. A .3dm is tens of megabytes; embedding it
 *    would turn a settings file into an attachment nobody can email, and the
 *    file already lives in the client's own system. The project records which
 *    piece it was made against and says so on load if the piece differs.
 *
 * 2. EVERY FIELD IS OPTIONAL ON READ. A project saved by an older build is
 *    missing whatever came later, and one saved by a newer build carries fields
 *    this one does not know. Both must load — filling gaps from the defaults —
 *    because a settings file that refuses to open is worse than one that opens
 *    approximately.
 *
 * 3. NOTHING IS TRUSTED. The file is user-supplied JSON that goes straight into
 *    a renderer. Every value is checked and clamped rather than spread in.
 */

/*
 * The ".js" on these is required, not a slip. The Node suites compile this
 * module with plain tsc and run it directly, and Node's ESM loader will not
 * resolve an extensionless specifier; TypeScript maps ".js" back to the ".ts"
 * source and Vite is equally happy, so one spelling satisfies all three.
 */
import { DEFAULT_BACKGROUND, type Background } from "./background.js";
import { DEFAULT_POST, type PostSettings } from "./bloom.js";
import { DEFAULT_CAMERA, type CameraSettings } from "./camera.js";
import { DEFAULT_GROUND, clampGround, type GroundSettings } from "./ground.js";
import { DEFAULT_LIGHTING, type LightingSettings } from "./lighting.js";
import { resetLights, type LightDef } from "./lights.js";
import { DEFAULT_SHADOWS, clampShadows, type ShadowSettings } from "./shadows.js";
import { DEFAULT_WATERMARK, type WatermarkSettings } from "./watermark.js";
import type { Assignment } from "./assign.js";
import type { TextureAssignment } from "./textures.js";

/**
 * Bumped only when a field changes MEANING, never when one is added.
 *
 * Additions are handled by rule 2 above, so bumping for them would reject files
 * that would have loaded perfectly.
 */
export const PROJECT_VERSION = 1;

export interface Project {
  version: number;
  /** Written for a human opening the file in a text editor. */
  app: string;
  savedAt: string;
  /** Which piece this was set up against. Not the piece itself — see rule 1. */
  piece: { name: string; ref: string };

  finish: { id: string; surface?: string };
  materials: Record<string, Assignment>;
  textures: Record<string, TextureAssignment>;
  camera: CameraSettings;
  lighting: LightingSettings;
  lights: LightDef[];
  shadows: ShadowSettings;
  ground: GroundSettings;
  background: Background;
  post: PostSettings;
  watermark: WatermarkSettings;
  /**
   * The chosen shot.
   *
   * Was `{ autoRotate, rotateSpeed }`, from when the only movement was an
   * OrbitControls spin. That spin is gone — it opened the viewer already
   * turning with no way to stop it — and the moves it became are a camera
   * preset, an object move and a length.
   */
  animation: { move: string | null; objectMove: string; seconds: number };
}

export interface ProjectInput {
  piece: { name: string; ref: string };
  finish: { id: string; surface?: string };
  materials: Record<string, Assignment>;
  textures: Record<string, TextureAssignment>;
  camera: CameraSettings;
  lighting: LightingSettings;
  lights: LightDef[];
  shadows: ShadowSettings;
  ground: GroundSettings;
  background: Background;
  post: PostSettings;
  watermark: WatermarkSettings;
  animation: { move: string | null; objectMove: string; seconds: number };
}

/**
 * Serialises the studio.
 *
 * `savedAt` is passed in rather than read from the clock so this stays pure and
 * the suite can assert the whole output.
 */
export function saveProject(input: ProjectInput, savedAt: string): Project {
  return { version: PROJECT_VERSION, app: "RenderGod", savedAt, ...input };
}

export function projectJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}

/* ── reading ─────────────────────────────────────────────────────────────── */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const num = (v: unknown, fallback: number, lo = -1e9, hi = 1e9): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

const str = (v: unknown, fallback: string, max = 400): string =>
  typeof v === "string" ? v.slice(0, max) : fallback;

/** A hex colour, or the fallback. Anything else reaches a shader as garbage. */
const hex = (v: unknown, fallback: string): string =>
  typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

/** Fills a settings object field by field, taking only values of the right type. */
function merge<T extends object>(fallback: T, raw: unknown): T {
  if (!isObj(raw)) return fallback;
  const out = { ...fallback } as Record<string, unknown>;
  for (const key of Object.keys(fallback)) {
    const got = raw[key];
    const base = (fallback as Record<string, unknown>)[key];
    if (got === undefined) continue;
    if (typeof base === "number") out[key] = num(got, base as number);
    else if (typeof base === "boolean") out[key] = bool(got, base as boolean);
    else if (typeof base === "string") out[key] = str(got, base as string);
    else if (Array.isArray(base)) out[key] = Array.isArray(got) ? got : base;
    else if (isObj(base)) out[key] = merge(base as object, got);
    else if (base === null) out[key] = got;
  }
  return out as T;
}

export interface LoadResult {
  project: Project | null;
  /** Anything the user should be told. Never a silent partial load. */
  notices: string[];
}

const LIGHT_TYPES = ["directional", "spot", "point", "ambient"] as const;

/** One light, with every field checked — this drives a renderer. */
function readLight(raw: unknown, index: number): LightDef | null {
  if (!isObj(raw)) return null;
  const pos = Array.isArray(raw.position) ? raw.position : [];
  return {
    id: str(raw.id, `light-${index}`, 64),
    type: oneOf(raw.type, LIGHT_TYPES, "directional"),
    label: str(raw.label, "Light", 80),
    color: hex(raw.color, "#ffffff"),
    intensity: num(raw.intensity, 1, 0, 1000),
    position: [num(pos[0], 0, -1e4, 1e4), num(pos[1], 0, -1e4, 1e4), num(pos[2], 0, -1e4, 1e4)],
    visible: bool(raw.visible, true),
    angle: raw.angle === undefined ? undefined : num(raw.angle, 0.4, 0.01, Math.PI / 2),
    penumbra: raw.penumbra === undefined ? undefined : num(raw.penumbra, 0.5, 0, 1),
    distance: raw.distance === undefined ? undefined : num(raw.distance, 0, 0, 1e4),
    castShadow: raw.castShadow === undefined ? undefined : bool(raw.castShadow, false),
  };
}

/**
 * Reads a project file.
 *
 * Never throws on bad input: a corrupt or foreign file returns a null project
 * and a reason, because a thrown error in a file picker is a blank screen.
 */
export function loadProject(text: string): LoadResult {
  const notices: string[] = [];

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { project: null, notices: ["That file is not valid JSON, so it cannot be a project."] };
  }
  if (!isObj(raw)) {
    return { project: null, notices: ["That file does not contain a project."] };
  }
  if (typeof raw.version !== "number") {
    return {
      project: null,
      notices: ["That file has no project version, so it was not saved by this studio."],
    };
  }
  if (raw.version > PROJECT_VERSION) {
    // Loaded anyway. A newer file's extra fields are ignored by `merge`, which
    // is a better outcome than refusing to open it.
    notices.push(
      `This project was saved by a newer version (${raw.version}). Anything it added will be ignored.`,
    );
  }

  const piece = isObj(raw.piece) ? raw.piece : {};
  const lightsRaw = Array.isArray(raw.lights) ? raw.lights : null;
  const lights = lightsRaw
    ? lightsRaw.map(readLight).filter((l): l is LightDef => l !== null)
    : resetLights();
  if (lightsRaw && lights.length !== lightsRaw.length) {
    notices.push(
      `${lightsRaw.length - lights.length} light(s) could not be read and were dropped.`,
    );
  }
  if (lights.length === 0) {
    // A rig with no lights renders a black frame, which reads as a broken file.
    notices.push("The project had no usable lights, so the default rig was restored.");
    lights.push(...resetLights());
  }

  const project: Project = {
    version: PROJECT_VERSION,
    app: str(raw.app, "RenderGod", 40),
    savedAt: str(raw.savedAt, "", 40),
    piece: { name: str(piece.name, "", 120), ref: str(piece.ref, "", 60) },

    finish: {
      id: str(isObj(raw.finish) ? raw.finish.id : undefined, "yellow-gold", 60),
      surface:
        isObj(raw.finish) && typeof raw.finish.surface === "string"
          ? raw.finish.surface.slice(0, 60)
          : undefined,
    },
    // Keyed by part id, which is per piece — read as-is, and simply matching
    // nothing if the project is opened against a different model.
    materials: isObj(raw.materials) ? (raw.materials as Record<string, Assignment>) : {},
    textures: isObj(raw.textures) ? (raw.textures as Record<string, TextureAssignment>) : {},

    camera: merge(DEFAULT_CAMERA, raw.camera),
    lighting: merge(DEFAULT_LIGHTING, raw.lighting),
    lights,
    // Clamped, not merged alone: these two have cross-field rules (far beyond
    // near, max depth beyond min) that a per-field merge cannot enforce.
    shadows: clampShadows(merge(DEFAULT_SHADOWS, raw.shadows)),
    ground: clampGround(merge(DEFAULT_GROUND, raw.ground)),
    background: merge(DEFAULT_BACKGROUND, raw.background),
    post: merge(DEFAULT_POST, raw.post),
    watermark: merge(DEFAULT_WATERMARK, raw.watermark),
    /*
     * `merge` copies field by field from the fallback, so a project saved with
     * the old `{ autoRotate, rotateSpeed }` shape simply contributes nothing
     * here and opens with no move — which is the right outcome: the spin those
     * fields described no longer exists.
     */
    animation: merge(
      { move: null as string | null, objectMove: "none", seconds: 6 },
      raw.animation,
    ),
  };

  return { project, notices };
}

/**
 * Whether a project was set up against the piece currently loaded.
 *
 * Material and texture assignments are keyed by part id, which is derived from
 * the file's own layer names — so on a different piece they match nothing and
 * the lighting arrives without them. Saying so beats leaving someone to wonder
 * why half of it applied.
 */
export function pieceMismatch(project: Project, currentRef: string): string | null {
  const saved = project.piece.ref.trim();
  if (!saved || !currentRef.trim() || saved === currentRef.trim()) return null;
  return `This project was saved for "${saved}". Lighting, background and camera will apply, but materials assigned to named parts will not match this piece.`;
}

/** A filename a client can file without renaming. */
export function projectFileName(ref: string): string {
  const slug = ref
    .replace(/^ref\.?\s*/i, "")
    .trim()
    .replace(/[^\w-]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "project"}.rendergod.json`;
}

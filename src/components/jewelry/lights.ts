/*
 * The light rig, as data.
 *
 * Four lights used to be written straight into the viewport's JSX, which meant
 * the rig was whatever a developer had typed: nothing could be added, moved,
 * recoloured or switched off. A photographer's first instinct on any set is to
 * kill the fill and see what the key is doing on its own, and that was not
 * expressible.
 *
 * So the rig is a list. The defaults below are the four lights that were in the
 * JSX, transcribed exactly — positions, colours and intensities — because those
 * are the values that were on screen when the current look was signed off. The
 * suite asserts them, so a tidy-up cannot quietly change every render.
 */

export type LightType = "directional" | "spot" | "point" | "ambient";

export interface LightDef {
  id: string;
  type: LightType;
  /** What the manager lists it as. Editable — "Key", "Fill from the left". */
  label: string;
  color: string;
  intensity: number;
  /** Ignored for ambient, which has no position. */
  position: [number, number, number];
  /** Hidden lights stay in the list so they can be brought back. */
  visible: boolean;
  /** Spot only: cone half-angle in radians, and its soft edge. */
  angle?: number;
  penumbra?: number;
  /** Spot and point only: falloff distance. 0 means no falloff. */
  distance?: number;
  /** Only one light needs to cast for a jewellery shot; more is cost. */
  castShadow?: boolean;
}

/** Which fields a type actually uses, so the editor shows only those. */
export function fieldsFor(type: LightType): {
  position: boolean;
  angle: boolean;
  distance: boolean;
  shadow: boolean;
} {
  return {
    position: type !== "ambient",
    angle: type === "spot",
    distance: type === "spot" || type === "point",
    shadow: type === "spot" || type === "directional",
  };
}

/**
 * The rig as it was, before any of this existed.
 *
 * Transcribed from the viewport JSX. Do not "tidy" these numbers.
 */
export const DEFAULT_LIGHTS: LightDef[] = [
  {
    id: "key",
    type: "spot",
    label: "Key — jeweller's lamp",
    color: "#fff6ee",
    intensity: 5.5,
    position: [2.8, 6, 3.5],
    visible: true,
    angle: 0.38,
    penumbra: 0.55,
    castShadow: true,
  },
  {
    id: "fill",
    type: "directional",
    label: "Fill — cool, from the left",
    color: "#b8ccff",
    intensity: 1.4,
    position: [-4, 2, -1],
    visible: true,
  },
  {
    id: "rim",
    type: "directional",
    label: "Rim — warm, from behind",
    color: "#ffd8a0",
    intensity: 1.1,
    position: [0.5, 1.5, -4],
    visible: true,
  },
  {
    id: "ambient",
    type: "ambient",
    label: "Ambient — lifts the shadows",
    color: "#ffffff",
    intensity: 0.12,
    position: [0, 0, 0],
    visible: true,
  },
  {
    id: "sparkle",
    type: "point",
    label: "Sparkle — ignites the facets",
    color: "#fff4e0",
    intensity: 1.6,
    position: [0, 2.5, 1.2],
    visible: true,
    distance: 10,
  },
];

/** "5 lights · 4 on", which is the manager's whole status line. */
export function describeLights(lights: LightDef[]): string {
  const on = lights.filter((l) => l.visible).length;
  const noun = lights.length === 1 ? "light" : "lights";
  return `${lights.length} ${noun} · ${on} on`;
}

/*
 * Ids are derived from the list, not from Math.random or a timestamp.
 *
 * A saved project has to reload with the same ids it was saved with, or every
 * per-light setting would land on a different light. Deterministic ids also
 * keep the test suite meaningful.
 */
export function nextId(lights: LightDef[], base: string): string {
  if (!lights.some((l) => l.id === base)) return base;
  let n = 2;
  while (lights.some((l) => l.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

const NEW_LIGHT: Record<LightType, Omit<LightDef, "id">> = {
  directional: {
    type: "directional",
    label: "Directional",
    color: "#ffffff",
    intensity: 1,
    position: [3, 4, 2],
    visible: true,
  },
  spot: {
    type: "spot",
    label: "Spot",
    color: "#ffffff",
    intensity: 3,
    position: [3, 5, 3],
    visible: true,
    angle: 0.4,
    penumbra: 0.5,
  },
  point: {
    type: "point",
    label: "Point",
    color: "#ffffff",
    intensity: 1.5,
    position: [0, 2, 2],
    visible: true,
    distance: 10,
  },
  ambient: {
    type: "ambient",
    label: "Ambient",
    color: "#ffffff",
    intensity: 0.1,
    position: [0, 0, 0],
    visible: true,
  },
};

export function addLight(lights: LightDef[], type: LightType): LightDef[] {
  return [...lights, { ...NEW_LIGHT[type], id: nextId(lights, type) }];
}

/**
 * Copies a light, offset slightly.
 *
 * Offset because a duplicate at the identical position is invisible — it looks
 * like the button did nothing, and the user adds five more.
 */
export function duplicateLight(lights: LightDef[], id: string): LightDef[] {
  const at = lights.findIndex((l) => l.id === id);
  if (at < 0) return lights;
  const src = lights[at];
  const copy: LightDef = {
    ...src,
    id: nextId(lights, src.id),
    label: `${src.label} copy`,
    position: [src.position[0] + 0.5, src.position[1], src.position[2] + 0.5],
    // Only one shadow caster. A duplicate that also cast would double the
    // shadow pass for a light the user has not even aimed yet.
    castShadow: false,
  };
  const next = [...lights];
  next.splice(at + 1, 0, copy);
  return next;
}

export function deleteLight(lights: LightDef[], id: string): LightDef[] {
  return lights.filter((l) => l.id !== id);
}

export function updateLight(lights: LightDef[], id: string, patch: Partial<LightDef>): LightDef[] {
  return lights.map((l) => (l.id === id ? { ...l, ...patch, id: l.id } : l));
}

/**
 * Exactly one shadow caster.
 *
 * Every caster is a full extra render of the scene into a depth map. On a
 * million-vertex piece without a GPU, a second one is the difference between
 * usable and not — and two casters on a jewellery shot produce a crossed double
 * shadow that reads as a rendering fault rather than as lighting.
 */
export function setCaster(lights: LightDef[], id: string): LightDef[] {
  return lights.map((l) => ({ ...l, castShadow: l.id === id && fieldsFor(l.type).shadow }));
}

/** The one light casting the shadow, if any. */
export function casterOf(lights: LightDef[]): LightDef | null {
  return lights.find((l) => l.castShadow && l.visible && fieldsFor(l.type).shadow) ?? null;
}

export function resetLights(): LightDef[] {
  return DEFAULT_LIGHTS.map((l) => ({
    ...l,
    position: [...l.position] as [number, number, number],
  }));
}

/** True when the rig still matches the defaults, so "Reset" can be disabled. */
export function isDefaultRig(lights: LightDef[]): boolean {
  return JSON.stringify(lights) === JSON.stringify(resetLights());
}

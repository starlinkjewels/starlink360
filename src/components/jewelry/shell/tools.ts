import { Hand, Move, MousePointer2, Rotate3d, Ruler, Scaling } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/*
 * Viewport tool definitions.
 *
 * Data, not components — kept out of Canvas.tsx so that file exports only
 * components and fast refresh keeps working while the toolbar is edited.
 */

/** Tools that are a mode: exactly one is active. */
export type ToolMode = "view" | "select" | "move" | "scale" | "rotate" | "measure";

export interface ToolDef {
  id: ToolMode;
  label: string;
  icon: LucideIcon;
  /** What the mode does, for the tooltip. */
  hint: string;
  /** Absent when the tool works today. */
  blocked?: string;
}

const NEEDS_TRANSFORM = "Needs transform gizmos — selection works, moving a part does not yet";

/*
 * "View" is first and is the default, which is a change from Select.
 *
 * Selection used to be always on, so every click on the piece both picked a
 * part AND flew the camera to it. Looking at a ring meant fighting it: turn it,
 * tap to see the setting, and now three prongs are lit and the view has jumped.
 * Two different intentions were sharing one gesture.
 *
 * They are separate modes now. View orbits and zooms to whatever is tapped and
 * never selects; Select picks parts and never moves the camera. Defaulting to
 * View means the first thing anyone does — look at the piece — works the way
 * looking at a thing should.
 */
export const TOOLS: ToolDef[] = [
  {
    id: "view",
    label: "View",
    icon: Hand,
    hint: "Turn the piece, and tap a detail to move in on it",
  },
  {
    id: "select",
    label: "Select",
    icon: MousePointer2,
    hint: "Pick parts and stones. The camera stays where it is",
  },
  { id: "move", label: "Move", icon: Move, hint: "Move a part", blocked: NEEDS_TRANSFORM },
  { id: "scale", label: "Scale", icon: Scaling, hint: "Resize a part", blocked: NEEDS_TRANSFORM },
  {
    id: "rotate",
    label: "Rotate",
    icon: Rotate3d,
    hint: "Turn a part",
    blocked: NEEDS_TRANSFORM,
  },
  {
    id: "measure",
    label: "Measure",
    icon: Ruler,
    hint: "Distance between two points",
    blocked: NEEDS_TRANSFORM,
  },
];

/** The mode the viewer opens in. */
export const DEFAULT_TOOL: ToolMode = "view";

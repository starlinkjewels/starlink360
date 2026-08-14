import {
  Camera,
  Clapperboard,
  Film,
  Gem,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  MoveVertical,
  Palette,
  Sparkles,
  Stamp,
  ListTree,
  Sun,
  Triangle,
  Type,
  Waves,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/*
 * The icon rail.
 *
 * One entry per panel, in the order they appear down the right edge. This is
 * the single source for the rail, the panel title and the keyboard order, so a
 * section cannot exist in one and be missing from another.
 *
 * These are today's sections wearing the new shell. Merging them into the
 * competitor's grouping — Materials absorbing stones, Environment absorbing
 * background, Export absorbing photos/video/watermark — is later-phase work and
 * is deliberately NOT done here: this phase moves the furniture without
 * rewriting what sits on it.
 */

export interface SectionDef {
  id: string;
  /** Shown as the panel heading. */
  title: string;
  /** Tooltip on the rail. */
  hint: string;
  icon: LucideIcon;
}

export const SECTIONS: SectionDef[] = [
  /*
   * First, because it answers the question every other section assumes you have
   * already answered: WHICH part. Finding one object among 675 by clicking a
   * dense render is not a workflow, and every professional 3D tool solves it
   * with an outliner rather than with a better cursor.
   */
  { id: "objects", title: "Objects", hint: "Everything in the piece, by name", icon: ListTree },
  { id: "metal", title: "Metals", hint: "Metal for the whole piece or one part", icon: Palette },
  { id: "stones", title: "Stones", hint: "Select one stone or all, and set the gem", icon: Gem },
  { id: "textures", title: "Textures", hint: "Surface finish, per part", icon: Waves },
  /*
   * Stamping sits with the material sections rather than near export, because a
   * hallmark is part of the piece — it is struck into the metal and it travels
   * into every render — not something added to a photograph of it.
   */
  { id: "stamp", title: "Stamping", hint: "Hallmarks struck into the metal", icon: Stamp },
  { id: "prongs", title: "Prongs", hint: "Raise or lower a claw", icon: MoveVertical },
  { id: "bg", title: "Environment", hint: "HDRI, gem HDRI and the backdrop", icon: ImageIcon },
  { id: "light", title: "Lighting", hint: "The light rig", icon: Sun },
  { id: "shadow", title: "Shadows", hint: "Contact pool or a real shadow camera", icon: Triangle },
  { id: "ground", title: "Ground", hint: "The surface it stands on", icon: Layers },
  { id: "bloom", title: "Post Processing", hint: "Glow on the highlights", icon: Zap },
  { id: "spin", title: "Animation", hint: "Turntable and object spin", icon: Clapperboard },
  { id: "camera", title: "Camera", hint: "Projection, lens, clipping", icon: Camera },
  { id: "photos", title: "Photos", hint: "Download stills", icon: Sparkles },
  { id: "video", title: "Video", hint: "Download a clip", icon: Film },
  { id: "mark", title: "Watermark", hint: "Studio branding", icon: Type },
  { id: "help", title: "Help", hint: "How to use the studio", icon: Lightbulb },
];

export const DEFAULT_SECTION = "metal";

export function sectionById(id: string): SectionDef {
  return SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
}

/*
 * Backdrops for the 3D view, as a product photographer would choose them.
 *
 * A diamond's dark facets only read as contrast against a light ground; on
 * black they merge into the background and the stone loses its outline. So
 * the light grounds are what make a stone look photographed, and each casts a
 * soft shadow from the piece, as a sweep on a real bench does.
 */

export interface Backdrop {
  id: string;
  name: string;
  /** Swatch colour for the picker. */
  swatch: string;
  /** Radial gradient stops, inner to outer. */
  stops: [string, string, string];
  /** Shadow under the piece, as a CSS drop-shadow (or "none"). */
  shadow: string;
  /** Whether overlay text over this ground should be dark. */
  light: boolean;
}

export const BACKDROPS: Backdrop[] = [
  {
    id: "studio",
    name: "Studio",
    swatch: "#1a1512",
    stops: ["#2a2219", "#120f15", "#06050a"],
    shadow: "none",
    light: false,
  },
  {
    id: "ivory",
    name: "Ivory",
    swatch: "#efebe3",
    stops: ["#fbf9f5", "#ece7de", "#d6d0c4"],
    shadow: "drop-shadow(0 22px 26px rgba(60, 45, 25, 0.28))",
    light: true,
  },
  {
    id: "pearl",
    name: "Pearl",
    swatch: "#eef0f4",
    stops: ["#f8f9fb", "#eef0f4", "#d9dde5"],
    shadow: "drop-shadow(0 22px 26px rgba(30, 40, 60, 0.24))",
    light: true,
  },
  {
    id: "seaglass",
    name: "Sea Glass",
    swatch: "#a9cfc5",
    stops: ["#d9ece6", "#a9cfc5", "#6f9f93"],
    shadow: "drop-shadow(0 22px 26px rgba(20, 60, 50, 0.32))",
    light: true,
  },
  {
    id: "blush",
    name: "Blush",
    swatch: "#ecd3cb",
    stops: ["#f8ebe6", "#ecd3cb", "#c9a89d"],
    shadow: "drop-shadow(0 22px 26px rgba(80, 40, 30, 0.28))",
    light: true,
  },
];

export const backdropById = (id: string | undefined): Backdrop =>
  BACKDROPS.find((b) => b.id === id) ?? BACKDROPS[0];

export function backdropCss(b: Backdrop): string {
  return `radial-gradient(ellipse 70% 65% at 50% 42%, ${b.stops[0]} 0%, ${b.stops[1]} 55%, ${b.stops[2]} 100%)`;
}

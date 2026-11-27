/*
 * Asking the viewer for a frame from outside React.
 *
 * The viewer only draws when something changes (Viewer.tsx, `RenderOnChange`).
 * React renders, loaded files and camera moves are caught on their own; code
 * that changes the scene imperatively, outside a render (a material swapped in
 * a timer, a BVH arriving from a worker), calls this so the change is drawn.
 *
 * A window event rather than a hook, so plain modules with no access to the
 * R3F store can use it too. Safe to call anywhere, including on the server,
 * where it does nothing.
 */
export const RENDER_NOW_EVENT = "netram:render-now";

export function requestRender(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RENDER_NOW_EVENT));
}

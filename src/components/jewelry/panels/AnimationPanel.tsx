/*
 * Animation.
 *
 * Two rotations that were in two different sections, which is the wrong split:
 * they look identical on screen and are completely different things. Turning
 * the CAMERA sweeps the lighting across a fixed piece — the highlight travels,
 * which is what sells a polished band. Turning the PIECE keeps the lighting
 * still and shows every side under the same light, which is what a spec shot
 * wants. Nobody can tell them apart from the result alone, so they belong side
 * by side with the difference written down.
 */
import { useMemo } from "react";
import {
  ANIMATIONS,
  OBJECT_MOVES,
  animationById,
  objectMoveById,
  objectPoseAt,
  poseAt,
  type AnimationPreset,
  type ObjectMove,
} from "../animation";
import type { CameraSettings } from "../camera";
import { NumberField } from "../ui/NumberField";
import { PanelGroup, PanelIntro } from "../ui/Panel";
import { Select } from "../Select";

/**
 * The path a move takes, drawn.
 *
 * A name and a sentence do not distinguish nine camera moves; a shape does.
 * This is the actual path from `poseAt`, projected side-on, so the thumbnail
 * cannot drift from the move — the same reason the texture swatches are drawn
 * from their own height fields.
 */
function MovePath({ preset }: { preset: AnimationPreset }) {
  const d = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 24; i++) {
      const p = poseAt(preset, i / 24);
      // Side elevation: horizontal is the swing, vertical is the height, and
      // the radius shows as distance from the centre.
      const x = 22 + Math.sin(p.azimuth) * Math.cos(p.elevation) * 15 * p.distance;
      const y = 22 - Math.sin(p.elevation) * 15 * p.distance;
      pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(" ");
  }, [preset]);

  const end = poseAt(preset, 1);

  return (
    <svg viewBox="0 0 44 44" width={44} height={44} aria-hidden="true" className="move-svg">
      {/* The piece, at the centre of every path. */}
      <circle cx="22" cy="22" r="3" className="move-subject" />
      <path d={d} className="move-line" fill="none" />
      {/* Where it finishes, so a move and its reverse are told apart. */}
      <circle
        cx={22 + Math.sin(end.azimuth) * Math.cos(end.elevation) * 15 * end.distance}
        cy={22 - Math.sin(end.elevation) * 15 * end.distance}
        r="2.2"
        className="move-end"
      />
    </svg>
  );
}

/**
 * The height an object move traces over its clip, drawn.
 *
 * A drop and a tumble are the same silhouette in words and completely
 * different curves — the bounce is the whole character of the move, so the
 * thumbnail is the curve itself, taken from the same function that drives it.
 */
function ObjectPath({ move }: { move: ObjectMove }) {
  const { height, turn, lifts } = useMemo(() => {
    const SAMPLES = 32;
    const poses = Array.from({ length: SAMPLES + 1 }, (_, i) => objectPoseAt(move, i / SAMPLES));

    /*
     * Two curves, because a move has two things it can do and drawing only one
     * of them made half the set look identical.
     *
     * Height alone was plotted before. That is the whole story for a drop and
     * NOTHING at all for a turn — so Spin down, Sway, Turn to face and Still
     * all rendered as the same flat line on the ground, which reads as four
     * broken thumbnails rather than four different moves.
     */
    const lifts = poses.map((p) => p.lift);
    // The largest rotation on any axis, so a turn and a swing are both visible.
    const rots = poses.map((p) => Math.max(Math.abs(p.rotX), Math.abs(p.rotY), Math.abs(p.rotZ)));

    /*
     * Each curve is scaled to its own peak rather than to a fixed maximum.
     * A 0.06-radian breath and a full turn are both worth seeing, and a shared
     * scale would flatten the gentle ones into the baseline — which is exactly
     * the fault being fixed. The floor stops a still move being amplified into
     * noise.
     */
    const peakLift = Math.max(...lifts, 0.001);
    const peakRot = Math.max(...rots, 0.001);
    const flatLift = peakLift < 0.02;
    const flatRot = peakRot < 0.02;

    const path = (values: number[], peak: number, span: number) =>
      values
        .map((v, i) => {
          const x = 4 + (i / SAMPLES) * 36;
          const y = 36 - (v / peak) * span;
          return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(" ");

    return {
      height: flatLift ? null : path(lifts, peakLift, 26),
      // Drawn shorter than the height curve so the two read apart at 44px even
      // when a move does both, as a tumble does.
      turn: flatRot ? null : path(rots, peakRot, 18),
      lifts,
    };
  }, [move]);

  const still = !height && !turn;

  return (
    <svg viewBox="0 0 44 44" width={44} height={44} aria-hidden="true" className="move-svg">
      {/* The bench it rests on, so a height has something to be measured from. */}
      <line x1="4" y1="36" x2="40" y2="36" className="move-ground" />
      {turn && <path d={turn} className="move-turn" fill="none" />}
      {height && <path d={height} className="move-line" fill="none" />}
      {/*
       * "Still" is the one case where a flat line is the honest picture, so it
       * gets the piece sitting on the bench rather than an empty box that looks
       * like a thumbnail which failed to render.
       */}
      {still && <circle cx="22" cy="32" r="3.5" className="move-rest" />}
      {lifts[0] > 0.02 && <circle cx="4" cy={36 - 26} r="1.6" className="move-start" />}
    </svg>
  );
}

export function AnimationPanel({
  onReset,
  camera,
  onCamera,
  animation = null,
  onAnimation,
  animationPlaying = false,
  onAnimationPlaying,
  animationSeconds = 6,
  onAnimationSeconds,
  objectMove = "none",
  onObjectMove,
}: {
  onReset: () => void;
  camera: CameraSettings;
  onCamera?: (next: CameraSettings) => void;
  /** The chosen camera move, or null for none. */
  animation?: string | null;
  onAnimation?: (id: string | null) => void;
  animationPlaying?: boolean;
  onAnimationPlaying?: (on: boolean) => void;
  animationSeconds?: number;
  onAnimationSeconds?: (v: number) => void;
  /** A move applied to the piece rather than the camera. */
  objectMove?: string;
  onObjectMove?: (id: string) => void;
}) {
  const spinning = camera.spinAxis !== "none";
  const preset = animation ? animationById(animation) : null;

  return (
    <>
      <PanelIntro>
        A camera move is a shot. Pick one to watch it play here — the video export runs the same
        move, so what you see is what downloads.
      </PanelIntro>

      <PanelGroup title="Camera move">
        <div className="mat-grid" role="radiogroup" aria-label="Camera move">
          {ANIMATIONS.map((a) => {
            const on = a.id === animation;
            return (
              <button
                key={a.id}
                role="radio"
                aria-checked={on}
                className={`move-cell ${on ? "move-cell-on" : ""}`}
                onClick={() => {
                  /*
                   * One move at a time.
                   *
                   * A camera move and a move on the piece both running turns
                   * two deliberate shots into a drift: the piece rotates while
                   * the camera rotates around it, and neither reads. Choosing
                   * one clears the other, so what plays is always the single
                   * shot that was picked.
                   */
                  onAnimation?.(on ? null : a.id);
                  if (!on) {
                    onObjectMove?.("none");
                    // Picking a move is asking to see it. Requiring a second
                    // press on a control further down the panel is a step that
                    // exists for no reason.
                    onAnimationPlaying?.(true);
                  }
                }}
                title={`${a.label} — ${a.hint}`}
              >
                <MovePath preset={a} />
                <span className="mat-name">{a.label}</span>
              </button>
            );
          })}
        </div>

        {/*
         * What the chosen move does, beside the move itself.
         *
         * This used to ride in the transport, which doubled the height of a bar
         * that should be one row and left dead space under it. Whether a move
         * loops matters when picking one, not when pressing play.
         */}
        {preset && (
          <p className="field-hint mt-2">
            {preset.hint}.{" "}
            {preset.loops
              ? "Returns where it started, so the clip loops cleanly."
              : "Ends elsewhere, so it will not loop — right for a reveal, not a feed."}
          </p>
        )}
      </PanelGroup>

      {/*
        Object spin used to sit beside a second Pause button for the camera
        turntable. Two controls labelled Pause, three paragraphs apart, doing
        different things — the turntable is simply one of the camera moves
        above, so it is gone from here and the duplication with it.
      */}
      <PanelGroup
        title="Object move"
        hint="The piece arriving, rather than the camera showing it off. Dropped, released, or turning to a stop."
      >
        <div className="mat-grid" role="radiogroup" aria-label="Object move">
          {OBJECT_MOVES.map((m) => {
            /*
             * "Still" is the absence of a move, not a move.
             *
             * Highlighting it made clearing a camera move look like it had
             * armed an object move instead — two cards lit at once, which is
             * exactly what a single-shot panel must never show. It still acts
             * as the button that clears one; it just does not claim to be one.
             */
            const on = m.id === objectMove && m.id !== "none";
            return (
              <button
                key={m.id}
                role="radio"
                aria-checked={on}
                className={`move-cell ${on ? "move-cell-on" : ""}`}
                onClick={() => {
                  // Same rule in the other direction: arming a move on the
                  // piece puts the camera down.
                  onObjectMove?.(m.id);
                  if (m.id !== "none") {
                    onAnimation?.(null);
                    onAnimationPlaying?.(true);
                  }
                }}
                title={`${m.label} — ${m.hint}`}
              >
                <ObjectPath move={m} />
                <span className="mat-name">{m.label}</span>
              </button>
            );
          })}
        </div>
        {objectMove !== "none" && (
          <p className="field-hint mt-2">{objectMoveById(objectMove).hint}.</p>
        )}
      </PanelGroup>

      <PanelGroup
        title="Constant spin"
        hint="Turns the piece continuously under fixed lights, so every side is seen in the same light. Not a shot — a display."
      >
        <label className="field">
          <span className="field-label">Axis</span>
          <Select
            value={camera.spinAxis}
            options={[
              { value: "none", label: "Not spinning", hint: "The piece stays where it is" },
              { value: "y", label: "Y — upright", hint: "The usual one" },
              { value: "x", label: "X — tumbling forward" },
              { value: "z", label: "Z — rolling sideways" },
            ]}
            onChange={(v) => onCamera?.({ ...camera, spinAxis: v as CameraSettings["spinAxis"] })}
            ariaLabel="Spin axis"
          />
        </label>

        {spinning && (
          <NumberField
            label="Spin speed"
            value={camera.spinSpeed}
            min={0.05}
            max={4}
            step={0.05}
            precision={2}
            suffix=" turns/s"
            onChange={(v) => onCamera?.({ ...camera, spinSpeed: v })}
          />
        )}

        {/*
          A camera move and a constant spin at the same time compound into a
          drift rather than a clean turn. Worth saying, because each looks
          correct on its own and only the combination is wrong.
        */}
        {preset && spinning && (
          <p className="field-hint field-warn">
            A camera move and a constant spin are both running. The two rotations compound, so the
            piece will drift rather than turn cleanly — usually one or the other was meant.
          </p>
        )}
      </PanelGroup>
    </>
  );
}

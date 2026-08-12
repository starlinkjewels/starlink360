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
import { Pause, Play, RotateCcw } from "lucide-react";
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
  const d = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 32; i++) {
      const p = objectPoseAt(move, i / 32);
      const x = 4 + (i / 32) * 36;
      // Lift runs up to about 1.8 radii; 20px of headroom shows it without
      // clipping the tallest drop.
      const y = 36 - Math.min(1, p.lift / 1.8) * 26;
      pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(" ");
  }, [move]);

  return (
    <svg viewBox="0 0 44 44" width={44} height={44} aria-hidden="true" className="move-svg">
      {/* The bench it lands on, so the curve has something to be a height above. */}
      <line x1="4" y1="36" x2="40" y2="36" className="move-ground" />
      <path d={d} className="move-line" fill="none" />
    </svg>
  );
}

export function AnimationPanel({
  autoRotate,
  onToggleRotate,
  rotateSpeed,
  onRotateSpeed,
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
  autoRotate: boolean;
  onToggleRotate: () => void;
  rotateSpeed: number;
  onRotateSpeed: (v: number) => void;
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
                onClick={() => onAnimation?.(on ? null : a.id)}
                title={`${a.label} — ${a.hint}`}
              >
                <MovePath preset={a} />
                <span className="mat-name">{a.label}</span>
              </button>
            );
          })}
        </div>

        {preset && (
          <>
            <p className="field-hint mt-2">{preset.hint}.</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <button
                className="dock-btn dock-btn-lg"
                onClick={() => onAnimationPlaying?.(!animationPlaying)}
                aria-pressed={animationPlaying}
              >
                {animationPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                {animationPlaying ? "Pause" : "Play"}
              </button>
              <button
                className="dock-btn dock-btn-lg"
                onClick={() => {
                  onAnimation?.(null);
                  onReset();
                }}
              >
                <RotateCcw className="size-3.5" />
                Stop
              </button>
            </div>
            <NumberField
              label="Length"
              value={animationSeconds}
              min={1}
              max={30}
              step={0.5}
              precision={1}
              suffix="s"
              hint={
                preset.loops
                  ? "This move returns where it started, so the clip loops without a jump."
                  : "This move ends somewhere else, so it does not loop cleanly — fine for a reveal, not for a feed."
              }
              onChange={(v) => onAnimationSeconds?.(v)}
            />
          </>
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
            const on = m.id === objectMove;
            return (
              <button
                key={m.id}
                role="radio"
                aria-checked={on}
                className={`move-cell ${on ? "move-cell-on" : ""}`}
                onClick={() => onObjectMove?.(m.id)}
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

        {autoRotate && spinning && (
          <p className="field-hint field-warn">
            Both are running. The two rotations compound, so the piece will appear to drift rather
            than turn cleanly — usually one or the other is what was meant.
          </p>
        )}
      </PanelGroup>
    </>
  );
}

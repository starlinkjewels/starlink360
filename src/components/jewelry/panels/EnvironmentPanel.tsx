/*
 * Environment.
 *
 * Three tabs, because they are three different jobs that people conflate: what
 * the METAL reflects, what the STONES refract, and what sits BEHIND the piece.
 * Only the third is a backdrop; the first two are the light in the room, and
 * changing one expecting the other is the commonest confusion in the panel.
 */
import { useMemo, useState } from "react";
import { RotateCcw, Trash2, Plus } from "lucide-react";
import {
  DEFAULT_BACKGROUND,
  GRADIENT_DIRECTIONS,
  GRADIENT_PRESETS,
  IMAGE_PRESETS,
  MAX_STOPS,
  RADIAL_POSITIONS,
  SOLID_PRESETS,
  addStop,
  backdropImage,
  backgroundCss,
  gradientStops,
  removeStop,
  updateStop,
  type Background,
  type BackgroundKind,
  type GradientDirection,
  type RadialAt,
} from "../background";
import { ENVIRONMENTS, type LightingSettings } from "../lighting";
import { NumberField } from "../ui/NumberField";
import { PanelIntro, PanelReset } from "../ui/Panel";
import { Select } from "../Select";
import { TabRow } from "../ui/Tabs";

type Tab = "hdri" | "gem" | "background";

/** A sphere lit by the environment's own sky and ground, as a swatch. */
function EnvOrb({ sky, ground, size = 40 }: { sky: string; ground: string; size?: number }) {
  return (
    <span
      className="mat-orb"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 34% 28%, ${sky} 0%, ${sky} 22%, ${ground} 96%)`,
        boxShadow: "inset -2px -3px 6px rgba(0,0,0,0.35)",
      }}
    />
  );
}

function EnvGrid({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="mat-grid" role="radiogroup" aria-label={ariaLabel}>
      {ENVIRONMENTS.map((e) => {
        const on = e.id === value;
        return (
          <button
            key={e.id}
            role="radio"
            aria-checked={on}
            aria-label={e.label}
            title={e.hint}
            className="mat-cell"
            onClick={() => onChange(e.id)}
          >
            <span className={`mat-orb-ring ${on ? "mat-orb-on" : ""}`}>
              <EnvOrb sky={e.sky} ground={e.ground} />
            </span>
            <span className="mat-name">{e.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The draggable gradient bar. */
function GradientBar({
  bg,
  onBackground,
}: {
  bg: Background;
  onBackground: (next: Background) => void;
}) {
  const stops = useMemo(() => bg.stops ?? gradientStops(bg), [bg]);
  const [active, setActive] = useState(0);
  const preview = useMemo(
    () =>
      `linear-gradient(to right, ${gradientStops(bg)
        .map((s) => `${s.color} ${(s.at * 100).toFixed(2)}%`)
        .join(", ")})`,
    [bg],
  );

  const write = (next: typeof stops) => onBackground({ ...bg, stops: next });
  const current = stops[Math.min(active, stops.length - 1)];

  return (
    <>
      {/*
        The bar always previews left-to-right, whatever direction the gradient
        actually runs — it is an editor for the RAMP, and rotating it with the
        direction would make the handles move when the direction changed.
      */}
      <div className="grad-bar" style={{ background: preview }}>
        {stops.map((s, i) => (
          <button
            key={i}
            className={`grad-stop ${i === active ? "grad-stop-on" : ""}`}
            style={{ left: `${s.at * 100}%`, background: s.color }}
            onClick={() => setActive(i)}
            aria-label={`Stop ${i + 1}`}
            aria-pressed={i === active}
          />
        ))}
      </div>

      <div className="grad-edit">
        <input
          className="stone-colour-input"
          type="color"
          value={current?.color ?? "#ffffff"}
          onChange={(e) => write(updateStop(stops, active, { color: e.target.value }))}
          aria-label="Stop colour"
        />
        <NumberField
          label="Position"
          value={Math.round((current?.at ?? 0) * 100)}
          min={0}
          max={100}
          step={1}
          suffix="%"
          onChange={(v) => write(updateStop(stops, active, { at: v / 100 }))}
        />
      </div>

      <div className="light-add">
        <button
          className="chip"
          onClick={() => {
            write(addStop(stops, 0.5, current?.color ?? "#ffffff"));
            setActive(Math.min(active + 1, MAX_STOPS - 1));
          }}
          disabled={stops.length >= MAX_STOPS}
          title={`Up to ${MAX_STOPS} stops`}
        >
          <Plus className="size-3" />
          Add stop
        </button>
        <button
          className="chip"
          onClick={() => {
            write(removeStop(stops, active));
            setActive(Math.max(0, active - 1));
          }}
          disabled={stops.length <= 2}
          title="A gradient needs at least two"
        >
          <Trash2 className="size-3" />
          Remove
        </button>
        <span className="mat-meta">
          {stops.length} / {MAX_STOPS}
        </span>
      </div>
    </>
  );
}

export function EnvironmentPanel({
  lighting,
  onLighting,
  background,
  onBackground,
  onUploadImage,
}: {
  lighting: LightingSettings;
  onLighting: (next: LightingSettings) => void;
  background: Background;
  onBackground: (next: Background) => void;
  /** Opens the file picker; the panel does not own the input element. */
  onUploadImage?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("hdri");
  const bg = background;

  return (
    <>
      <PanelIntro>
        Three different jobs people conflate: what the metal reflects, what the stones refract, and
        what sits behind the piece. Only the last is a backdrop.
      </PanelIntro>

      <TabRow
        ariaLabel="Environment"
        active={tab}
        onSelect={setTab}
        tabs={[
          { id: "hdri" as const, label: "HDRI", badge: ENVIRONMENTS.length },
          { id: "gem" as const, label: "Gem HDRI" },
          { id: "background" as const, label: "Background" },
        ]}
      />

      {tab === "hdri" && (
        <>
          <p className="field-hint mb-2">
            What the metal reflects. On a polished band the highlight IS the room, so this decides
            more of the look than any light does.
          </p>
          <EnvGrid
            value={lighting.environment}
            onChange={(id) => onLighting({ ...lighting, environment: id })}
            ariaLabel="Environment"
          />

          <p className="field-label mt-3">HDRI Settings</p>
          <NumberField
            label="Rotation"
            value={Math.round((lighting.environmentRotation * 180) / Math.PI)}
            min={0}
            max={360}
            step={1}
            suffix="°"
            hint="Turns the room. Moving the room is how you move the highlight along a shank."
            onChange={(v) => onLighting({ ...lighting, environmentRotation: (v * Math.PI) / 180 })}
          />
          <NumberField
            label="Intensity"
            value={lighting.environmentIntensity}
            min={0}
            max={5}
            step={0.05}
            precision={2}
            hint="Multiplies the environment only, leaving the lights where they are."
            onChange={(v) => onLighting({ ...lighting, environmentIntensity: v })}
          />
        </>
      )}

      {tab === "gem" && (
        <>
          <p className="field-hint mb-2">
            A diamond is a picture of whatever its rays land on, so the stones can be given their
            own room — which is how the photograph is actually taken: the piece on a set, the stone
            in a light tent.
          </p>
          <label className="tex-toggle">
            <input
              type="checkbox"
              checked={lighting.separateGemEnvironment}
              onChange={(e) =>
                onLighting({ ...lighting, separateGemEnvironment: e.target.checked })
              }
            />
            <span>Separate Gem Env</span>
          </label>
          {lighting.separateGemEnvironment ? (
            <EnvGrid
              value={lighting.gemEnvironment}
              onChange={(id) => onLighting({ ...lighting, gemEnvironment: id })}
              ariaLabel="Gem environment"
            />
          ) : (
            <>
              <p className="field-hint">
                The stones are sharing the metal&rsquo;s environment, which is where a diamond loses
                its fire — this holds a second environment map in memory, which is worth it.
              </p>
              {/*
                The two clicks above (check the box, then pick "Studio light
                tent" out of twelve) are the single biggest lever on whether a
                stone reads as a real diamond — this is that in one click,
                for someone who wants just this and not the rest of what
                "Best look" also changes (shadows, theme).
              */}
              <button
                className="chip mt-2"
                onClick={() =>
                  onLighting({ ...lighting, separateGemEnvironment: true, gemEnvironment: "tent" })
                }
              >
                Use the light tent
              </button>
            </>
          )}
        </>
      )}

      {tab === "background" && (
        <>
          <label className="field">
            <span className="field-label">Type</span>
            <Select
              value={bg.kind}
              options={[
                { value: "stage", label: "Atelier (default)", hint: "The viewer's own dark stage" },
                { value: "solid", label: "Solid", hint: "One flat colour" },
                { value: "gradient", label: "Gradient", hint: "Up to eight stops" },
                { value: "image", label: "Image", hint: "A preset or your own" },
                {
                  value: "transparent",
                  label: "Transparent",
                  hint: "Cut-out PNG; video falls back to black",
                },
              ]}
              onChange={(v) => onBackground({ ...bg, kind: v as BackgroundKind })}
              ariaLabel="Background type"
            />
          </label>

          {bg.kind === "solid" && (
            <>
              <div className="swatch-grid" role="radiogroup" aria-label="Solid colour">
                {SOLID_PRESETS.map((p) => (
                  <button
                    key={p.hex}
                    role="radio"
                    aria-checked={bg.color === p.hex}
                    aria-label={p.label}
                    className="swatch-cell"
                    onClick={() => onBackground({ ...bg, color: p.hex })}
                  >
                    <span className={`swatch ${bg.color === p.hex ? "swatch-active" : ""}`}>
                      <span className="swatch-dot" style={{ background: p.hex }} />
                    </span>
                    <span className="swatch-label">{p.label}</span>
                  </button>
                ))}
              </div>
              <label className="field mt-2">
                <span className="field-label">Any other colour</span>
                <input
                  className="stone-colour-input"
                  type="color"
                  value={bg.color}
                  onChange={(e) => onBackground({ ...bg, color: e.target.value })}
                  aria-label="Background colour"
                />
              </label>
            </>
          )}

          {bg.kind === "gradient" && (
            <>
              <div className="swatch-grid" role="radiogroup" aria-label="Gradient preset">
                {GRADIENT_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    role="radio"
                    aria-checked={bg.from === p.from && bg.to === p.to}
                    aria-label={p.label}
                    className="swatch-cell"
                    onClick={() =>
                      onBackground({
                        ...bg,
                        from: p.from,
                        to: p.to,
                        // A preset replaces the bar; keeping old stops would
                        // leave the preset's name on something else entirely.
                        stops: [
                          { color: p.from, at: 0 },
                          { color: p.to, at: 1 },
                        ],
                      })
                    }
                  >
                    <span className="swatch">
                      <span
                        className="swatch-dot"
                        style={{ background: `linear-gradient(${p.from}, ${p.to})` }}
                      />
                    </span>
                    <span className="swatch-label">{p.label}</span>
                  </button>
                ))}
              </div>

              <p className="field-label mt-3">Stops</p>
              <GradientBar bg={bg} onBackground={onBackground} />

              <label className="field mt-2">
                <span className="field-label">Shape</span>
                <Select
                  value={bg.gradientType ?? "linear"}
                  options={[
                    { value: "linear", label: "Linear", hint: "Runs along a direction" },
                    { value: "radial", label: "Radial", hint: "Spreads from a point" },
                  ]}
                  onChange={(v) => onBackground({ ...bg, gradientType: v as "linear" | "radial" })}
                  ariaLabel="Gradient shape"
                />
              </label>

              {(bg.gradientType ?? "linear") === "linear" ? (
                <label className="field">
                  <span className="field-label">Direction</span>
                  <Select
                    value={bg.direction}
                    options={GRADIENT_DIRECTIONS.map((d) => ({ value: d, label: d }))}
                    onChange={(v) => onBackground({ ...bg, direction: v as GradientDirection })}
                    ariaLabel="Gradient direction"
                  />
                </label>
              ) : (
                <label className="field">
                  <span className="field-label">Centre</span>
                  <Select
                    value={bg.radialAt ?? "center"}
                    options={RADIAL_POSITIONS.map((d) => ({ value: d, label: d }))}
                    onChange={(v) => onBackground({ ...bg, radialAt: v as RadialAt })}
                    ariaLabel="Radial centre"
                  />
                </label>
              )}
            </>
          )}

          {bg.kind === "image" && (
            <>
              <div className="mat-grid" role="radiogroup" aria-label="Backdrop">
                {IMAGE_PRESETS.map((p) => {
                  const url = backdropImage(p.id, 96);
                  return (
                    <button
                      key={p.id}
                      role="radio"
                      aria-checked={bg.image === backdropImage(p.id)}
                      aria-label={p.label}
                      title={p.hint}
                      className="mat-cell"
                      onClick={() => onBackground({ ...bg, image: backdropImage(p.id) })}
                    >
                      <span className="mat-orb-ring tex-ring">
                        {url ? (
                          <img src={url} alt="" width={44} height={44} className="tex-thumb" />
                        ) : (
                          <span className="tex-thumb" style={{ width: 44, height: 44 }} />
                        )}
                      </span>
                      <span className="mat-name">{p.label}</span>
                    </button>
                  );
                })}
              </div>

              {onUploadImage && (
                <button className="chip mt-2" onClick={onUploadImage}>
                  Use my own image
                </button>
              )}

              <label className="field mt-2">
                <span className="field-label">Placement</span>
                <Select
                  value={bg.imagePlacement ?? "back"}
                  options={[
                    { value: "back", label: "Back", hint: "A backdrop behind the piece" },
                    { value: "front", label: "Front", hint: "A prop over the piece" },
                  ]}
                  onChange={(v) => onBackground({ ...bg, imagePlacement: v as "back" | "front" })}
                  ariaLabel="Image placement"
                />
                <span className="field-hint">
                  Front draws the image over the jewellery — a gauze or a lit edge shot through.
                </span>
              </label>

              <NumberField
                label="Opacity"
                value={bg.imageOpacity}
                min={0}
                max={1}
                step={0.01}
                precision={2}
                onChange={(v) => onBackground({ ...bg, imageOpacity: v })}
              />
            </>
          )}

          {/* What the stage is actually showing, at a glance. */}
          <div
            className="bg-preview mt-3"
            style={{ background: backgroundCss(bg) ?? "var(--hover-tint)" }}
            aria-hidden="true"
          />

          <PanelReset
            onReset={() => onBackground({ ...DEFAULT_BACKGROUND })}
            disabled={JSON.stringify(bg) === JSON.stringify(DEFAULT_BACKGROUND)}
            label="Reset background"
          />
        </>
      )}
    </>
  );
}

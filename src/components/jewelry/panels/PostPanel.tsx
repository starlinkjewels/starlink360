/*
 * Post processing.
 *
 * Three effects, all off by default, each costing a full-screen pass on top of
 * the render. That cost is stated on screen rather than discovered, and so is
 * the one honest caveat: SSR does not work properly on transmissive materials,
 * which is most of what this product renders. It is here because a product
 * competing on a feature list needs it — warned about, not hidden.
 */
import { RotateCcw } from "lucide-react";
import { DEFAULT_POST, postWarning, type PostSettings } from "../bloom";
import { NumberField } from "../ui/NumberField";
import { PanelGroup, PanelIntro, PanelReset } from "../ui/Panel";

/** A power-of-two buffer size, or 0 meaning "follow the render". */
const BUFFERS = [0, 256, 512, 1024, 2048] as const;

function BufferField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select
        className="text-input"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      >
        {BUFFERS.map((b) => (
          <option key={b} value={b}>
            {b === 0 ? "Match render" : b}
          </option>
        ))}
      </select>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function PostPanel({
  post,
  onPost,
}: {
  post: PostSettings;
  onPost: (next: PostSettings) => void;
}) {
  const warning = postWarning(post);
  const bloom = (patch: Partial<PostSettings["bloom"]>) =>
    onPost({ ...post, bloom: { ...post.bloom, ...patch } });
  const dof = (patch: Partial<PostSettings["dof"]>) =>
    onPost({ ...post, dof: { ...post.dof, ...patch } });
  const ssr = (patch: Partial<PostSettings["ssr"]>) =>
    onPost({ ...post, ssr: { ...post.ssr, ...patch } });

  return (
    <>
      <PanelIntro>
        Effects applied to the finished frame. Each is a full-screen pass on top of the render, so
        each costs frame time — which is why all three start off.
      </PanelIntro>

      {warning && <p className="field-hint field-warn">{warning}</p>}

      {/* ── Bloom ── */}
      <label className="tex-toggle">
        <input
          type="checkbox"
          checked={post.bloom.enabled}
          onChange={(e) => bloom({ enabled: e.target.checked })}
        />
        <span>Bloom</span>
      </label>

      {post.bloom.enabled && (
        <div className="mat-editor">
          <NumberField
            label="Strength"
            value={post.bloom.strength}
            min={0}
            max={3}
            step={0.01}
            precision={2}
            onChange={(v) => bloom({ strength: v })}
          />
          <NumberField
            label="Radius"
            value={post.bloom.radius}
            min={0}
            max={2}
            step={0.01}
            precision={2}
            onChange={(v) => bloom({ radius: v })}
          />
          <NumberField
            label="Threshold"
            value={post.bloom.threshold}
            min={0}
            max={2}
            step={0.01}
            precision={2}
            hint="Brightness a pixel must pass to glow. Near 1 only the real sparkle blooms; toward 0 the metal fogs."
            onChange={(v) => bloom({ threshold: v })}
          />
          <div className="light-pair">
            <BufferField
              label="Resolution X"
              value={post.bloom.resolutionX}
              onChange={(v) => bloom({ resolutionX: v })}
            />
            <BufferField
              label="Resolution Y"
              value={post.bloom.resolutionY}
              onChange={(v) => bloom({ resolutionY: v })}
            />
          </div>
          <p className="field-hint">
            Bloom is a blur, and a blur does not need full resolution. Halving both axes quarters
            the work and is close to invisible — the cheapest quality dial here.
          </p>
        </div>
      )}

      {/* ── Depth of field ── */}
      <label className="tex-toggle mt-2">
        <input
          type="checkbox"
          checked={post.dof.enabled}
          onChange={(e) => dof({ enabled: e.target.checked })}
        />
        <span>Depth of Field (Bokeh)</span>
      </label>

      {post.dof.enabled && (
        <div className="mat-editor">
          <NumberField
            label="Focus"
            value={post.dof.focus}
            min={0.1}
            max={40}
            step={0.05}
            precision={2}
            hint="Distance from the camera, in the piece's own units. Around 3 sits on the subject."
            onChange={(v) => dof({ focus: v })}
          />
          <NumberField
            label="Aperture"
            value={post.dof.aperture}
            min={0}
            max={0.01}
            step={0.0001}
            precision={4}
            hint="Wider is shallower. A real macro lens has millimetres of focus, which is most of why a product shot reads as a photograph."
            onChange={(v) => dof({ aperture: v })}
          />
          <NumberField
            label="Max blur"
            value={post.dof.maxBlur}
            min={0}
            max={0.05}
            step={0.0005}
            precision={4}
            hint="A ceiling, so a badly set focus softens the piece rather than dissolving the frame."
            onChange={(v) => dof({ maxBlur: v })}
          />
        </div>
      )}

      {/* ── SSR ── */}
      <label className="tex-toggle mt-2">
        <input
          type="checkbox"
          checked={post.ssr.enabled}
          onChange={(e) => ssr({ enabled: e.target.checked })}
        />
        <span>Screen Space Reflections</span>
      </label>

      {post.ssr.enabled && (
        <div className="mat-editor">
          <NumberField
            label="Thickness"
            value={post.ssr.thickness}
            min={0}
            max={1}
            step={0.001}
            precision={3}
            hint="How solid a surface is assumed to be when a ray passes behind it. Too low and reflections break up."
            onChange={(v) => ssr({ thickness: v })}
          />
          <NumberField
            label="Max Distance"
            value={post.ssr.maxDistance}
            min={0}
            max={10}
            step={0.01}
            precision={2}
            hint="How far a ray travels before giving up. Longer is slower."
            onChange={(v) => ssr({ maxDistance: v })}
          />
          <NumberField
            label="Opacity"
            value={post.ssr.opacity}
            min={0}
            max={1}
            step={0.01}
            precision={2}
            onChange={(v) => ssr({ opacity: v })}
          />
          <div className="light-pair">
            <BufferField label="Width" value={post.ssr.width} onChange={(v) => ssr({ width: v })} />
            <BufferField
              label="Height"
              value={post.ssr.height}
              onChange={(v) => ssr({ height: v })}
            />
          </div>

          <div className="tex-channels">
            <label className="tex-channel">
              <input
                type="checkbox"
                checked={post.ssr.blur}
                onChange={(e) => ssr({ blur: e.target.checked })}
              />
              <span>Blur</span>
            </label>
            <label className="tex-channel">
              <input
                type="checkbox"
                checked={post.ssr.bouncing}
                onChange={(e) => ssr({ bouncing: e.target.checked })}
              />
              <span>Bouncing</span>
            </label>
            <label className="tex-channel">
              <input
                type="checkbox"
                checked={post.ssr.fresnel}
                onChange={(e) => ssr({ fresnel: e.target.checked })}
              />
              <span>Fresnel</span>
            </label>
            <label className="tex-channel">
              <input
                type="checkbox"
                checked={post.ssr.distanceAttenuation}
                onChange={(e) => ssr({ distanceAttenuation: e.target.checked })}
              />
              <span>Distance fade</span>
            </label>
          </div>
          <p className="field-hint">
            Bouncing lets reflections reflect each other and rebuilds the pass, so it costs the
            most. Fresnel makes grazing angles reflect more, which is how real surfaces behave.
          </p>
        </div>
      )}

      <PanelReset
        onReset={() => onPost({ ...DEFAULT_POST })}
        disabled={JSON.stringify(post) === JSON.stringify(DEFAULT_POST)}
        label="Reset post processing"
      />
    </>
  );
}

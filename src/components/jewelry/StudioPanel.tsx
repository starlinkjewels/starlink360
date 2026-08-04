import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  Moon,
  Download,
  Film,
  Gem,
  Sparkles,
  Image as ImageIcon,
  Pause,
  Play,
  RotateCcw,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { finishes, type Finish } from "@/data/finishes";
import { Select } from "./Select";
import { useTheme } from "@/hooks/useTheme";
import { STONE_PRESETS, type StoneGroup } from "./stones";
import type { SavedView, StudioApi } from "./StudioRig";
import {
  ASPECTS,
  dimensionsFor,
  downloadBlob,
  exportName,
  type AnglePreset,
  type AspectPreset,
  type StillBackground,
} from "./studio";
import { bestAvailableFormat, encodeMp4, encodeWebm, type VideoFormat } from "./videoExport";

/** Short edge in pixels. Phones cannot hold the largest frames. */
const IMAGE_QUALITY = [
  { id: "hd", label: "HD", base: 1080 },
  { id: "2k", label: "2K", base: 1440 },
  { id: "4k", label: "4K", base: 2160 },
] as const;

const VIDEO_QUALITY = [
  { id: "1080", label: "1080p", base: 1080 },
  { id: "720", label: "720p", base: 720 },
] as const;

const BACKGROUNDS: { id: StillBackground; label: string }[] = [
  { id: "transparent", label: "Transparent" },
  { id: "white", label: "White" },
  { id: "black", label: "Black" },
];

/*
 * Video backgrounds are always solid. H.264 carries no alpha channel, so a
 * transparent MP4 is not a thing that exists — the fill has to be baked in.
 */
const VIDEO_BACKGROUNDS = [
  { id: "stage", label: "Dark", css: "#0b0910" },
  { id: "black", label: "Black", css: "#000000" },
  { id: "white", label: "White", css: "#ffffff" },
  { id: "grey", label: "Soft grey", css: "#f1f1f3" },
] as const;

/** Camera moves, named for what they do rather than what they are. */
const VIDEO_SHOTS = [
  { id: "turntable", label: "Spin around the whole piece", zoom: 1, elevation: 0.22, sweep: 0 },
  { id: "closeup", label: "Close-up spin", zoom: 0.5, elevation: 0.18, sweep: 0 },
  { id: "hero", label: "Rise and fall (hero)", zoom: 0.85, elevation: 0.16, sweep: 0.28 },
  { id: "flat", label: "Level spin", zoom: 1, elevation: 0.02, sweep: 0 },
  { id: "journey", label: "Tour my saved parts", zoom: 1, elevation: 0.22, sweep: 0 },
] as const;

/** Said the same way in both sections, so the control reads as one control. */
const PART_HINT = "Frame a detail on the piece, then press the camera button to add it here.";

const TURNS = [1, 2, 3] as const;
const LENGTHS = [3, 4, 6, 8, 12, 16, 24, 30] as const;
const MOBILE_MAX_SECONDS = 12;
const MOBILE_MAX_BASE = 1080;
const FPS = 30;
const BITRATE_MBPS = 20;

/** Collapsible section, so the panel reads as a few clear steps. */
function Section({
  icon,
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="sect">
      <button className="sect-head" onClick={onToggle} aria-expanded={open}>
        <span className="sect-icon">{icon}</span>
        <span className="sect-titles">
          <span className="sect-title">{title}</span>
          {subtitle && <span className="sect-sub">{subtitle}</span>}
        </span>
        <ChevronDown className={`sect-chevron size-4 ${open ? "sect-chevron-open" : ""}`} />
      </button>
      {open && <div className="sect-body">{children}</div>}
    </section>
  );
}

/**
 * What the shot is of.
 *
 * Standard angles and the user's own saved parts sit in one list, and the same
 * list appears in Photos and in Video. Splitting them apart meant choosing a
 * detail in one place, scrolling to another to download it, and choosing it
 * again to get the video — three steps to say one thing. Here the choice is
 * made where the download happens, and it carries across both.
 *
 * Selecting moves the camera, so the stage shows the shot rather than the user
 * having to trust a label.
 */
function PartPicker({
  value,
  onChange,
  angles,
  views,
  onSave,
  onDelete,
  disabled,
  label,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  angles: AnglePreset[];
  views: SavedView[];
  onSave: () => void;
  onDelete: () => void;
  disabled: boolean;
  label: string;
  hint: string;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="part-row">
        <Select
          value={value}
          options={[
            { value: "", label: "The whole piece" },
            ...angles.map((a) => ({
              value: `angle:${a.id}`,
              label: a.label,
              hint: "Standard angle",
            })),
            ...views.map((v) => ({ value: `view:${v.id}`, label: v.label, hint: "My saved part" })),
          ]}
          onChange={onChange}
          disabled={disabled}
          ariaLabel={label}
        />
        <button
          className="chip part-btn"
          onClick={onSave}
          disabled={disabled}
          title="Save the view I'm looking at"
          aria-label="Save the view I'm looking at"
        >
          <Camera className="size-3.5" />
        </button>
        {value.startsWith("view:") && (
          <button
            className="chip part-btn"
            onClick={onDelete}
            disabled={disabled}
            title="Delete this saved part"
            aria-label="Delete this saved part"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      <span className="field-hint">{hint}</span>
    </div>
  );
}

/** Labelled dropdown — far less cluttered than a long row of chips. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export interface StudioPanelProps {
  finish: Finish;
  onSelectFinish: (f: Finish) => void;
  autoRotate: boolean;
  onToggleRotate: () => void;
  onReset: () => void;
  rotateSpeed: number;
  onRotateSpeed: (v: number) => void;
  studio: React.MutableRefObject<StudioApi | null>;
  productRef: string;
  /** Selectable stone groups in the loaded piece. */
  stones?: StoneGroup[];
  /** Colour chosen per group, keyed by group id. */
  stoneColors?: Record<string, string>;
  onStoneColor?: (id: string, hex: string | null) => void;
  /** Group last tapped on the piece, so the list follows the 3D view. */
  selectedStone?: string | null;
  onSelectStone?: (id: string | null) => void;
  /** Lets the page curtain the canvas while frames are being rendered. */
  onBusyChange?: (label: string | null) => void;
  onClose?: () => void;
}

export function StudioPanel({
  finish,
  onSelectFinish,
  autoRotate,
  onToggleRotate,
  onReset,
  rotateSpeed,
  onRotateSpeed,
  studio,
  productRef,
  stones = [],
  stoneColors = {},
  onStoneColor,
  selectedStone = null,
  onSelectStone,
  onBusyChange,
  onClose,
}: StudioPanelProps) {
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState<string>("photos");

  /*
   * Tapping a stone on the piece opens this section and scrolls it into view.
   * Without that the selection lands silently in a collapsed section and the
   * tap looks like it did nothing.
   */
  useEffect(() => {
    if (selectedStone) setOpen("stones");
  }, [selectedStone]);
  const toggle = (id: string) => setOpen((cur) => (cur === id ? "" : id));

  const [aspect, setAspect] = useState<AspectPreset>(ASPECTS[0]);
  const [imageQuality, setImageQuality] = useState<number>(1080);
  const [background, setBackground] = useState<StillBackground>("transparent");

  const [videoBase, setVideoBase] = useState<number>(1080);
  const [shot, setShot] = useState<(typeof VIDEO_SHOTS)[number]>(VIDEO_SHOTS[0]);
  const [videoBg, setVideoBg] = useState<(typeof VIDEO_BACKGROUNDS)[number]>(VIDEO_BACKGROUNDS[0]);
  const [turns, setTurns] = useState<number>(1);
  const [seconds, setSeconds] = useState(4);

  /*
   * The subject of the shot, shared by Photos and Video.
   *
   * "" is the whole piece, "angle:<id>" a standard angle, "view:<id>" something
   * the user framed themselves. One piece of state, so picking a clasp in
   * Photos means Video is already pointed at the clasp.
   */
  const [partId, setPartId] = useState<string>("");

  const [busy, setBusyState] = useState<string | null>(null);
  const setBusy = useCallback(
    (label: string | null) => {
      setBusyState(label);
      onBusyChange?.(label);
    },
    [onBusyChange],
  );
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [noteKind, setNoteKind] = useState<"ok" | "error">("ok");
  const [format, setFormat] = useState<VideoFormat | null>(null);
  const abort = useRef<AbortController | null>(null);
  const started = useRef(0);

  // A phone cannot hold the biggest frames, nor survive a 900-frame render.
  const [maxBase, setMaxBase] = useState(2160);
  const [maxSeconds, setMaxSeconds] = useState<number>(LENGTHS[LENGTHS.length - 1]);
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    setMaxBase(MOBILE_MAX_BASE);
    setImageQuality((q) => Math.min(q, MOBILE_MAX_BASE));
    setMaxSeconds(MOBILE_MAX_SECONDS);
    setSeconds((s) => Math.min(s, MOBILE_MAX_SECONDS));
  }, []);

  const videoDims = dimensionsFor(aspect, videoBase);
  const imageDims = dimensionsFor(aspect, imageQuality);
  const frames = Math.round(seconds * FPS);
  const estMb = ((BITRATE_MBPS * seconds) / 8).toFixed(0);

  useEffect(() => {
    let alive = true;
    bestAvailableFormat(videoDims.width, videoDims.height).then((f) => alive && setFormat(f));
    return () => {
      alive = false;
    };
  }, [videoDims.width, videoDims.height]);

  /*
   * Saved views.
   *
   * Different pieces hide their detail in different places — a clasp, a
   * gallery, one stone in a pave field. Fixed presets cannot know that, so the
   * user frames it by eye and saves it. Kept per product so a set survives a
   * reload.
   */
  const storageKey = `starlink.views.${productRef}`;
  const [views, setViews] = useState<SavedView[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setViews(raw ? (JSON.parse(raw) as SavedView[]) : []);
    } catch {
      setViews([]);
    }
  }, [storageKey]);

  const persist = useCallback(
    (next: SavedView[]) => {
      setViews(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* private mode — views just won't survive a reload */
      }
    },
    [storageKey],
  );

  const ok = useCallback((msg: string) => {
    setNoteKind("ok");
    setNote(msg);
  }, []);
  const fail = useCallback((e: unknown) => {
    setNoteKind("error");
    setNote(e instanceof Error ? e.message : "Export failed.");
  }, []);

  const saveCurrentView = useCallback(() => {
    const api = studio.current;
    if (!api) return ok("The piece is still loading.");
    const view = api.currentView();
    view.label = `My part ${views.length + 1}`;
    persist([...views, view]);
    // Select it straight away — saving it is how you say "shoot this".
    setPartId(`view:${view.id}`);
    ok(`Saved "${view.label}". It is now selected.`);
  }, [studio, views, persist, ok]);

  const deletePart = useCallback(() => {
    const id = partId.slice(5);
    persist(views.filter((v) => v.id !== id));
    setPartId("");
  }, [partId, views, persist]);

  /**
   * Turns the picker's id into something the rig can shoot, plus the name the
   * file gets. A preset keeps its `AnglePreset` so stills can be framed for the
   * chosen aspect ratio; everything else resolves to a view.
   */
  const resolvePart = useCallback((): {
    angle: AnglePreset | null;
    view: SavedView | null;
    /** Goes in the filename. */
    label: string;
    /** Goes in the section header. */
    display: string;
  } => {
    if (partId.startsWith("angle:")) {
      const angle = studio.current?.angles.find((a) => a.id === partId.slice(6)) ?? null;
      if (angle) return { angle, view: null, label: angle.id, display: angle.label };
    }
    if (partId.startsWith("view:")) {
      const view = views.find((v) => v.id === partId.slice(5)) ?? null;
      if (view) return { angle: null, view, label: view.label, display: view.label };
    }
    return { angle: null, view: null, label: "whole-piece", display: "Whole piece" };
  }, [partId, views, studio]);

  /** Moves the camera to the picked part so the stage previews the shot. */
  const pickPart = useCallback(
    (id: string) => {
      setPartId(id);
      const api = studio.current;
      if (!api) return;
      if (id.startsWith("angle:")) {
        const angle = api.angles.find((a) => a.id === id.slice(6));
        if (angle) api.applyView(api.angleView(angle));
      } else if (id.startsWith("view:")) {
        const view = views.find((v) => v.id === id.slice(5));
        if (view) api.applyView(view);
      }
    },
    [studio, views],
  );

  // ── Photos ────────────────────────────────────────────────────────────
  const shootPart = useCallback(async () => {
    const api = studio.current;
    if (!api) return ok("The piece is still loading.");
    const { angle, view, label } = resolvePart();
    setBusy("Rendering");
    setNote(null);
    try {
      const ext = background === "transparent" ? "png" : "jpg";
      // A preset is captured through `captureAngle` so it is re-framed for the
      // chosen shape; a 9:16 crop of a wide necklace would otherwise lose its
      // ends. A saved part keeps exactly the framing the user set.
      const blob = angle
        ? await api.captureAngle(angle, { ...imageDims, background })
        : await api.captureView(view, { ...imageDims, background });
      if (blob) downloadBlob(blob, exportName(productRef, label, imageDims.height, ext));
      ok("Saved.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [studio, resolvePart, imageDims, background, productRef, ok, fail, setBusy]);

  const shootEverything = useCallback(async () => {
    const api = studio.current;
    if (!api) return ok("The piece is still loading.");
    setBusy("Rendering every angle");
    setNote(null);
    setProgress(0);
    try {
      const ext = background === "transparent" ? "png" : "jpg";
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const total = api.angles.length + views.length;
      let done = 0;

      for (const angle of api.angles) {
        const blob = await api.captureAngle(angle, { ...imageDims, background });
        if (blob) zip.file(exportName(productRef, angle.id, imageDims.height, ext), blob);
        setProgress(Math.round((++done / total) * 100));
        await new Promise((r) => setTimeout(r, 0));
      }
      for (const view of views) {
        const blob = await api.captureView(view, { ...imageDims, background });
        if (blob) zip.file(exportName(productRef, view.label, imageDims.height, ext), blob);
        setProgress(Math.round((++done / total) * 100));
        await new Promise((r) => setTimeout(r, 0));
      }
      downloadBlob(
        await zip.generateAsync({ type: "blob" }),
        exportName(productRef, "all", imageDims.height, "zip"),
      );
      ok("Saved.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
      setProgress(0);
    }
  }, [studio, imageDims, background, productRef, views, ok, fail, setBusy]);

  // ── Video ─────────────────────────────────────────────────────────────
  const shootVideo = useCallback(async () => {
    const api = studio.current;
    if (!api) return ok("The piece is still loading.");
    const { width, height } = videoDims;
    const chosen = format ?? (await bestAvailableFormat(width, height));
    if (chosen === "png-sequence") {
      fail(new Error("This browser cannot encode video. Use the photo export instead."));
      return;
    }

    /*
     * The same picker drives the clip. A preset becomes a view so the camera
     * orbits from that angle's distance, and a saved part orbits its own
     * centre — which is what makes a close-up circle the clasp rather than
     * drifting back to the middle of the piece.
     */
    const part = resolvePart();
    const view = part.angle ? api.angleView(part.angle) : part.view;

    abort.current = new AbortController();
    setBusy("Rendering frames");
    setNote(null);
    setProgress(0);
    setEta(null);
    started.current = performance.now();

    const turntable = api.beginTurntable({
      width,
      height,
      frames,
      background: videoBg.css,
      zoom: shot.zoom,
      elevation: shot.elevation,
      elevationSweep: shot.sweep,
      turns,
      view,
      // A tour travels through every saved part; every other move orbits one.
      path: shot.id === "journey" ? views : null,
    });

    try {
      const opts = {
        width,
        height,
        frameCount: frames,
        fps: FPS,
        drawFrame: turntable.drawFrame,
        onProgress: (d: number, t: number) => {
          setProgress(Math.round((d / t) * 100));
          const elapsed = performance.now() - started.current;
          const secs = Math.ceil(((elapsed / Math.max(d, 1)) * (t - d)) / 1000);
          setEta(secs > 90 ? `${Math.ceil(secs / 60)} min left` : `${secs}s left`);
        },
        signal: abort.current.signal,
      };
      const blob = chosen === "mp4" ? await encodeMp4(opts) : await encodeWebm(opts);
      const name = shot.id === "journey" ? "tour" : part.label;
      downloadBlob(blob, exportName(productRef, name, height, chosen === "mp4" ? "mp4" : "webm"));
      ok("Saved.");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") ok("Cancelled.");
      else fail(e);
    } finally {
      turntable.finish();
      abort.current = null;
      setBusy(null);
      setProgress(0);
      setEta(null);
    }
  }, [
    studio,
    videoDims,
    frames,
    videoBg,
    shot,
    turns,
    format,
    productRef,
    views,
    resolvePart,
    ok,
    fail,
    setBusy,
  ]);

  const angles = studio.current?.angles ?? [];
  const disabled = busy !== null;
  const partLabel = resolvePart().display;

  return (
    <div className="studio studio-scroll">
      <div className="studio-head">
        <h2 className="studio-title">Studio</h2>
        <div className="theme-toggle" role="group" aria-label="Theme">
          <button
            className={`theme-btn ${theme === "dark" ? "theme-btn-active" : ""}`}
            onClick={() => setTheme("dark")}
            aria-pressed={theme === "dark"}
            title="Dark theme"
          >
            <Moon className="size-3.5" />
          </button>
          <button
            className={`theme-btn ${theme === "light" ? "theme-btn-active" : ""}`}
            onClick={() => setTheme("light")}
            aria-pressed={theme === "light"}
            title="Light theme"
          >
            <Sun className="size-3.5" />
          </button>
        </div>
        {onClose && (
          <button className="sheet-close" onClick={onClose} aria-label="Close studio">
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* ── Stones ────────────────────────────────────────────────── */}
      {stones.length > 0 && (
        <Section
          icon={<Sparkles className="size-4" />}
          title="Stones"
          subtitle={
            stones.length === 1
              ? stoneColors[stones[0].id]
                ? "Recoloured"
                : stones[0].label
              : `${stones.length} sets`
          }
          open={open === "stones"}
          onToggle={() => toggle("stones")}
        >
          <p className="field-hint mb-2">
            Tap a stone on the piece to pick it, or choose a set below. Stones sharing a colour on
            one layer are set together, which is how the file is organised.
          </p>

          <ul className="view-list">
            {stones.map((g) => {
              const current = stoneColors[g.id] ?? g.originalHex;
              const changed = stoneColors[g.id] !== undefined;
              return (
                <li
                  key={g.id}
                  className={`stone-row ${selectedStone === g.id ? "stone-row-on" : ""}`}
                >
                  <button
                    className="stone-pick"
                    onClick={() => onSelectStone?.(selectedStone === g.id ? null : g.id)}
                    aria-pressed={selectedStone === g.id}
                  >
                    <span className="swatch-dot swatch-dot-sm" style={{ background: current }} />
                    <span className="stone-name">{g.label}</span>
                  </button>
                  {changed && (
                    <button
                      className="chip"
                      onClick={() => onStoneColor?.(g.id, null)}
                      title="Back to the colour in the file"
                      aria-label={`Reset ${g.label}`}
                    >
                      <RotateCcw className="size-3" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {selectedStone && (
            <>
              <p className="field-label mt-3">
                Colour for {stones.find((g) => g.id === selectedStone)?.label ?? "this set"}
              </p>
              <div className="swatch-grid" role="radiogroup" aria-label="Stone colour">
                {STONE_PRESETS.map((preset) => {
                  const active =
                    (stoneColors[selectedStone] ??
                      stones.find((g) => g.id === selectedStone)?.originalHex) === preset.hex;
                  return (
                    <button
                      key={preset.id}
                      role="radio"
                      aria-checked={active}
                      aria-label={preset.label}
                      className="swatch-cell"
                      onClick={() => onStoneColor?.(selectedStone, preset.hex)}
                    >
                      <span className={`swatch ${active ? "swatch-active" : ""}`}>
                        <span className="swatch-dot" style={{ background: preset.hex }} />
                      </span>
                      <span className="swatch-label">{preset.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Anything the presets do not cover — a house colour, a match to
                  a client's existing piece. */}
              <label className="field mt-2">
                <span className="field-label">Any other colour</span>
                <input
                  className="stone-colour-input"
                  type="color"
                  value={
                    stoneColors[selectedStone] ??
                    stones.find((g) => g.id === selectedStone)?.originalHex ??
                    "#ffffff"
                  }
                  onChange={(e) => onStoneColor?.(selectedStone, e.target.value)}
                  aria-label="Custom stone colour"
                />
              </label>
            </>
          )}
        </Section>
      )}

      {/* ── 1. Metal ──────────────────────────────────────────────── */}
      <Section
        icon={<Gem className="size-4" />}
        title="Metal"
        subtitle={finish.name}
        open={open === "metal"}
        onToggle={() => toggle("metal")}
      >
        <div className="swatch-grid" role="radiogroup" aria-label="Metal finish">
          {finishes.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={f.id === finish.id}
              aria-label={f.name}
              className="swatch-cell"
              onClick={() => onSelectFinish(f)}
            >
              <span className={`swatch ${f.id === finish.id ? "swatch-active" : ""}`}>
                <span className="swatch-dot" style={{ background: f.color }} />
              </span>
              <span className="swatch-label">{f.name}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* ── 2. Turntable ──────────────────────────────────────────── */}
      <Section
        icon={<RotateCcw className="size-4" />}
        title="Turntable"
        subtitle={autoRotate ? `Spinning · ${rotateSpeed.toFixed(1)}x` : "Paused"}
        open={open === "spin"}
        onToggle={() => toggle("spin")}
      >
        <div className="grid grid-cols-2 gap-2">
          <button
            className="dock-btn dock-btn-lg"
            onClick={onToggleRotate}
            aria-pressed={autoRotate}
          >
            {autoRotate ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {autoRotate ? "Pause" : "Spin"}
          </button>
          <button className="dock-btn dock-btn-lg" onClick={onReset}>
            <RotateCcw className="size-3.5" />
            Reset
          </button>
        </div>
        <Field label={`Speed · ${rotateSpeed.toFixed(1)}x`}>
          <input
            className="studio-slider"
            type="range"
            min={0.2}
            max={4}
            step={0.1}
            value={rotateSpeed}
            onChange={(e) => onRotateSpeed(Number(e.target.value))}
          />
        </Field>
      </Section>

      {/* ── 3. Photos ─────────────────────────────────────────────── */}
      <Section
        icon={<ImageIcon className="size-4" />}
        title="Photos"
        subtitle={`${partLabel} · ${aspect.label}`}
        open={open === "photos"}
        onToggle={() => toggle("photos")}
      >
        <PartPicker
          label="What to shoot"
          hint={PART_HINT}
          value={partId}
          onChange={pickPart}
          angles={angles}
          views={views}
          onSave={saveCurrentView}
          onDelete={deletePart}
          disabled={disabled}
        />

        <Field label="Shape" hint={aspect.hint}>
          <Select
            value={aspect.id}
            options={ASPECTS.map((a) => ({ value: a.id, label: a.label, hint: a.hint }))}
            onChange={(v) => setAspect(ASPECTS.find((a) => a.id === v) ?? ASPECTS[0])}
            disabled={disabled}
            ariaLabel="Shape"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Quality" hint={`${imageDims.width} x ${imageDims.height}`}>
            <Select
              value={String(imageQuality)}
              options={IMAGE_QUALITY.filter((q) => q.base <= maxBase).map((q) => ({
                value: String(q.base),
                label: q.label,
              }))}
              onChange={(v) => setImageQuality(Number(v))}
              disabled={disabled}
              ariaLabel="Quality"
            />
          </Field>
          <Field label="Background">
            <Select
              value={background}
              options={BACKGROUNDS.map((b) => ({ value: b.id, label: b.label }))}
              onChange={(v) => setBackground(v as StillBackground)}
              disabled={disabled}
              ariaLabel="Background"
            />
          </Field>
        </div>

        <button className="btn-primary mt-1" onClick={shootPart} disabled={disabled}>
          <Download className="size-3.5" />
          Download this photo
        </button>

        <button
          className="dock-btn dock-btn-lg mt-2 w-full"
          onClick={shootEverything}
          disabled={disabled}
        >
          <Download className="size-3.5" />
          Every angle as a .zip
        </button>
      </Section>

      {/* ── 4. Video ──────────────────────────────────────────────── */}
      <Section
        icon={<Film className="size-4" />}
        title="Video"
        subtitle={`${partLabel} · ${seconds}s`}
        open={open === "video"}
        onToggle={() => toggle("video")}
      >
        <ol className="steps">
          <li>
            <span className="steps-n">1</span>
            On the piece, tap the part you want and pinch or scroll to frame it.
          </li>
          <li>
            <span className="steps-n">2</span>
            Press the <Camera className="steps-icon size-3" aria-label="camera" /> button below to
            save that view.
          </li>
          <li>
            <span className="steps-n">3</span>
            Choose it in <strong>What to circle</strong>, then download. The camera spins around
            that part.
          </li>
        </ol>

        <PartPicker
          label="What to circle"
          hint={
            shot.id === "journey"
              ? "A tour visits every saved part, so this is ignored."
              : PART_HINT
          }
          value={partId}
          onChange={pickPart}
          angles={angles}
          views={views}
          onSave={saveCurrentView}
          onDelete={deletePart}
          disabled={disabled || shot.id === "journey"}
        />

        <Field label="Movement">
          <Select
            value={shot.id}
            options={VIDEO_SHOTS.filter((v) => v.id !== "journey" || views.length >= 2).map(
              (v) => ({ value: v.id, label: v.label }),
            )}
            onChange={(v) => setShot(VIDEO_SHOTS.find((x) => x.id === v) ?? VIDEO_SHOTS[0])}
            disabled={disabled}
            ariaLabel="Movement"
          />
        </Field>

        <Field label="Shape" hint={aspect.hint}>
          <Select
            value={aspect.id}
            options={ASPECTS.map((a) => ({ value: a.id, label: a.label, hint: a.hint }))}
            onChange={(v) => setAspect(ASPECTS.find((a) => a.id === v) ?? ASPECTS[0])}
            disabled={disabled}
            ariaLabel="Shape"
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Quality">
            <Select
              value={String(videoBase)}
              options={VIDEO_QUALITY.map((q) => ({ value: String(q.base), label: q.label }))}
              onChange={(v) => setVideoBase(Number(v))}
              disabled={disabled}
              ariaLabel="Video quality"
            />
          </Field>
          <Field label="Length">
            <Select
              value={String(seconds)}
              options={LENGTHS.filter((l) => l <= maxSeconds).map((l) => ({
                value: String(l),
                label: `${l} seconds`,
              }))}
              onChange={(v) => setSeconds(Number(v))}
              disabled={disabled}
              ariaLabel="Length"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Background">
            <Select
              value={videoBg.id}
              options={VIDEO_BACKGROUNDS.map((b) => ({ value: b.id, label: b.label }))}
              onChange={(v) =>
                setVideoBg(VIDEO_BACKGROUNDS.find((b) => b.id === v) ?? VIDEO_BACKGROUNDS[0])
              }
              disabled={disabled}
              ariaLabel="Video background"
            />
          </Field>
          {shot.id !== "journey" && (
            <Field label="Spins">
              <Select
                value={String(turns)}
                options={TURNS.map((n) => ({
                  value: String(n),
                  label: `${n} full ${n === 1 ? "turn" : "turns"}`,
                }))}
                onChange={(v) => setTurns(Number(v))}
                disabled={disabled}
                ariaLabel="Spins"
              />
            </Field>
          )}
        </div>

        <button className="btn-primary mt-1" onClick={() => shootVideo()} disabled={disabled}>
          <Download className="size-3.5" />
          {format === "webm" ? "Download video (WebM)" : "Download video (MP4)"}
        </button>

        <p className="field-hint mt-2">
          {format === "png-sequence"
            ? "This browser cannot encode video — use the photo export."
            : `${shot.label} · ${shot.id === "journey" ? `${views.length} saved parts` : partLabel} · ${videoDims.width}x${videoDims.height} · ${frames} frames · about ${estMb} MB. Rendered frame by frame, so a slower device just takes longer. Video cannot be transparent.`}
        </p>
      </Section>

      {/* ── Progress / result ─────────────────────────────────────── */}
      {busy && (
        <div className="studio-progress" role="status">
          <div className="flex items-center justify-between">
            <span>
              {busy} {progress > 0 && `${progress}%`}
              {eta && ` · ${eta}`}
            </span>
            {abort.current && (
              <button className="studio-cancel" onClick={() => abort.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
          <div className="loader-bar-track mt-2 w-full">
            <div className="loader-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {!busy && note && (
        <p
          className={noteKind === "error" ? "studio-alert" : "studio-hint"}
          role={noteKind === "error" ? "alert" : "status"}
        >
          {note}
        </p>
      )}
    </div>
  );
}

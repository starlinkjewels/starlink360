import { useCallback, useEffect, useRef, useState } from "react";
// Aliased: `Stamp` is the hallmark type in this codebase.
import {
  Bot,
  Camera,
  ChevronDown,
  Stamp as StampIcon,
  Download,
  Film,
  Gem,
  Sparkles,
  Palette,
  Video,
  Lightbulb,
  Layers,
  ListTree,
  MoveVertical,
  Triangle,
  Type,
  Waves,
  Zap,
  Image as ImageIcon,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { finishById, finishes, type Finish } from "@/data/finishes";
import { Select } from "./Select";
import type { StoneGroup } from "./stones";
import { solidCount, type Part, type PartKind } from "./selection";
import type { Assignments, Brush } from "./assign";
import { NumberField } from "./ui/NumberField";
import { PanelGroup, PanelIntro, PanelReset } from "./ui/Panel";
import { MaterialsPanel } from "./panels/MaterialsPanel";
import { TexturesPanel, type Textures } from "./panels/TexturesPanel";
import { StampsPanel, type StampDraft } from "./panels/StampsPanel";
import { ObjectsPanel } from "./panels/ObjectsPanel";
import { HelpPanel } from "./panels/HelpPanel";
import type { Stamp } from "./stamps";
import type { PartGroup } from "./groups";
import { ProngsPanel } from "./panels/ProngsPanel";
import { AIChat } from "./AIChat";
import type { ChatAction } from "./chatProtocol";
import type { ProngHeights } from "./prongs";
import { LightsPanel } from "./panels/LightsPanel";
import { ShadowsPanel } from "./panels/ShadowsPanel";
import { EnvironmentPanel } from "./panels/EnvironmentPanel";
import { GroundPanel } from "./panels/GroundPanel";
import { PostPanel } from "./panels/PostPanel";
import { AnimationPanel } from "./panels/AnimationPanel";
import { animationById, objectMoveById } from "./animation";
import { ExportOptionsPanel, type ExportTab } from "./panels/ExportOptionsPanel";
import {
  DEFAULT_EXPORT_OPTIONS,
  resolveFileName,
  withJpegDpi,
  withPngDpi,
  type ExportOptions,
} from "./exportOptions";
import { DEFAULT_LIGHTS, casterOf, describeLights, type LightDef } from "./lights";
import { DEFAULT_SHADOWS, type ShadowSettings } from "./shadows";
import { SURFACE_FINISHES } from "./textures";
import { DEFAULT_POST, type PostSettings } from "./bloom";
import { DEFAULT_CAMERA, isPinned, type CameraSettings } from "./camera";
import { DEFAULT_LIGHTING, ENVIRONMENTS, type LightingSettings } from "./lighting";
import { DEFAULT_WATERMARK, WATERMARK_PLACEMENTS, type WatermarkSettings } from "./watermark";
import {
  DEFAULT_GROUND,
  GROUND_PRESETS,
  REFLECTION_RESOLUTIONS,
  clampResolution,
  maxReflectionResolution,
  reflectionWarning,
  type GroundSettings,
  type GroundStyle,
} from "./ground";
import {
  GRADIENT_DIRECTIONS,
  GRADIENT_PRESETS,
  SOLID_PRESETS,
  resolveBackground,
  type Background,
  type BackgroundKind,
  type GradientDirection,
} from "./background";
import type { SavedView, StudioApi } from "./StudioRig";
import {
  ASPECTS,
  DESTINATIONS,
  PHOTO_DESTINATIONS,
  dimensionsFor,
  downloadBlob,
  exportName,
  type AnglePreset,
  type AspectPreset,
} from "./studio";
import {
  bestAvailableFormat,
  bitrateFor,
  encodeMp4,
  encodeWebm,
  type VideoFormat,
} from "./videoExport";

/** Short edge in pixels. Phones cannot hold the largest frames. */
const IMAGE_QUALITY = [
  { id: "hd", label: "HD", base: 1080 },
  { id: "2k", label: "2K", base: 1440 },
  { id: "4k", label: "4K", base: 2160 },
] as const;

const VIDEO_QUALITY = [
  { id: "720", label: "720p", base: 720 },
  { id: "1080", label: "1080p Full HD", base: 1080 },
  { id: "1440", label: "1440p 2K", base: 1440 },
  { id: "2160", label: "2160p 4K", base: 2160 },
] as const;

/*
 * Frame rates. 60 is four times the work of 30 at twice the resolution, so the
 * mobile cap below covers rate as well as size — 4K60 on a phone is a killed
 * tab, not a slow export.
 */
const VIDEO_FPS = [24, 30, 60] as const;
const MOBILE_MAX_FPS = 30;

const BG_KINDS: { value: BackgroundKind; label: string; hint: string }[] = [
  { value: "stage", label: "Atelier (default)", hint: "The viewer's own dark stage" },
  { value: "solid", label: "Solid colour", hint: "One flat colour" },
  { value: "gradient", label: "Gradient", hint: "Two colours, any direction" },
  { value: "image", label: "Image", hint: "Your own backdrop photo" },
  { value: "transparent", label: "Transparent", hint: "Cut-out PNG; video falls back to black" },
];

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

/** Collapsible section, so the panel reads as a few clear steps. */
/**
 * One section of the panel.
 *
 * The rail decides which is open, so exactly one renders at a time and there is
 * no header to click — the panel already shows the title. The `icon` and
 * `subtitle` props are still accepted because every call site passes them and
 * the subtitle carries useful state ("Orthographic", "3 sets"); it is shown as
 * a caption under the panel heading rather than in a row of collapsed bars.
 */
/**
 * Re-tags an encoded image with the chosen DPI.
 *
 * Byte surgery on the header, not a re-encode: the pixels are already correct
 * and re-encoding a JPEG would lose quality to fix metadata.
 */
async function withDpi(blob: Blob, ext: string, dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const out = ext === "png" ? withPngDpi(bytes, dpi) : withJpegDpi(bytes, dpi);
  // Unchanged means it was not the format we thought; hand back the original
  // rather than re-wrapping it for nothing.
  return out === bytes ? blob : new Blob([out as BlobPart], { type: blob.type });
}

/** Shared so a default prop does not allocate a new Set on every render. */
const EMPTY_SELECTION: ReadonlySet<string> = new Set();

function Section({
  subtitle,
  open,
  children,
  fill,
}: {
  icon?: React.ReactNode;
  title?: string;
  subtitle?: string;
  open: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
  /** Stretches the section to fill the panel instead of sizing to its own
   *  content — for the assistant section, so its input can pin to the
   *  bottom. See `.sect-panel-fill` in styles.css. */
  fill?: boolean;
}) {
  if (!open) return null;
  return (
    <section className={fill ? "sect-panel-fill" : "sect-panel"}>
      {subtitle && <p className="sect-caption">{subtitle}</p>}
      {children}
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
  onReset: () => void;
  studio: React.MutableRefObject<StudioApi | null>;
  productRef: string;
  /** Section the rail has selected. */
  active?: string;
  onActive?: (id: string) => void;
  /** Applies one action the AI chat requested. See routes/index.tsx. */
  onChatAction?: (action: ChatAction) => { ok: boolean; note?: string };
  /** One line describing the piece's current state, for the AI chat. */
  chatContext?: string;
  /** Projection, lens, clipping and object spin. */
  camera?: CameraSettings;
  /** Environment, light levels and ground shadow. */
  lighting?: LightingSettings;
  onLighting?: (l: LightingSettings) => void;
  /** The surface the piece stands on. */
  ground?: GroundSettings;
  onGround?: (g: GroundSettings) => void;
  /** Studio branding, burned into every export. */
  watermark?: WatermarkSettings;
  onWatermark?: (w: WatermarkSettings) => void;
  /** Bloom, depth of field and screen-space reflections. */
  post?: PostSettings;
  onPost?: (p: PostSettings) => void;
  onCamera?: (c: CameraSettings) => void;
  /** The scene backdrop, shown live and baked into every export. */
  background: Background;
  onBackground: (bg: Background) => void;
  /** Selectable stone groups in the loaded piece. */
  stones?: StoneGroup[];
  /** Colour chosen per group, keyed by group id. */
  stoneColors?: Record<string, string>;
  onStoneColor?: (id: string, hex: string | null) => void;
  /** Group last tapped on the piece, so the list follows the 3D view. */
  selectedStone?: string | null;
  /** Every selectable part, and the current selection, for the Materials panel. */
  parts?: Part[];
  selectedParts?: ReadonlySet<string>;
  onSelectParts?: (next: Set<string>) => void;
  /** Materials chosen per part id. */
  assignments?: Assignments;
  onAssignments?: (next: Assignments) => void;
  /** The brush, and how to load it. Null means not painting. */
  armed?: Brush | null;
  onArm?: (brush: Brush | null) => void;
  /** Height factor per prong solid id. 1 is unchanged. */
  prongHeights?: ProngHeights;
  onProngHeights?: (next: ProngHeights) => void;
  /** Hallmarks struck into the metal, and the punch waiting to be struck. */
  stamps: Stamp[];
  onStamps?: (next: Stamp[]) => void;
  /** Named sets of parts the user has saved. */
  groups?: PartGroup[];
  onGroups?: (next: PartGroup[]) => void;
  stampDraft: StampDraft;
  onStampDraft?: (next: StampDraft) => void;
  stampFont: string;
  onStampFont?: (next: string) => void;
  selectedStamp: string | null;
  onSelectStamp?: (id: string | null) => void;
  /** Surface finish per part id. */
  textures?: Textures;
  onTextures?: (next: Textures) => void;
  /** The light rig, and whether to mark each light's position. */
  lights?: LightDef[];
  onLights?: (next: LightDef[]) => void;
  debugLights?: boolean;
  onDebugLights?: (on: boolean) => void;
  /** Shadow mechanism and settings. */
  shadows?: ShadowSettings;
  onShadows?: (next: ShadowSettings) => void;
  /**
   * The piece's bounding radius, which the shadow frustum is relative to.
   *
   * Defaults to 1 because that is what it always is: every load path normalises
   * the piece to a unit sphere, so plumbing the real measurement up from the
   * viewport would be threading a constant through four components.
   */
  pieceRadius?: number;
  /** Where the camera is right now, so the position fields show real numbers. */
  livePosition?: [number, number, number];
  /** The chosen camera move, previewed live and used by the video export. */
  animation?: string | null;
  onAnimation?: (id: string | null) => void;
  animationPlaying?: boolean;
  onAnimationPlaying?: (on: boolean) => void;
  animationSeconds?: number;
  onAnimationSeconds?: (v: number) => void;
  /** A move applied to the piece rather than the camera. */
  objectMove?: string;
  onObjectMove?: (id: string) => void;
  /** File names, DPI and the turntable sweep. */
  exportOptions?: ExportOptions;
  onExportOptions?: (next: ExportOptions) => void;
  onSelectStone?: (id: string | null) => void;
  /** Lets the page curtain the canvas while frames are being rendered. */
  onBusyChange?: (label: string | null) => void;
  onClose?: () => void;
}

export function StudioPanel({
  finish,
  onSelectFinish,
  onReset,
  studio,
  productRef,
  active,
  onActive,
  onChatAction,
  chatContext,
  camera = DEFAULT_CAMERA,
  onCamera,
  lighting = DEFAULT_LIGHTING,
  onLighting,
  ground = DEFAULT_GROUND,
  onGround,
  watermark = DEFAULT_WATERMARK,
  onWatermark,
  post = DEFAULT_POST,
  onPost,
  background,
  onBackground,
  stones = [],
  stoneColors = {},
  onStoneColor,
  selectedStone = null,
  onSelectStone,
  parts = [],
  // An empty set, not undefined: "nothing selected" is a real state that means
  // "apply to the whole piece", so it must never read as missing.
  selectedParts = EMPTY_SELECTION,
  onSelectParts,
  assignments = {},
  onAssignments,
  armed = null,
  onArm,
  prongHeights = {},
  onProngHeights,
  stamps,
  onStamps,
  groups = [],
  onGroups,
  stampDraft,
  onStampDraft,
  stampFont,
  onStampFont,
  selectedStamp,
  onSelectStamp,
  textures = {},
  onTextures,
  lights = DEFAULT_LIGHTS,
  onLights,
  debugLights = false,
  onDebugLights,
  shadows = DEFAULT_SHADOWS,
  onShadows,
  livePosition = [0, 0, 0],
  animation = null,
  onAnimation,
  animationPlaying = false,
  onAnimationPlaying,
  animationSeconds = 6,
  onAnimationSeconds,
  objectMove = "none",
  onObjectMove,
  exportOptions = DEFAULT_EXPORT_OPTIONS,
  onExportOptions,
  pieceRadius = 1,
  onBusyChange,
  onClose,
}: StudioPanelProps) {
  /*
   * Which section is showing. Owned by the shell so the icon rail and the panel
   * cannot disagree; the internal state is only a fallback for any caller that
   * still mounts this without a rail.
   */
  const [ownOpen, setOwnOpen] = useState<string>("metal");
  const open = active ?? ownOpen;
  const setOpen = onActive ?? setOwnOpen;

  /*
   * Tapping a stone on the piece opens this section and scrolls it into view.
   * Without that the selection lands silently in a collapsed section and the
   * tap looks like it did nothing.
   */
  useEffect(() => {
    if (selectedStone) setOpen("stones");
  }, [selectedStone, setOpen]);
  /*
   * Selecting a section is now idempotent: the rail is the navigation, so
   * clicking the section you are already in must not close the panel and leave
   * an empty frame.
   */
  const toggle = (id: string) => setOpen(id);

  const [exportTab, setExportTab] = useState<ExportTab>("image");
  const [aspect, setAspect] = useState<AspectPreset>(ASPECTS[0]);
  /*
   * 4K by default. A product shot is zoomed into, cropped and printed, and HD
   * is the resolution that makes all three disappoint — a client sees soft
   * edges and reads it as the render being poor rather than the size being
   * small. The mobile cap below still applies.
   */
  const [imageQuality, setImageQuality] = useState<number>(2160);

  const [videoBase, setVideoBase] = useState<number>(1080);
  const [shot, setShot] = useState<(typeof VIDEO_SHOTS)[number]>(VIDEO_SHOTS[0]);
  const [turns, setTurns] = useState<number>(1);
  const [seconds, setSeconds] = useState(4);
  const [fps, setFps] = useState<number>(30);
  const [maxFps, setMaxFps] = useState<number>(60);

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
  const bgFile = useRef<HTMLInputElement>(null);
  const started = useRef(0);

  // A phone cannot hold the biggest frames, nor survive a 900-frame render.
  const [maxBase, setMaxBase] = useState(2160);
  const [maxSeconds, setMaxSeconds] = useState<number>(LENGTHS[LENGTHS.length - 1]);
  const [coarsePointer, setCoarsePointer] = useState(false);
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    setCoarsePointer(true);
    setMaxBase(MOBILE_MAX_BASE);
    setImageQuality((q) => Math.min(q, MOBILE_MAX_BASE));
    setMaxSeconds(MOBILE_MAX_SECONDS);
    setSeconds((s) => Math.min(s, MOBILE_MAX_SECONDS));
    setMaxFps(MOBILE_MAX_FPS);
    setFps((f) => Math.min(f, MOBILE_MAX_FPS));
  }, []);

  const videoDims = dimensionsFor(aspect, videoBase);
  const imageDims = dimensionsFor(aspect, imageQuality);
  const frames = Math.round(seconds * fps);
  const estMb = (
    ((bitrateFor(videoDims.width, videoDims.height, fps) / 1e6) * seconds) /
    8
  ).toFixed(0);

  useEffect(() => {
    let alive = true;
    bestAvailableFormat(videoDims.width, videoDims.height, fps).then((f) => alive && setFormat(f));
    return () => {
      alive = false;
    };
  }, [videoDims.width, videoDims.height, fps]);

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
      const bg = await resolveBackground(background);
      const ext = bg.kind === "transparent" ? "png" : "jpg";
      // A preset is captured through `captureAngle` so it is re-framed for the
      // chosen shape; a 9:16 crop of a wide necklace would otherwise lose its
      // ends. A saved part keeps exactly the framing the user set.
      const blob = angle
        ? await api.captureAngle(angle, { ...imageDims, background: bg, watermark })
        : await api.captureView(view, { ...imageDims, background: bg, watermark });
      if (blob) {
        /*
         * DPI is written into the encoded bytes rather than re-encoded. Canvas
         * always says 96, so a 4000px render lands in InDesign at 42 inches
         * wide and someone retypes the size on every image. The pixels are
         * already right; only the metadata was wrong.
         */
        const tagged = await withDpi(blob, ext, exportOptions.dpi);
        downloadBlob(
          tagged,
          resolveFileName(
            exportOptions.imageName,
            exportName(productRef, label, imageDims.height, ext),
            ext,
          ),
        );
      }
      ok("Saved.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }, [
    studio,
    resolvePart,
    imageDims,
    background,
    watermark,
    productRef,
    // Read inside, so a name or DPI changed after mount must reach the closure —
    // omitting these would bake in whatever they were on first render.
    exportOptions.imageName,
    exportOptions.dpi,
    ok,
    fail,
    setBusy,
  ]);

  const shootEverything = useCallback(async () => {
    const api = studio.current;
    if (!api) return ok("The piece is still loading.");
    setBusy("Rendering every angle");
    setNote(null);
    setProgress(0);
    try {
      const bg = await resolveBackground(background);
      const ext = bg.kind === "transparent" ? "png" : "jpg";
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const total = api.angles.length + views.length;
      let done = 0;

      for (const angle of api.angles) {
        const blob = await api.captureAngle(angle, { ...imageDims, background: bg, watermark });
        if (blob) zip.file(exportName(productRef, angle.id, imageDims.height, ext), blob);
        setProgress(Math.round((++done / total) * 100));
        await new Promise((r) => setTimeout(r, 0));
      }
      for (const view of views) {
        const blob = await api.captureView(view, { ...imageDims, background: bg, watermark });
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
  }, [studio, imageDims, background, watermark, productRef, views, ok, fail, setBusy]);

  // ── Video ─────────────────────────────────────────────────────────────
  const shootVideo = useCallback(async () => {
    const api = studio.current;
    if (!api) return ok("The piece is still loading.");
    const { width, height } = videoDims;
    const chosen = format ?? (await bestAvailableFormat(width, height, fps));
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
    /*
     * With nothing specific chosen, the clip is shot from the camera on
     * screen — same angle, same height, same distance — and turns from there.
     *
     * It used to fall through to null, which put the orbit square-on to the
     * front at a fixed height: you framed a three-quarter view, pressed
     * download, and got a clip shot from somewhere else entirely. An explicit
     * preset or saved part still wins, because choosing one IS the instruction.
     */
    const view = part.angle ? api.angleView(part.angle) : (part.view ?? api.currentView());

    /*
     * Resolved once, before the run. Painting hundreds of frames cannot await
     * an image decode per frame, and H.264 carries no alpha — so a transparent
     * backdrop becomes black rather than silently producing a broken file.
     */
    const sceneBg = await resolveBackground(
      background.kind === "transparent"
        ? { ...background, kind: "solid", color: "#000000" }
        : background,
    );

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
      background: sceneBg,
      watermark,
      zoom: shot.zoom,
      elevation: shot.elevation,
      elevationSweep: shot.sweep,
      turns,
      view,
      // A tour travels through every saved part; every other move orbits one.
      path: shot.id === "journey" ? views : null,
      /*
       * The chosen move, so the download IS the shot that was previewed.
       *
       * A saved-part tour still wins: it is a path through points the user
       * placed by hand, which no preset can express.
       */
      preset: shot.id === "journey" ? null : animation ? animationById(animation) : null,
      objectMove: objectMove === "none" ? null : objectMoveById(objectMove),
    });

    try {
      const opts = {
        width,
        height,
        frameCount: frames,
        fps,
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
      const vext = chosen === "mp4" ? "mp4" : "webm";
      downloadBlob(
        blob,
        resolveFileName(exportOptions.videoName, exportName(productRef, name, height, vext), vext),
      );
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
    exportOptions.videoName,
    // Read inside, so a move chosen after mount reaches the closure — without
    // these the export would keep rendering whatever was picked on first load.
    animation,
    objectMove,
    videoDims,
    frames,
    fps,
    background,
    watermark,
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
    <div className="studio-sections">
      <div className="studio-head">
        {onClose && (
          <button className="sheet-close" onClick={onClose} aria-label="Close studio">
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {/* ── Post processing ───────────────────────────────────────
          Was just Glow. Depth of field and screen-space reflections sit
          alongside it because they are the same kind of thing: a full-screen
          pass over the finished render, costed the same way. */}
      <Section
        icon={<Zap className="size-4" />}
        title="Post Processing"
        subtitle={
          [post.bloom.enabled, post.dof.enabled, post.ssr.enabled].filter(Boolean).length === 0
            ? "Off"
            : [post.bloom.enabled && "Bloom", post.dof.enabled && "DoF", post.ssr.enabled && "SSR"]
                .filter(Boolean)
                .join(" · ")
        }
        open={open === "bloom"}
        onToggle={() => toggle("bloom")}
      >
        <PostPanel post={post} onPost={(next) => onPost?.(next)} />
      </Section>
      {/* ── Export options ────────────────────────────────────────
          Image, Video and Watermark: the settings that apply to a DOWNLOAD
          rather than to the render. They were scattered across three sections,
          so naming a file, setting its size and finding the mark were three
          different places. */}
      <Section
        icon={<Type className="size-4" />}
        title="Export Options"
        subtitle={
          watermark.enabled
            ? watermark.logo
              ? "Logo mark"
              : watermark.text || "Mark on"
            : `${exportOptions.dpi} DPI`
        }
        open={open === "mark"}
        onToggle={() => toggle("mark")}
      >
        <ExportOptionsPanel
          tab={exportTab}
          onTab={setExportTab}
          options={exportOptions}
          onOptions={(next) => onExportOptions?.(next)}
          watermark={watermark}
          onWatermark={(next) => onWatermark?.(next)}
          imagePixels={dimensionsFor(aspect, imageQuality).width}
          turns={turns}
        />
      </Section>
      {/* ── Help ──────────────────────────────────────────────────────
          The rail has carried a Help entry from the start and nothing ever
          rendered it, so the section opened empty. */}
      <Section
        icon={<Lightbulb className="size-4" />}
        title="Help"
        subtitle="Every section, and what it is for"
        open={open === "help"}
        onToggle={() => toggle("help")}
      >
        <HelpPanel />
      </Section>
      {/* ── Ground ────────────────────────────────────────────────── */}
      <Section
        icon={<Layers className="size-4" />}
        title="Ground"
        subtitle={
          !ground.enabled
            ? "None"
            : ground.style === "mirror"
              ? "Reflector"
              : ground.kind === "transparent"
                ? "Transparent"
                : "Standard"
        }
        open={open === "ground"}
        onToggle={() => toggle("ground")}
      >
        <GroundPanel
          ground={ground}
          onGround={(next) => onGround?.(next)}
          radiusXZ={pieceRadius}
          coarsePointer={coarsePointer}
        />
      </Section>
      {/* ── Lighting ──────────────────────────────────────────────
          The rig and the overall level, and nothing else. The environment
          controls that used to be duplicated here belong to Environment, and
          the key/fill/rim/ambient sliders were driving nothing at all once the
          rig became a list — four controls that moved and changed no pixel. */}
      <Section
        icon={<Lightbulb className="size-4" />}
        title="Lighting"
        subtitle={describeLights(lights)}
        open={open === "light"}
        onToggle={() => toggle("light")}
      >
        <PanelIntro>
          The lights on the metal. What the STONES see is the environment, in its own section —
          their shader reads that and nothing here.
        </PanelIntro>

        <PanelGroup title="Exposure">
          <NumberField
            label="Exposure"
            value={lighting.exposure}
            min={0.1}
            max={4}
            step={0.05}
            precision={2}
            hint="Overall brightness, applied after everything else. Reach for this before moving individual lights."
            onChange={(v) => onLighting?.({ ...lighting, exposure: v })}
          />
        </PanelGroup>

        <PanelGroup title="Lights">
          <LightsPanel
            lights={lights}
            onLights={onLights ?? (() => {})}
            debug={debugLights}
            onDebug={onDebugLights ?? (() => {})}
            canCast={shadows.enabled && shadows.mode === "directional"}
          />
        </PanelGroup>

        <PanelReset
          onReset={() => onLighting?.(DEFAULT_LIGHTING)}
          disabled={JSON.stringify(lighting) === JSON.stringify(DEFAULT_LIGHTING)}
          label="Reset exposure"
        />
      </Section>
      {/* ── Shadows ───────────────────────────────────────────────── */}
      <Section
        icon={<Triangle className="size-4" />}
        title="Shadows"
        subtitle={
          !shadows.enabled ? "Off" : shadows.mode === "contact" ? "Contact pool" : "Shadow camera"
        }
        open={open === "shadow"}
        onToggle={() => toggle("shadow")}
      >
        <ShadowsPanel
          shadows={shadows}
          onShadows={onShadows ?? (() => {})}
          radius={pieceRadius}
          hasCaster={casterOf(lights) !== null}
        />
      </Section>

      {/* ── Camera ────────────────────────────────────────────────── */}
      <Section
        icon={<Video className="size-4" />}
        title="Camera"
        subtitle={
          camera.projection === "orthographic" ? "Orthographic" : `${Math.round(camera.fov)}mm-ish`
        }
        open={open === "camera"}
        onToggle={() => toggle("camera")}
      >
        {/*
          Where the camera actually is.

          Shown live as it orbits, and typeable. "The same angle across twenty
          pieces" is a position, not a gesture — reproducing a shot by dragging
          is guesswork, and a catalogue row shot at slightly different angles
          reads as sloppy even when nobody can say why.
        */}
        <p className="field-label">Position</p>
        <div className="light-xyz">
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <NumberField
              key={axis}
              label={axis}
              value={Number(((camera.position ?? livePosition)[i] ?? 0).toFixed(2))}
              min={-500}
              max={500}
              step={0.1}
              precision={2}
              slider={false}
              onChange={(v) => {
                const base = camera.position ?? livePosition;
                const next: [number, number, number] = [base[0], base[1], base[2]];
                next[i] = v;
                onCamera?.({ ...camera, position: next });
              }}
            />
          ))}
        </div>
        <p className="field-hint">
          {isPinned(camera)
            ? "Pinned. Orbiting still moves the view, but a reset returns here."
            : "Following the automatic framing. Typing a number pins it."}
        </p>
        {isPinned(camera) && (
          <button className="chip mt-2" onClick={() => onCamera?.({ ...camera, position: null })}>
            <RotateCcw className="size-3" />
            Back to auto framing
          </button>
        )}

        <Field
          label="Projection"
          hint={
            camera.projection === "orthographic"
              ? "No perspective distortion — every piece in a catalogue row matches."
              : "Natural depth, like a real lens."
          }
        >
          <Select
            value={camera.projection}
            options={[
              { value: "perspective", label: "Perspective", hint: "Natural depth" },
              { value: "orthographic", label: "Orthographic", hint: "Flat, for catalogues" },
            ]}
            onChange={(v) =>
              onCamera?.({ ...camera, projection: v as CameraSettings["projection"] })
            }
            disabled={disabled}
            ariaLabel="Projection"
          />
        </Field>

        {camera.projection === "perspective" && (
          <Field
            label={`Lens — ${Math.round(camera.fov)}° field of view`}
            hint="Lower is a longer lens: less distortion, further back."
          >
            <input
              className="studio-slider"
              type="range"
              min={10}
              max={80}
              step={1}
              value={camera.fov}
              onChange={(e) => onCamera?.({ ...camera, fov: Number(e.target.value) })}
            />
          </Field>
        )}

        <Field
          label="Up axis"
          hint="CAD files are usually Z-up while the viewer is Y-up, so a piece can arrive on its side."
        >
          <Select
            value={camera.upAxis}
            options={[
              { value: "y", label: "Y is up", hint: "Default" },
              { value: "z", label: "Z is up", hint: "Most CAD exports" },
              { value: "x", label: "X is up", hint: "Rare" },
            ]}
            onChange={(v) => onCamera?.({ ...camera, upAxis: v as CameraSettings["upAxis"] })}
            disabled={disabled}
            ariaLabel="Up axis"
          />
        </Field>

        <button
          className={`dock-btn dock-btn-lg w-full ${camera.rawGeometry ? "swatch-active" : ""}`}
          onClick={() => onCamera?.({ ...camera, rawGeometry: !camera.rawGeometry })}
          aria-pressed={camera.rawGeometry}
        >
          {camera.rawGeometry ? "Showing raw mesh" : "Show raw mesh"}
        </button>
        <p className="field-hint mb-1">
          Strips every material so you can inspect the geometry a file actually contains.
        </p>

        <Field
          label={`Near clip — ${(camera.nearFactor * 100).toFixed(1)}%`}
          hint="Raise it to slice into the front of the piece and see the setting inside."
        >
          <input
            className="studio-slider"
            type="range"
            min={0.001}
            max={0.9}
            step={0.001}
            value={camera.nearFactor}
            onChange={(e) => onCamera?.({ ...camera, nearFactor: Number(e.target.value) })}
          />
        </Field>

        <p className="field-label mt-3">Spin the piece</p>
        <p className="field-hint mb-2">
          Turns the piece itself under a fixed light. The turntable above orbits the camera instead
          — different shots.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Axis">
            <Select
              value={camera.spinAxis}
              options={[
                { value: "none", label: "Not spinning" },
                { value: "y", label: "Y — upright" },
                { value: "x", label: "X — tumble" },
                { value: "z", label: "Z — roll" },
              ]}
              onChange={(v) => onCamera?.({ ...camera, spinAxis: v as CameraSettings["spinAxis"] })}
              disabled={disabled}
              ariaLabel="Spin axis"
            />
          </Field>
          <Field label={`Speed — ${camera.spinSpeed.toFixed(2)}x`}>
            <input
              className="studio-slider"
              type="range"
              min={0.05}
              max={2}
              step={0.05}
              value={camera.spinSpeed}
              onChange={(e) => onCamera?.({ ...camera, spinSpeed: Number(e.target.value) })}
            />
          </Field>
        </div>

        <button
          className="dock-btn dock-btn-lg mt-2 w-full"
          onClick={() => onCamera?.(DEFAULT_CAMERA)}
          disabled={disabled}
        >
          <RotateCcw className="size-3.5" />
          Reset camera
        </button>
      </Section>
      {/* ── Environment ───────────────────────────────────────────
          Three tabs, because they are three different jobs people conflate:
          what the METAL reflects, what the STONES refract, and what sits
          BEHIND the piece. Only the last is a backdrop. */}
      <Section
        icon={<ImageIcon className="size-4" />}
        title="Environment"
        subtitle={BG_KINDS.find((k) => k.value === background.kind)?.label}
        open={open === "bg"}
        onToggle={() => toggle("bg")}
      >
        <EnvironmentPanel
          lighting={lighting}
          onLighting={(next) => onLighting?.(next)}
          background={background}
          onBackground={onBackground}
          onUploadImage={() => bgFile.current?.click()}
        />
        {/*
          The file input stays here rather than inside the panel: the panel is
          unmounted whenever another tab is showing, and an input that vanishes
          mid-pick cancels the pick.
        */}
        <input
          ref={bgFile}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            /*
             * Read to a data URL, not an object URL. The backdrop has to be
             * drawable into an export canvas without tainting it, and an
             * object URL dies the moment the page reloads.
             */
            const reader = new FileReader();
            reader.onload = () =>
              onBackground({ ...background, kind: "image", image: String(reader.result) });
            reader.readAsDataURL(file);
            e.target.value = "";
          }}
        />
      </Section>
      {/* ── Assistant ─────────────────────────────────────────────
          First on the rail rather than last: it is a second way to reach
          every other section, not one more setting to find after them. */}
      <Section
        icon={<Bot className="size-4" />}
        title="Assistant"
        subtitle="Ask it to change a setting"
        open={open === "assistant"}
        onToggle={() => toggle("assistant")}
        fill
      >
        <AIChat onAction={onChatAction ?? (() => ({ ok: false }))} context={chatContext} />
      </Section>
      {/* ── 1. Metals ──────────────────────────────────────────────
          Metals and stones are two sections again, one per rail icon. They
          share the same panel component and the same assignment state — the
          duplicate colour state that used to make them disagree is gone — but
          each shows only its own catalogue, so neither is a tab click away. */}
      {/* ── 0. Objects ──────────────────────────────────────────────
          Before the material sections, because it answers the question they
          all assume: which part. On a 675-object piece, finding one by
          clicking the render is not a workflow. */}
      <Section
        icon={<ListTree className="size-4" />}
        title="Objects"
        subtitle={
          parts.length
            ? `${parts.reduce((n, p) => n + solidCount(p), 0)} objects`
            : "Nothing loaded"
        }
        open={open === "objects"}
        onToggle={() => toggle("objects")}
      >
        <ObjectsPanel
          parts={parts}
          selected={selectedParts}
          onSelect={onSelectParts ?? (() => {})}
          groups={groups}
          onGroups={onGroups}
        />
      </Section>

      <Section
        icon={<Palette className="size-4" />}
        title="Metals"
        subtitle={finish.name}
        open={open === "metal"}
        onToggle={() => toggle("metal")}
      >
        <MaterialsPanel
          tab="metals"
          fallbackMetal={finish.id}
          onFallbackMetal={(id) =>
            onSelectFinish({ ...(finishById(id) ?? finish), surface: finish.surface })
          }
          parts={parts}
          selected={selectedParts}
          assignments={assignments}
          onAssignments={onAssignments ?? (() => {})}
          onSelect={onSelectParts}
          armed={armed}
          onArm={onArm}
        />
      </Section>

      {/* ── 1b. Stones ─────────────────────────────────────────────── */}
      <Section
        icon={<Gem className="size-4" />}
        title="Stones"
        subtitle={stones.length === 1 ? stones[0].label : `${stones.length} sets`}
        open={open === "stones"}
        onToggle={() => toggle("stones")}
      >
        <MaterialsPanel
          tab="gems"
          parts={parts}
          selected={selectedParts}
          assignments={assignments}
          onAssignments={onAssignments ?? (() => {})}
          onSelect={onSelectParts}
          armed={armed}
          onArm={onArm}
        />
      </Section>
      {/* ── 1c. Textures ────────────────────────────────────────────
          Its own rail section rather than a control inside Materials: a finish
          is chosen per part, the same way a metal is, and the two lists are
          long enough that stacking them buries both. */}
      <Section
        icon={<Waves className="size-4" />}
        title="Textures"
        subtitle={
          SURFACE_FINISHES.find((f) => f.id === (finish.surface ?? "none"))?.label ?? "Polished"
        }
        open={open === "textures"}
        onToggle={() => toggle("textures")}
      >
        <TexturesPanel
          parts={parts}
          selected={selectedParts}
          textures={textures}
          onTextures={onTextures ?? (() => {})}
          onSelect={onSelectParts}
          armed={armed}
          onArm={onArm}
          /*
           * The finish a part wears when nothing is assigned to it.
           *
           * Surface used to ALSO be a select in the Materials section, writing
           * to this while Textures wrote per part — two controls for one thing,
           * in two sections, with the per-part one silently winning. Textures
           * owns it now, and a choice meant for the whole piece sets this
           * rather than stamping an assignment onto every part.
           */
          fallbackFinish={finish.surface ?? "none"}
          onFallbackFinish={(id) =>
            onSelectFinish({ ...finish, surface: id === "none" ? undefined : id })
          }
        />
      </Section>
      {/* ── 1d. Stamping ────────────────────────────────────────────
          Beside the material sections rather than near export, because a
          hallmark is struck INTO the metal and travels into every render — it
          is part of the piece, not something added to a photograph of it. */}
      <Section
        icon={<StampIcon className="size-4" />}
        title="Stamping"
        subtitle={stamps.length ? `${stamps.length} struck` : "None"}
        open={open === "stamp"}
        onToggle={() => toggle("stamp")}
      >
        <StampsPanel
          parts={parts}
          stamps={stamps}
          onStamps={onStamps ?? (() => {})}
          draft={stampDraft}
          onDraft={onStampDraft ?? (() => {})}
          font={stampFont}
          onFont={onStampFont ?? (() => {})}
          selectedId={selectedStamp}
          onSelect={onSelectStamp ?? (() => {})}
          armed={armed}
          onArm={onArm}
        />
      </Section>

      {/* ── Prongs ────────────────────────────────────────────────
          Beside the other material sections for the same reason as Stamping:
          a prong is part of the piece, not a shot of it. The only section so
          far that edits geometry rather than a render parameter. */}
      <Section
        icon={<MoveVertical className="size-4" />}
        title="Prongs"
        subtitle={
          Object.keys(prongHeights).length ? `${Object.keys(prongHeights).length} adjusted` : "None"
        }
        open={open === "prongs"}
        onToggle={() => toggle("prongs")}
      >
        <ProngsPanel
          parts={parts}
          selected={selectedParts}
          prongHeights={prongHeights}
          onProngHeights={onProngHeights ?? (() => {})}
          onSelect={onSelectParts}
          armed={armed}
          onArm={onArm}
        />
      </Section>

      {/* ── Animation ─────────────────────────────────────────────
          Camera turntable and object spin together. They were in two sections,
          which is the wrong split: they look identical on screen and do
          completely different things to the lighting. */}
      <Section
        icon={<RotateCcw className="size-4" />}
        title="Animation"
        subtitle={
          [animation && animationById(animation).label, camera.spinAxis !== "none" && "Spinning"]
            .filter(Boolean)
            .join(" · ") || "Still"
        }
        open={open === "spin"}
        onToggle={() => toggle("spin")}
      >
        <AnimationPanel
          animation={animation}
          onAnimation={onAnimation}
          animationPlaying={animationPlaying}
          onAnimationPlaying={onAnimationPlaying}
          animationSeconds={animationSeconds}
          onAnimationSeconds={onAnimationSeconds}
          objectMove={objectMove}
          onObjectMove={onObjectMove}
          onReset={onReset}
          camera={camera}
          onCamera={onCamera}
        />
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

        {/*
         * Where it is going, as one decision — the same treatment Video gets.
         *
         * Shape and size are two controls expressing one intention, and print
         * adds DPI as a third. Nobody weighing 1:1 against 3:2 is thinking
         * about ratios; they are thinking "this goes on Instagram", and every
         * destination has one right answer for all of them. The controls below
         * remain for anyone who wants them.
         */}
        <PanelGroup title="Where is it going?">
          <div className="dest-grid" role="radiogroup" aria-label="Where is it going">
            {PHOTO_DESTINATIONS.map((d) => {
              const on = aspect.id === d.aspect && imageQuality === Math.min(d.base, maxBase);
              return (
                <button
                  key={d.id}
                  role="radio"
                  aria-checked={on}
                  className={`dest-chip ${on ? "dest-chip-on" : ""}`}
                  disabled={disabled}
                  onClick={() => {
                    setAspect(ASPECTS.find((a) => a.id === d.aspect) ?? ASPECTS[0]);
                    // Clamped to what this device can finish, same as Video.
                    setImageQuality(Math.min(d.base, maxBase));
                    /*
                     * Print is the only one that cares about DPI: 300 is what a
                     * press wants, and 72 is what everything on a screen wants.
                     * Getting it wrong lands a 4K render in InDesign at 42
                     * inches wide, which is the fault the pHYs writer exists to
                     * prevent — so the destination sets it rather than leaving
                     * it to be discovered.
                     */
                    onExportOptions?.({ ...exportOptions, dpi: d.id === "print" ? 300 : 72 });
                  }}
                >
                  <span className="dest-chip-label">{d.label}</span>
                  <span className="dest-chip-hint">{d.hint}</span>
                </button>
              );
            })}
          </div>
        </PanelGroup>

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
        <PanelIntro>
          The move you picked in Animation is what downloads. Everything here is the file it becomes
          — shape, size, frame rate and length.
        </PanelIntro>

        {/*
          The three-step instruction that used to open this section explained
          how to save a custom view. Useful once, then permanent clutter above
          the controls it describes — so it lives on the control itself now.
        */}
        <PanelGroup title="The shot">
          <div className="shot-preview">
            <span className="shot-preview-name">
              {animation ? animationById(animation).label : "No camera move"}
            </span>
            <span className="shot-preview-meta">
              {objectMove !== "none" && `${objectMoveById(objectMove).label} · `}
              {seconds}s · {videoDims.width}×{videoDims.height}
            </span>
          </div>
          <p className="field-hint">
            {animation
              ? animationById(animation).hint + "."
              : "Pick a camera move in Animation to change the shot. Without one the camera holds still."}
          </p>
        </PanelGroup>

        <PanelGroup title="Framing">
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
        </PanelGroup>

        {/*
         * Where it is going, as one decision.
         *
         * Shape, size, frame rate and length are four controls expressing one
         * intention: nobody weighing 9:16 against 4:5 is thinking about ratios,
         * they are thinking "this goes on Instagram" — and every platform has a
         * single right answer for all four. Asking separately is asking someone
         * to derive what we already know, and getting any one wrong spoils the
         * file. The controls below still exist for anyone who wants them.
         */}
        <PanelGroup title="Where is it going?">
          <div className="dest-grid" role="radiogroup" aria-label="Where is it going">
            {DESTINATIONS.map((d) => {
              const on =
                aspect.id === d.aspect &&
                videoBase === d.base &&
                fps === d.fps &&
                (d.seconds === undefined || seconds === d.seconds);
              return (
                <button
                  key={d.id}
                  role="radio"
                  aria-checked={on}
                  className={`dest-chip ${on ? "dest-chip-on" : ""}`}
                  disabled={disabled}
                  onClick={() => {
                    setAspect(ASPECTS.find((a) => a.id === d.aspect) ?? ASPECTS[0]);
                    // Clamped to what this device can actually finish. A phone
                    // asked for 4K60 is a killed tab, not a slow export.
                    setVideoBase(Math.min(d.base, maxBase));
                    setFps(Math.min(d.fps, maxFps));
                    if (d.seconds !== undefined) setSeconds(Math.min(d.seconds, maxSeconds));
                  }}
                >
                  <span className="dest-chip-label">{d.label}</span>
                  <span className="dest-chip-hint">{d.hint}</span>
                </button>
              );
            })}
          </div>
        </PanelGroup>

        <PanelGroup title="The file">
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
            <Field label="Frame rate" hint={maxFps < 60 ? "60fps is desktop only." : undefined}>
              <Select
                value={String(fps)}
                options={VIDEO_FPS.filter((f) => f <= maxFps).map((f) => ({
                  value: String(f),
                  label: `${f} fps`,
                }))}
                onChange={(v) => setFps(Number(v))}
                disabled={disabled}
                ariaLabel="Frame rate"
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
        </PanelGroup>

        {/*
         * Watch it before waiting for it.
         *
         * `poseAt` already drives both the viewport and the exporter, so what
         * plays IS what downloads — but the play control lives on the stage and
         * the download lives here, so nobody connected the two. Rendering a
         * clip to find out what it looks like costs minutes; this costs the
         * length of the clip.
         *
         * Preview sits beside Download rather than above it because they are
         * the same decision at two confidence levels.
         */}
        <div className="grid grid-cols-2 gap-2 mt-1">
          <button
            className="btn-ghost"
            onClick={() => {
              // Nothing to preview without a move: the camera would sit still
              // for six seconds and read as the button being broken.
              if (!animation) onAnimation?.("turntable");
              onAnimationPlaying?.(true);
            }}
            disabled={disabled}
            title="Play the clip in the viewport"
          >
            <Play className="size-3.5" />
            Preview
          </button>
          <button className="btn-primary" onClick={() => shootVideo()} disabled={disabled}>
            <Download className="size-3.5" />
            Download
          </button>
        </div>
        <p className="field-hint mt-1">
          Preview plays the exact clip in the viewport. Download writes it as{" "}
          {format === "webm" ? "WebM" : "MP4"}.
        </p>

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

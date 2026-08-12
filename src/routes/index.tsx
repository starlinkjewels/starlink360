import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { finishById, finishes, type Finish } from "@/data/finishes";
import { products, type Product } from "@/data/products";
import { IconRail, SectionPanel, TopBar } from "@/components/jewelry/shell/Shell";
import { DEFAULT_SECTION } from "@/components/jewelry/shell/sections";
import { CanvasToolbar, SelectionHud, ViewportActions } from "@/components/jewelry/shell/Canvas";
import { DEFAULT_TOOL, type ToolMode } from "@/components/jewelry/shell/tools";
import { useTheme } from "@/hooks/useTheme";
import { StudioPanel } from "@/components/jewelry/StudioPanel";
import type { StudioApi } from "@/components/jewelry/StudioRig";
import type { StoneGroup } from "@/components/jewelry/stones";
import { describeSelection, type Part, type PartKind } from "@/components/jewelry/selection";
import {
  assignToPart,
  canPaint,
  finishToPart,
  type Assignments,
  type Brush,
} from "@/components/jewelry/assign";
import { gemById, metalById, resolveGem, resolveMetal } from "@/components/jewelry/library";
import type { GemOptics } from "@/components/jewelry/GemRefraction";
import type { Textures } from "@/components/jewelry/panels/TexturesPanel";
import { DEFAULT_TEXTURE, type TextureAssignment } from "@/components/jewelry/textures";
import { DEFAULT_CAMERA, guessUpAxis, type CameraSettings } from "@/components/jewelry/camera";
import { ImportOrientation } from "@/components/jewelry/ImportOrientation";
import { DEFAULT_LIGHTING, type LightingSettings } from "@/components/jewelry/lighting";
import { resetLights, type LightDef } from "@/components/jewelry/lights";
import { DEFAULT_SHADOWS, type ShadowSettings } from "@/components/jewelry/shadows";
import { DEFAULT_GROUND, type GroundSettings } from "@/components/jewelry/ground";
import { DEFAULT_POST, type PostSettings } from "@/components/jewelry/bloom";
import { DEFAULT_EXPORT_OPTIONS, type ExportOptions } from "@/components/jewelry/exportOptions";
import { animationById, objectMoveById } from "@/components/jewelry/animation";
import {
  loadProject,
  pieceMismatch,
  projectFileName,
  projectJson,
  saveProject,
} from "@/components/jewelry/project";
import {
  DEFAULT_WATERMARK,
  watermarkStyle,
  type WatermarkSettings,
} from "@/components/jewelry/watermark";
import {
  DEFAULT_BACKGROUND,
  backgroundCss,
  type Background,
} from "@/components/jewelry/background";
import { LoadingOverlay } from "@/components/jewelry/LoadingOverlay";
import { UploadPiece, type UploadStatus } from "@/components/jewelry/UploadPiece";
import { downloadBlob } from "@/components/jewelry/studio";
import { estimateDecodeMs, useSmoothProgress } from "@/hooks/useSmoothProgress";

const Viewer = lazy(() => import("@/components/jewelry/Viewer"));

/**
 * Query parameters, so another system can drive the viewer by link.
 *
 * This is the embed contract: a jewellery management system that already holds
 * .3dm files points an iframe at `/?file=<url>&embed=1` and the piece loads.
 * Everything is optional and anything unrecognised is ignored, so a partial or
 * future link degrades to the normal viewer instead of erroring.
 *
 * Validated rather than read raw because `validateSearch` output feeds straight
 * into a fetch and into rendered text.
 */
export interface ViewerSearch {
  /** Model to load: an http(s) URL to a .3dm, .glb or .gltf. */
  file?: string;
  /** Display name, when the host system knows it better than the filename. */
  name?: string;
  /** Reference/SKU line under the name. */
  ref?: string;
  /** Hides the brand header, for use inside an iframe. */
  embed?: boolean;
  /**
   * Reveals the upload control. Without it there is no way to load a file by
   * hand, which is what keeps a client-facing link showing only the piece it
   * was given.
   */
  key?: string;
}

/*
 * Passphrase that reveals the upload control.
 *
 * Obscurity, not security: it travels in the address bar, so anyone who is sent
 * a link with it — or who reads it out of the page source — can use it. That is
 * acceptable for hiding a control, and must not be relied on for anything that
 * needs actually protecting.
 */
const UPLOAD_KEY = "bhumit";

const asText = (v: unknown, max: number): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : undefined;
};

/**
 * Reads the embed flag in whatever form the link writes it.
 *
 * Two traps here, both of which cost a redirect on every page load:
 *
 *  - Search values arrive already JSON-parsed, so `embed=1` is the NUMBER 1 and
 *    `embed=true` is a real boolean. A string-only check silently drops both,
 *    and the router then rewrites the address to remove the parameter.
 *  - The router rewrites whenever validation changes a value, so this must
 *    return `undefined` — not `false` — when absent. Returning `false` appended
 *    `embed=false` to every ordinary visit and redirected it.
 *
 * `embed=true` is therefore the canonical form and round-trips untouched. The
 * others are accepted and cost one harmless redirect.
 */
function parseEmbed(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v || undefined;
  if (v === undefined || v === null || v === "") return undefined;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase()) || undefined;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): ViewerSearch => ({
    file: asText(search.file, 2048),
    name: asText(search.name, 60),
    ref: asText(search.ref, 40),
    embed: parseEmbed(search.embed),
    key: asText(search.key, 40),
  }),
  head: () => ({
    meta: [
      { title: "RenderGod — Photorealistic Jewellery Rendering" },
      {
        name: "description",
        content:
          "Explore jewellery in interactive 3D with RenderGod. Rotate each piece in 360° and switch between gold, platinum and silver finishes live.",
      },
      { property: "og:title", content: "RenderGod — Photorealistic Jewellery Rendering" },
      {
        property: "og:description",
        content:
          "A real-time 3D viewer for fine jewelry: 360° turntable, live metal finishes and true diamond refraction.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [product, setProduct] = useState<Product>(products[0]);
  const [finish, setFinish] = useState<Finish>(finishes[0]);
  const [resetSignal, setResetSignal] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [section, setSection] = useState<string>(DEFAULT_SECTION);

  /*
   * Viewport mode. View and Select both work; the transform tools render
   * disabled with the reason in their tooltip.
   *
   * Opens in View, because the first thing anyone does is look at the piece.
   */
  const [tool, setTool] = useState<ToolMode>(DEFAULT_TOOL);
  const [showGrid, setShowGrid] = useState(false);
  const [locked, setLocked] = useState(false);
  const [theme, setTheme] = useTheme();

  const [upload, setUpload] = useState<UploadStatus | null>(null);
  const [uploadMsg, setUploadMsg] = useState<{ kind: "error" | "notice"; text: string } | null>(
    null,
  );
  const uploadRef = useRef<HTMLDivElement>(null);
  const studio = useRef<StudioApi | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  /*
   * Stone recolouring.
   *
   * Overrides are keyed by group id and hold only what the user changed, so
   * "reset" is a delete rather than a stored copy of the original — the file
   * stays the source of truth for anything untouched.
   */
  const [cameraSettings, setCameraSettings] = useState<CameraSettings>(DEFAULT_CAMERA);
  /*
   * Where the camera is, as it moves. Only used to fill the Position fields, so
   * a stale value costs nothing — which is why the viewer publishes it on a
   * hundredth-of-a-unit change rather than every frame.
   */
  const [livePosition, setLivePosition] = useState<[number, number, number]>([0, 0, 0]);

  /*
   * Which way up the file meant.
   *
   * Asked at the moment it matters rather than left buried in a panel: someone
   * whose ring has just loaded on its side concludes the viewer cannot open
   * their file, and does not know to go looking for the words "up axis".
   * Suppressed for the built-in piece, which is already upright.
   */
  const [orientFor, setOrientFor] = useState<string | null>(null);

  const [exportOptions, setExportOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);

  /*
   * The camera move being previewed.
   *
   * Held here rather than in the panel because the viewport plays it and the
   * panel unmounts whenever another section is open — a move would stop the
   * moment you went to check the lighting.
   */
  const [animation, setAnimation] = useState<string | null>(null);
  const [animationPlaying, setAnimationPlaying] = useState(false);
  const [animationSeconds, setAnimationSeconds] = useState(6);
  /** A move applied to the piece rather than the camera. "none" is at rest. */
  const [objectMove, setObjectMove] = useState("none");
  const projectFile = useRef<HTMLInputElement>(null);
  const [lighting, setLighting] = useState<LightingSettings>(DEFAULT_LIGHTING);
  /*
   * The rig, seeded with the five lights that used to be written into the
   * viewport. Held here rather than in the panel because the render needs it
   * and the panel unmounts whenever another section is open.
   */
  const [lights, setLights] = useState<LightDef[]>(() => resetLights());
  const [debugLights, setDebugLights] = useState(false);
  const [shadows, setShadows] = useState<ShadowSettings>(DEFAULT_SHADOWS);
  const [ground, setGround] = useState<GroundSettings>(DEFAULT_GROUND);
  const [watermark, setWatermark] = useState<WatermarkSettings>(DEFAULT_WATERMARK);
  const [post, setPost] = useState<PostSettings>(DEFAULT_POST);
  /*
   * The live mark is sized from the stage, not the export, so what is on
   * screen is the same proportion of the picture that a download will be.
   */
  const stageRef = useRef<HTMLElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setStageSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [background, setBackground] = useState<Background>(DEFAULT_BACKGROUND);
  const [stones, setStones] = useState<StoneGroup[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const stageBackground = backgroundCss(background);
  const [stoneColors, setStoneColors] = useState<Record<string, string>>({});
  const [selectedStone, setSelectedStone] = useState<string | null>(null);

  /*
   * Materials chosen per part, by part id — the Materials panel's whole output.
   *
   * Held here rather than in the panel because the render needs it and the
   * panel unmounts whenever another section is open. A material chosen in the
   * panel has to survive switching to Lighting and back.
   */
  const [assignments, setAssignments] = useState<Assignments>({});
  /*
   * The material loaded onto the brush.
   *
   * null is "not painting". "" is "painting, nothing picked yet" — a real state,
   * because turning the mode on before choosing a material is the natural order
   * and the panel has to be able to say "pick one".
   */
  /** Surface finish per part id, the same shape as the material assignments. */
  const [textures, setTextures] = useState<Textures>({});
  /*
   * One brush, carrying which kind of part it paints.
   *
   * Both Materials sections read it, and each shows itself as armed only when
   * the kind matches — a bare material id lit the brush in Metals the moment
   * one was armed in Stones.
   */
  const [brush, setBrush] = useState<Brush | null>(null);

  /*
   * A brush only paints its own kind.
   *
   * Returning false hands the click back to selection, so a metal brush over a
   * stone still selects the stone rather than doing nothing — and, crucially,
   * never writes a metal material under a stone's id, which is an assignment
   * both renderers ignore and which therefore looked like a broken feature.
   */
  const handlePaintPart = useCallback(
    (partId: string, kind: PartKind) => {
      if (!brush || !canPaint(kind, brush.kind)) return false;
      /*
       * An armed brush with nothing on it hands the click back rather than
       * writing an empty assignment. Arming and loading are two steps, and
       * between them a click should still select — silently doing nothing is
       * how the paint feature read as broken the first time round.
       */
      if (brush.tool === "finish") {
        if (!brush.finish) return false;
        setTextures((prev) => finishToPart(prev, partId, brush.finish, DEFAULT_TEXTURE));
        return true;
      }
      if (!brush.material) return false;
      setAssignments((prev) => assignToPart(prev, partId, brush.material));
      return true;
    },
    [brush],
  );

  const handleStones = useCallback((groups: StoneGroup[]) => {
    setStones(groups);
    // A new piece has different stones; carrying colours across would apply a
    // ruby chosen on one ring to whatever happens to share an id on the next.
    setStoneColors({});
    setSelectedStone(null);
    // Same reasoning for assigned materials — the ids are per piece.
    setAssignments({});
    setTextures({});
    setBrush(null);
    // A new piece has different parts; carrying ids across would leave a
    // selection pointing at meshes that no longer exist.
    setSelected(new Set());
  }, []);

  /*
   * The assignments, resolved into what each renderer actually wants.
   *
   * Split by kind here rather than in the renderers so neither of them has to
   * know the library exists — Model takes colours and numbers, GemRefraction
   * takes IOR and aberration, and the catalogue stays in one place.
   */
  const metalOverrides = useMemo(() => {
    const out: Record<
      string,
      { color: string; roughness: number; metalness: number; texture?: TextureAssignment }
    > = {};
    /*
     * Material and finish are folded into ONE per-part spec, because the
     * renderer merges draw runs by comparing these objects: two prongs in the
     * same gold with different finishes have to stay separate runs, and
     * comparing the colour alone would merge them into one.
     */
    for (const [partId, a] of Object.entries(assignments)) {
      const metal = metalById(a.material);
      if (metal) out[partId] = resolveMetal(metal, a.patch);
    }
    for (const [partId, t] of Object.entries(textures)) {
      const base =
        out[partId] ??
        // A part with a finish but no chosen metal keeps the global one.
        resolveMetal(metalById(finish.id) ?? { ...finish, group: "Gold", metalness: 1 });
      out[partId] = { ...base, texture: t };
    }
    return out;
  }, [assignments, textures, finish]);

  const gemOverrides = useMemo(() => {
    const out: Record<string, GemOptics> = {};
    for (const [partId, a] of Object.entries(assignments)) {
      const gem = gemById(a.material);
      if (gem) {
        const r = resolveGem(gem, a.patch);
        out[partId] = { ior: r.ior, aberration: r.aberration, transmission: r.transmission };
      }
    }
    return out;
  }, [assignments]);

  /*
   * Stone colour has two sources: a gem chosen from the library, and the "any
   * other colour" picker. They write to one map with the picker last, so the
   * more specific choice wins and there is never a race between two states.
   */
  const effectiveStoneColors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [partId, a] of Object.entries(assignments)) {
      const gem = gemById(a.material);
      if (gem) out[partId] = resolveGem(gem, a.patch).color;
    }
    return { ...out, ...stoneColors };
  }, [assignments, stoneColors]);

  /*
   * Leaving Select drops the selection.
   *
   * The highlight is hidden outside Select, so keeping the ids would leave an
   * invisible selection that the Materials panel still narrows to — a swatch
   * would land on a part nobody can see is chosen.
   */
  useEffect(() => {
    if (tool !== "select") setSelected(new Set());
  }, [tool]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedStone(null);
        setSelected(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleStoneColor = useCallback((id: string, hex: string | null) => {
    setStoneColors((prev) => {
      if (hex === null) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: hex };
    });
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close upload popover on outside click
  useEffect(() => {
    if (!showUpload) return;
    const handler = (e: MouseEvent) => {
      if (uploadRef.current && !uploadRef.current.contains(e.target as Node)) {
        setShowUpload(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showUpload]);

  const onLoadedChange = useCallback((v: boolean) => setLoaded(v), []);
  const closeControls = useCallback(() => setShowControls(false), []);

  // Hand the whole stage over to the decode as soon as one starts — watching a
  // long job through a corner popover is what made this feel broken.
  const decoding = upload !== null;
  useEffect(() => {
    if (decoding) setShowUpload(false);
  }, [decoding]);

  const estimatedMs = useMemo(() => estimateDecodeMs(upload?.fileBytes ?? 0), [upload?.fileBytes]);
  const uploadPercent = useSmoothProgress(decoding, upload?.progress.percent ?? 0, estimatedMs);

  // Tap-to-focus isn't discoverable on its own, so prompt once the piece is
  // up, then get out of the way on first touch or after a few seconds.
  const [showHint, setShowHint] = useState(true);
  useEffect(() => {
    if (!loaded || !showHint) return;
    const t = setTimeout(() => setShowHint(false), 6000);
    return () => clearTimeout(t);
  }, [loaded, showHint]);

  /*
   * Save and open.
   *
   * The model is deliberately NOT in the file — a .3dm is tens of megabytes and
   * already lives in the client's own system. What is saved is the twenty
   * minutes of lighting, which is the part that is expensive to recreate and
   * the part worth sending to a colleague.
   */
  const handleSaveProject = useCallback(() => {
    const project = saveProject(
      {
        piece: { name: product.name, ref: product.ref },
        finish: { id: finish.id, surface: finish.surface },
        materials: assignments,
        textures,
        camera: cameraSettings,
        lighting,
        lights,
        shadows,
        ground,
        background,
        post,
        watermark,
        animation: { move: animation, objectMove, seconds: animationSeconds },
      },
      new Date().toISOString(),
    );
    const blob = new Blob([projectJson(project)], { type: "application/json" });
    downloadBlob(blob, projectFileName(product.ref));
  }, [
    product,
    finish,
    assignments,
    textures,
    cameraSettings,
    lighting,
    lights,
    shadows,
    ground,
    background,
    post,
    watermark,
    animation,
    objectMove,
    animationSeconds,
  ]);

  const handleOpenProject = useCallback(
    async (file: File) => {
      const { project, notices } = loadProject(await file.text());
      if (!project) {
        setUploadMsg({ kind: "error", text: notices[0] ?? "That project could not be read." });
        return;
      }

      /*
       * Applied in one go. Materials and textures are keyed by part id, which
       * is derived from the file's own layer names — so on a different piece
       * they match nothing, and `pieceMismatch` says so rather than leaving
       * someone to wonder why only half of it applied.
       */
      // `finishById` also resolves the ids the old five-metal list used, so a
      // project saved before the two vocabularies merged opens in its own metal
      // rather than silently reverting to the first quick pick.
      setFinish((f) => ({
        ...(finishById(project.finish.id) ?? f),
        surface: project.finish.surface,
      }));
      setAssignments(project.materials);
      setTextures(project.textures);
      setCameraSettings(project.camera);
      setLighting(project.lighting);
      setLights(project.lights);
      setShadows(project.shadows);
      setGround(project.ground);
      setBackground(project.background);
      setPost(project.post);
      setWatermark(project.watermark);
      setAnimation(project.animation.move);
      setObjectMove(project.animation.objectMove);
      setAnimationSeconds(project.animation.seconds);
      // A loaded project does not start playing: a scene that begins moving the
      // moment it opens is a demo, not somebody's saved setup.
      setAnimationPlaying(false);

      const mismatch = pieceMismatch(project, product.ref);
      const all = [...notices, ...(mismatch ? [mismatch] : [])];
      setUploadMsg(all.length ? { kind: "notice", text: all.join(" ") } : null);
    },
    [product.ref],
  );

  const handleUploaded = useCallback((p: Product) => {
    setProduct(p);
    setResetSignal((n) => n + 1);
    setLoaded(false);
    setShowUpload(false);
    /*
     * Ask which way up, pre-filled with the guess from the extension. Only for
     * a loaded file: the built-in piece is already upright, and prompting about
     * it would be a dialog in front of something that is plainly fine.
     */
    const name = p.ref || p.name || "";
    setCameraSettings((c) => ({ ...c, upAxis: guessUpAxis(name) }));
    setOrientFor(name || "this model");
  }, []);

  /*
   * Load the piece named in the link.
   *
   * Keyed on the URL alone so navigating between two pieces inside the same
   * embed reloads, while a re-render for any other reason does not. The abort
   * matters: swapping pieces mid-download would otherwise let the first fetch
   * finish later and overwrite the second.
   */
  const { file: fileUrl, name: linkName, ref: linkRef, embed, key } = Route.useSearch();
  // Hidden everywhere by default — on the plain route and behind a ?file= link
  // alike. Only the passphrase brings it back.
  const canUpload = key === UPLOAD_KEY;

  useEffect(() => {
    if (!fileUrl) return;
    const abort = new AbortController();
    let live = true;

    setUploadMsg(null);
    void (async () => {
      try {
        const { loadRemoteJewelry } = await import("@/lib/loadRemoteJewelry");

        /*
         * Filled by `onMeta`, NOT destructured from the call below.
         *
         * Reading `fileName` out of `const { fileName } = await load(...)`
         * inside this very call's `onProgress` throws "Cannot access 'fileName'
         * before initialization" on the first progress tick — the binding does
         * not exist until the promise resolves. It fired before the request was
         * even sent, which made it look like a bundling fault rather than a
         * plain scoping one.
         */
        const meta = { fileName: "", bytes: 0 };
        const { object } = await loadRemoteJewelry(fileUrl, {
          signal: abort.signal,
          onMeta: (m) => {
            meta.fileName = m.fileName;
            meta.bytes = m.bytes;
          },
          onProgress: (progress) => {
            if (live) setUpload({ progress, fileName: meta.fileName, fileBytes: meta.bytes });
          },
        });
        if (!live) return;

        const { fileName, bytes } = meta;
        const base = fileName.replace(/\.[^.]+$/, "");
        handleUploaded({
          id: `link-${fileUrl}`,
          name: linkName ?? base.slice(0, 28) ?? "Piece",
          ref: linkRef ?? `Ref. ${base.slice(0, 10).toUpperCase()}`,
          glbUrl: "",
          description: `Loaded from link · ${(bytes / 1048576).toFixed(1)} MB.`,
          object,
        });

        // Parts Rhino saved without a render mesh cannot be drawn — say so
        // rather than let the piece show up missing its band unexplained.
        const notices = (object.userData as { notices?: string[] }).notices;
        if (notices?.length) setUploadMsg({ kind: "notice", text: notices.join(" ") });
      } catch (e) {
        if (!live || (e instanceof DOMException && e.name === "AbortError")) return;
        const { RemoteLoadError } = await import("@/lib/loadRemoteJewelry");
        setUploadMsg({
          kind: "error",
          text:
            e instanceof RemoteLoadError
              ? [e.message, e.detail].filter(Boolean).join(" ")
              : e instanceof Error
                ? e.message
                : "Could not load that model link.",
        });
      } finally {
        if (live) setUpload(null);
      }
    })();

    return () => {
      live = false;
      abort.abort();
    };
  }, [fileUrl, linkName, linkRef, handleUploaded]);

  /*
   * Choosing a section from the rail opens the panel. On a phone the panel is a
   * sheet, so the rail doubles as the way in; on desktop it is always docked and
   * this is a no-op after the first click.
   */
  const pickSection = useCallback((id: string) => {
    setSection(id);
    setShowControls(true);
  }, []);

  return (
    <div className="app">
      <TopBar
        onReset={() => setResetSignal((n) => n + 1)}
        onSave={handleSaveProject}
        onOpen={() => projectFile.current?.click()}
        onUpload={canUpload ? () => setShowUpload(true) : undefined}
        canUpload={canUpload}
      />
      {/*
        The picker lives here rather than in the top bar so it survives every
        re-render of the header — an input that unmounts mid-pick cancels it.
      */}
      <input
        ref={projectFile}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleOpenProject(file);
        }}
      />

      <div className="app-body">
        <main
          ref={stageRef}
          className="viewport"
          /*
           * The chosen backdrop, painted by CSS behind a transparent WebGL
           * canvas. Nothing is added to the 3D scene, so it costs no frame time
           * and never picks up the tone mapping meant for metal and stones.
           * `null` means the default stage, whose look lives in the stylesheet.
           */
          style={stageBackground ? { background: stageBackground } : undefined}
          onPointerDown={() => setShowHint(false)}
        >
          {canUpload && showUpload && (
            <div ref={uploadRef} className="upload-float">
              <div className="upload-popover">
                <UploadPiece
                  onLoaded={handleUploaded}
                  onStatus={setUpload}
                  onResult={setUploadMsg}
                />
              </div>
            </div>
          )}

          {/* ── Full-bleed 3D canvas ─────────────────────────────────── */}
          {/* touch-none stops the page panning/pull-to-refresh while orbiting */}
          <div className="absolute inset-0 touch-none">
            {mounted ? (
              <Suspense fallback={upload ? null : <LoadingOverlay />}>
                <Viewer
                  product={product}
                  finish={finish}
                  resetSignal={resetSignal}
                  hideLoader={upload !== null}
                  camera={cameraSettings}
                  lighting={lighting}
                  lights={lights}
                  debugLights={debugLights}
                  shadows={shadows}
                  ground={ground}
                  post={post}
                  stoneColors={effectiveStoneColors}
                  metalOverrides={metalOverrides}
                  gemOverrides={gemOverrides}
                  onStones={handleStones}
                  onStoneTap={setSelectedStone}
                  onParts={setParts}
                  selected={selected}
                  selecting={tool === "select"}
                  onSelected={setSelected}
                  onCameraMoved={setLivePosition}
                  animation={animation ? animationById(animation) : null}
                  animationPlaying={animationPlaying}
                  animationSeconds={animationSeconds}
                  objectMove={objectMove === "none" ? null : objectMoveById(objectMove)}
                  onPaintPart={handlePaintPart}
                  onLoadedChange={onLoadedChange}
                  studioRef={studio}
                />
              </Suspense>
            ) : (
              <LoadingOverlay />
            )}
          </div>

          {/* Studio branding, matching what an export will burn in. */}
          {watermarkStyle(watermark, stageSize.w, stageSize.h) && (
            <span style={watermarkStyle(watermark, stageSize.w, stageSize.h)!}>
              {watermark.text.trim()}
            </span>
          )}

          <SelectionHud
            count={selected.size}
            label={describeSelection(parts, selected)}
            onClear={() => setSelected(new Set())}
          />

          <CanvasToolbar
            state={{ mode: tool, grid: showGrid, locked }}
            onMode={setTool}
            onGrid={() => setShowGrid((v) => !v)}
            onLock={() => setLocked((v) => !v)}
            onContrast={() => setTheme(theme === "dark" ? "light" : "dark")}
          />

          <ViewportActions
            onResetView={() => setResetSignal((n) => n + 1)}
            viewportRef={stageRef}
          />

          {/* Curtain over the canvas while exporting. The renderer is resized to
          the output dimensions for every frame, so the live viewport would
          otherwise flicker between shapes and look broken. */}
          {exporting && (
            <div className="export-curtain" role="status">
              <span className="loader-star">✦</span>
              <p className="export-curtain-text">{exporting}</p>
            </div>
          )}

          {/* ── Upload outcome — the popover has closed by now ────────── */}
          {uploadMsg && !upload && (
            <div className="upload-banner" role={uploadMsg.kind === "error" ? "alert" : "status"}>
              <span className={uploadMsg.kind === "error" ? "text-destructive" : "text-accent"}>
                {uploadMsg.text}
              </span>
              <button
                className="upload-banner-close"
                onClick={() => setUploadMsg(null)}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          {/* ── Decode takes over the stage ───────────────────────────── */}
          {upload && (
            <LoadingOverlay
              label={upload.progress.phase}
              percent={uploadPercent}
              detail={
                upload.fileBytes > 0
                  ? `${upload.fileName} · ${(upload.fileBytes / 1048576).toFixed(1)} MB`
                  : upload.fileName
              }
            />
          )}

          {/* ── First-run affordance for tap-to-focus ─────────────────── */}
          {loaded && showHint && !upload && (
            <p className="tap-hint">
              <span className="hint-touch">Tap the pendant to zoom in on it</span>
              <span className="hint-pointer">Click any detail to zoom in on it</span>
            </p>
          )}

          {/*
            The piece name used to be captioned across the bottom-left of the
            stage, which is where the axis gizmo sits — the two overlapped and
            the name read straight through the axis handles.

            Removed rather than moved. Every other corner is already occupied
            (selection HUD, reset and fullscreen, the toolbar), and the name is
            not information the viewport needs to carry: it is in the panel, in
            the export filenames, and in the tab title. A caption over a render
            is decoration, and decoration does not get to win a corner from a
            control.
          */}
        </main>

        {/* Phones get the panel as a sheet over the viewport; from lg up it
            docks beside it. The rail is present at both sizes — horizontal
            below lg — because it is the navigation, not a decoration. */}
        {showControls && (
          <div className="sheet-backdrop lg:hidden" onClick={closeControls} aria-hidden="true" />
        )}
        <SectionPanel active={section} open={showControls} onClose={closeControls}>
          <StudioPanel
            active={section}
            onActive={setSection}
            finish={finish}
            onSelectFinish={setFinish}
            onReset={() => setResetSignal((n) => n + 1)}
            studio={studio}
            onBusyChange={setExporting}
            productRef={product.ref}
            camera={cameraSettings}
            onCamera={setCameraSettings}
            livePosition={livePosition}
            animation={animation}
            onAnimation={(id) => {
              setAnimation(id);
              // Choosing a move starts it: picking one and then hunting for a
              // play button is a step nobody wants.
              setAnimationPlaying(id !== null);
            }}
            animationPlaying={animationPlaying}
            onAnimationPlaying={setAnimationPlaying}
            animationSeconds={animationSeconds}
            onAnimationSeconds={setAnimationSeconds}
            objectMove={objectMove}
            onObjectMove={(id) => {
              setObjectMove(id);
              // Choosing a move plays it, the same as the camera list — picking
              // one and then hunting for a play button is a step nobody wants.
              if (id !== "none") setAnimationPlaying(true);
            }}
            exportOptions={exportOptions}
            onExportOptions={setExportOptions}
            lighting={lighting}
            onLighting={setLighting}
            lights={lights}
            onLights={setLights}
            debugLights={debugLights}
            onDebugLights={setDebugLights}
            shadows={shadows}
            onShadows={setShadows}
            ground={ground}
            onGround={setGround}
            watermark={watermark}
            onWatermark={setWatermark}
            post={post}
            onPost={setPost}
            background={background}
            onBackground={setBackground}
            stones={stones}
            stoneColors={stoneColors}
            onStoneColor={handleStoneColor}
            parts={parts}
            selectedParts={selected}
            onSelectParts={setSelected}
            assignments={assignments}
            onAssignments={setAssignments}
            armed={brush}
            onArm={setBrush}
            textures={textures}
            onTextures={setTextures}
            selectedStone={selectedStone}
            onSelectStone={setSelectedStone}
          />
        </SectionPanel>

        <IconRail active={section} onSelect={pickSection} />

        {/*
          Asked once, when a file arrives. The stage is behind it and updates as
          the choice changes, which is the whole point — the answer is obvious
          from looking, and impossible to reason about from the words alone.
        */}
        {orientFor && (
          <ImportOrientation
            fileName={orientFor}
            value={cameraSettings.upAxis}
            onChange={(upAxis) => setCameraSettings((c) => ({ ...c, upAxis }))}
            onClose={() => setOrientFor(null)}
          />
        )}
      </div>
    </div>
  );
}

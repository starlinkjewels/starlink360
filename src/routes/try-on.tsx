import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Circle,
  Diamond,
  Download,
  Gem,
  Hand,
  Link2,
  LoaderCircle,
  RotateCcw,
  ScanFace,
  Share2,
  Sparkles,
  SwitchCamera,
  User,
  X,
} from "lucide-react";
import {
  CATEGORIES,
  TRYON_GEMS,
  TRYON_METALS,
  categoryById,
  styleById,
  type Category,
} from "@/components/tryon/catalog";
import type { TryOnConfig, TryOnStatus } from "@/components/tryon/engine";
import type { TryOnHandle } from "@/components/tryon/TryOnStage";
import type { Finger } from "@/components/tryon/anchors";
import type { ChainLength } from "@/components/tryon/jewelry";
import { BACKDROPS, backdropById } from "@/components/tryon/backdrops";
import { gemById, metalById } from "@/components/jewelry/library";
import { downloadBlob } from "@/components/jewelry/studio";
import { getTryOnHandoff } from "@/components/tryon/handoff";
import type { PreparedStudioPiece, StudioPieceSource } from "@/components/tryon/studioFit";

const TryOnStage = lazy(() => import("@/components/tryon/TryOnStage"));

interface TryOnSearch {
  category?: Category;
  debug?: boolean;
  /** The studio piece's file link, so a reload can load it again. */
  file?: string;
}

export const Route = createFileRoute("/try-on")({
  validateSearch: (s: Record<string, unknown>): TryOnSearch => ({
    category: CATEGORIES.some((c) => c.id === s.category) ? (s.category as Category) : undefined,
    debug: s.debug === true || s.debug === 1 || s.debug === "1" || s.debug === "true" || undefined,
    file: typeof s.file === "string" && s.file.trim() ? s.file.trim().slice(0, 2048) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Netram — Virtual Try-On" },
      {
        name: "description",
        content:
          "Try on diamond rings, bracelets, bangles, earrings and necklaces live through your camera. Real brilliant-cut diamonds, real metals, tracked to your hand and face.",
      },
    ],
  }),
  component: TryOn,
});

const CATEGORY_ICON: Record<Category, typeof Gem> = {
  ring: Gem,
  bracelet: Link2,
  bangle: Circle,
  earrings: Sparkles,
  necklace: Diamond,
};

const GUIDE_ICON = { hand: Hand, face: ScanFace, pose: User } as const;

const FINGER_OPTIONS: { id: Finger; label: string }[] = [
  { id: "index", label: "Index" },
  { id: "middle", label: "Middle" },
  { id: "ring", label: "Ring" },
  { id: "pinky", label: "Little" },
];

const CHAIN_OPTIONS: { id: ChainLength; label: string; hint: string }[] = [
  { id: "choker", label: "Choker", hint: "40 cm" },
  { id: "princess", label: "Princess", hint: "45 cm" },
  { id: "matinee", label: "Matinee", hint: "55 cm" },
];

const LOADING_TEXT: Record<string, string> = {
  hand: "Loading hand tracking…",
  face: "Loading face tracking…",
  pose: "Loading body tracking…",
};

function TryOn() {
  const search = Route.useSearch();
  /*
   * What the studio was showing (tryon/handoff.ts). Read once: the try-on
   * opens on the piece that was on the stage when Try On was pressed.
   */
  const [handoff] = useState(getTryOnHandoff);
  const catalogue = handoff?.kind === "catalogue" ? handoff.spec : null;

  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<"camera" | "preview">("camera");
  const [category, setCategory] = useState<Category>(
    search.category ?? catalogue?.category ?? "ring",
  );
  /** Set once the visitor picks a category, so the guess never overrides them. */
  const chosenCategory = useRef(!!search.category);
  const [styles, setStyles] = useState<Partial<Record<Category, string>>>(
    catalogue ? { [catalogue.category]: catalogue.style } : {},
  );
  const [carats, setCarats] = useState<Record<string, number>>(
    catalogue ? { [`${catalogue.category}:${catalogue.style}`]: catalogue.carat } : {},
  );

  /*
   * The studio's own piece: from the hand-off, or loaded again from the link
   * when the page was opened (or reloaded) directly. Prepared once (stone
   * BVHs, measurements), then worn in whichever category is chosen.
   */
  const [studioSrc, setStudioSrc] = useState<StudioPieceSource | null>(
    handoff?.kind === "studio" ? handoff.piece : null,
  );
  const [prepared, setPrepared] = useState<PreparedStudioPiece | null>(null);
  const [preparing, setPreparing] = useState(
    handoff?.kind === "studio" || (!handoff && !!search.file),
  );
  /** Wearing the studio piece rather than a catalogue style. */
  const [useStudio, setUseStudio] = useState(true);
  const [studioError, setStudioError] = useState<string | null>(null);
  /** A pendant hangs on the catalogue chain; a whole necklace brings its own. */
  const [studioChain, setStudioChain] = useState(true);

  useEffect(() => {
    if (studioSrc || handoff || !search.file) return;
    let live = true;
    void (async () => {
      try {
        const { loadRemoteJewelry } = await import("@/lib/loadRemoteJewelry");
        const { object, fileName } = await loadRemoteJewelry(search.file!);
        if (!live) return;
        const { guessUpAxis } = await import("@/components/jewelry/camera");
        setStudioSrc({
          object,
          name: fileName,
          upAxis: guessUpAxis(fileName),
          mmPerUnit: (object.userData as { detectedMMPerUnit?: number }).detectedMMPerUnit ?? null,
        });
      } catch (e) {
        if (!live) return;
        setPreparing(false);
        setStudioError(e instanceof Error ? e.message : "Could not load the piece.");
      }
    })();
    return () => {
      live = false;
    };
  }, [studioSrc, handoff, search.file]);

  useEffect(() => {
    if (!studioSrc) return;
    let live = true;
    setPreparing(true);
    void (async () => {
      try {
        const { prepareStudioPiece, guessCategory, usesChainLength } =
          await import("@/components/tryon/studioFit");
        const prep = await prepareStudioPiece(studioSrc);
        if (!live) return;
        setPrepared(prep);
        setStudioChain(usesChainLength(prep));
        if (!chosenCategory.current) setCategory(guessCategory(prep));
      } catch (e) {
        if (live) setStudioError(e instanceof Error ? e.message : "Could not prepare the piece.");
      } finally {
        if (live) setPreparing(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [studioSrc]);

  const wearingStudio = useStudio && prepared !== null;
  const [metalId, setMetalId] = useState(TRYON_METALS[0]);
  const [gemId, setGemId] = useState(TRYON_GEMS[0]);
  const [fit, setFit] = useState(1);
  const [finger, setFinger] = useState<Finger>("ring");
  const [chain, setChain] = useState<ChainLength>("princess");
  const [status, setStatus] = useState<TryOnStatus>({ phase: "idle" });
  const [shot, setShot] = useState<{ url: string; blob: Blob } | null>(null);
  const [flash, setFlash] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  /*
   * Sparkle follows the mode until the visitor chooses: off in the 3D view,
   * where the clean product-photo look is the point, on over the camera,
   * where small stones on a phone need the help to read as diamonds.
   */
  const [sparkleChoice, setSparkleChoice] = useState<boolean | null>(null);
  const [backdrop, setBackdrop] = useState("ivory");
  const handle = useRef<TryOnHandle | null>(null);

  const cat = categoryById(category);
  const style = styleById(category, styles[category] ?? cat.styles[0].id);
  const caratKey = `${category}:${style.id}`;
  const carat = carats[caratKey] ?? style.stone?.value ?? 0;
  const sparkle = sparkleChoice ?? mode === "camera";
  /** Stone choices apply to a catalogue style with a stone, or a studio piece that has stones. */
  const showStone = wearingStudio ? !!prepared?.hasGems : !!style.stone;

  const config = useMemo<TryOnConfig>(
    () => ({
      category,
      style: style.id,
      metalId,
      gemId,
      carat,
      fit,
      finger,
      chain,
      debug: !!search.debug,
      sparkle,
      backdrop,
      studio: wearingStudio ? prepared : null,
    }),
    [
      category,
      style.id,
      metalId,
      gemId,
      carat,
      fit,
      finger,
      chain,
      search.debug,
      sparkle,
      backdrop,
      wearingStudio,
      prepared,
    ],
  );

  /* ------------------------------------------------------------ camera */

  /*
   * The camera button asks the browser directly, the standard flow: starting
   * the camera calls getUserMedia, which shows the browser's own permission
   * prompt the first time and starts at once when it is already allowed.
   * There is no dialog of our own in front of it. When the browser refuses
   * (blocked, or no camera), the engine reports it and the error card below
   * says why, with Try again and the 3D view as the ways forward.
   */
  const startCamera = useCallback(() => {
    setStatus({ phase: "camera" });
    setMode("camera");
    setStarted(true);
    setAttempt((n) => n + 1);
  }, []);

  const viewIn3D = useCallback(() => {
    setStatus({ phase: "idle" });
    setMode("preview");
    setStarted(true);
  }, []);

  /*
   * Embedded without the camera.
   *
   * Inside another site's iframe the browser only lets the page use the
   * camera if the iframe was given allow="camera" (EMBED.md). Without it the
   * request is refused silently, with no prompt at all, and no setting a
   * visitor can change will fix it. Chrome and Edge can say so up front; for
   * the rest, a refusal inside a frame is treated the same way. Either way the
   * way forward is the try-on in its own tab, where the browser asks normally.
   */
  const [embedded] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  });
  /** Whether the frame's camera permission is known to be missing, or unknowable. */
  const [frameCamera] = useState<"allowed" | "blocked" | "unknown">(() => {
    if (!embedded || typeof document === "undefined") return "allowed";
    const doc = document as Document & {
      permissionsPolicy?: { allowsFeature(f: string): boolean };
      featurePolicy?: { allowsFeature(f: string): boolean };
    };
    const policy = doc.permissionsPolicy ?? doc.featurePolicy;
    if (!policy) return "unknown"; // Safari and Firefox cannot say
    try {
      return policy.allowsFeature("camera") ? "allowed" : "blocked";
    } catch {
      return "unknown";
    }
  });
  const frameBlocksCamera = frameCamera === "blocked";
  /** A refusal that is the frame's doing, not the visitor's choice. */
  const frameMayBlockCamera = frameCamera !== "allowed";
  const openInOwnTab = useCallback(() => {
    window.open(window.location.href, "_blank", "noopener");
  }, []);

  /*
   * Opening the try-on asks for the camera straight away: the browser's own
   * prompt appears as the page opens, the way a camera app does it, rather
   * than after a second tap. Not inside a frame that cannot have the camera,
   * where it would only fail; that case shows the own-tab option instead.
   */
  useEffect(() => {
    if (frameBlocksCamera) return;
    startCamera();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capture = useCallback(async () => {
    if (!handle.current) return;
    try {
      const blob = await handle.current.capture();
      setFlash(true);
      setTimeout(() => setFlash(false), 180);
      setShot((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { blob, url: URL.createObjectURL(blob) };
      });
    } catch (e) {
      setNotice((e as Error).message);
    }
  }, []);

  const flip = useCallback(async () => {
    try {
      await handle.current?.switchCamera();
    } catch {
      setNotice("Only one camera is available on this device.");
      setTimeout(() => setNotice(null), 2500);
    }
  }, []);

  const fileName = `netram-try-on-${category}-${wearingStudio ? "my-piece" : style.id}.jpg`;
  const share = useCallback(async () => {
    if (!shot) return;
    const file = new File([shot.blob], fileName, { type: "image/jpeg" });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: "My Netram try-on" }).catch(() => undefined);
    } else {
      await downloadBlob(shot.blob, fileName);
    }
  }, [shot, fileName]);

  const Guide = GUIDE_ICON[cat.tracker];
  const busy = status.phase === "camera" || status.phase === "models";
  const message =
    status.phase === "camera"
      ? "Starting camera…"
      : status.phase === "models"
        ? LOADING_TEXT[cat.tracker]
        : status.phase === "searching"
          ? (status.hint ?? cat.prompt)
          : status.phase === "tracking"
            ? status.hint
            : status.phase === "preview"
              ? "Drag to turn · scroll or pinch to zoom"
              : undefined;

  return (
    <main className="fixed inset-0 flex flex-col overflow-hidden bg-[#06050a] text-white lg:flex-row">
      {/* ---------------------------------------------------------- stage */}
      <section className="relative min-h-[55vh] flex-1 lg:min-h-0" aria-label="Try-on camera">
        {started ? (
          <Suspense fallback={<StageMessage icon={<Spinner />} text="Preparing try-on…" />}>
            <TryOnStage
              key={`${mode}-${attempt}`}
              config={config}
              mode={mode}
              onStatus={setStatus}
              handle={handle}
            />
          </Suspense>
        ) : (
          <Intro
            category={category}
            pieceName={wearingStudio ? prepared?.name : undefined}
            onStart={frameBlocksCamera ? openInOwnTab : startCamera}
            ownTab={frameBlocksCamera}
            onPreview={viewIn3D}
          />
        )}

        {started && status.phase === "searching" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Guide className="size-40 animate-pulse text-white/15" strokeWidth={0.8} />
          </div>
        )}

        {flash && <div className="pointer-events-none absolute inset-0 bg-white/70" />}

        {/* Top bar */}
        <header className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 pb-6 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-xs text-white/85 backdrop-blur hover:bg-black/60"
          >
            <ArrowLeft className="size-3.5" /> Studio
          </Link>
          <h1
            className="mx-auto text-lg tracking-wide text-white"
            style={{ fontFamily: "var(--font-serif-display)" }}
          >
            Netram <span className="text-[var(--gold)]">✦</span> Try-On
          </h1>
          {started && mode === "preview" ? (
            <button
              onClick={startCamera}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-black/40 px-3 text-xs text-white/85 backdrop-blur hover:bg-black/60"
              title="Try it on with your camera"
            >
              <Camera className="size-3.5" /> Camera
            </button>
          ) : started ? (
            <button
              onClick={flip}
              className="inline-flex size-9 items-center justify-center rounded-full bg-black/40 text-white/85 backdrop-blur hover:bg-black/60"
              title="Switch camera"
              aria-label="Switch camera"
            >
              <SwitchCamera className="size-4" />
            </button>
          ) : (
            <span className="size-9" />
          )}
        </header>

        {/* Status */}
        {started && message && status.phase !== "error" && (
          <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center px-4">
            <div className="flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-center text-xs text-white/90 backdrop-blur">
              {busy && <Spinner />}
              <span>{message}</span>
            </div>
          </div>
        )}

        {notice && (
          <div className="absolute inset-x-0 top-28 z-10 flex justify-center px-4">
            <div className="rounded-full bg-black/70 px-4 py-2 text-xs text-white/90">{notice}</div>
          </div>
        )}

        {started && status.phase === "error" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-6">
            <div className="max-w-sm rounded-2xl border border-white/10 bg-[#0c0a10] p-6 text-center">
              <Camera className="mx-auto mb-3 size-8 text-[var(--gold)]" />
              <p className="text-sm text-white/90">
                {frameMayBlockCamera
                  ? "The camera can't be used inside this window. Open the try-on in its own tab and your browser will ask for it."
                  : status.message}
              </p>
              {frameMayBlockCamera ? (
                <button
                  onClick={openInOwnTab}
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--gold)] px-5 py-2 text-sm font-medium text-[#16120c]"
                >
                  <Camera className="size-4" /> Open try-on in a new tab
                </button>
              ) : (
                <button
                  onClick={startCamera}
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--gold)] px-5 py-2 text-sm font-medium text-[#16120c]"
                >
                  <RotateCcw className="size-4" /> Try again
                </button>
              )}
              {embedded && !frameMayBlockCamera && (
                <button
                  onClick={openInOwnTab}
                  className="mt-3 block w-full text-xs text-white/60 underline-offset-4 hover:text-white hover:underline"
                >
                  Open the try-on in a new tab
                </button>
              )}
              <button
                onClick={viewIn3D}
                className="mt-3 block w-full text-xs text-white/60 underline-offset-4 hover:text-white hover:underline"
              >
                View the piece in 3D instead
              </button>
            </div>
          </div>
        )}

        {/* Shutter */}
        {started && status.phase !== "error" && (
          <button
            onClick={capture}
            disabled={!["tracking", "searching", "preview"].includes(status.phase)}
            className="absolute bottom-4 left-1/2 z-10 flex size-16 -translate-x-1/2 items-center justify-center rounded-full border-4 border-white/90 bg-white/20 backdrop-blur transition hover:bg-white/35 disabled:opacity-40"
            title="Take a photo"
            aria-label="Take a photo"
          >
            <span className="size-11 rounded-full bg-white" />
          </button>
        )}
      </section>

      {/* ----------------------------------------------------------- dock */}
      <nav
        className="z-10 max-h-[45vh] shrink-0 overflow-y-auto border-t border-white/10 bg-[#0c0a10] pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:max-h-none lg:w-[380px] lg:border-l lg:border-t-0 lg:pt-2"
        aria-label="Jewellery"
      >
        <div className="flex gap-1 overflow-x-auto px-3 pt-3 [scrollbar-width:none]">
          {CATEGORIES.map((c) => {
            const Icon = CATEGORY_ICON[c.id];
            const on = c.id === category;
            return (
              <button
                key={c.id}
                onClick={() => {
                  chosenCategory.current = true;
                  setCategory(c.id);
                }}
                aria-pressed={on}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs transition ${
                  on ? "bg-[var(--gold)] text-[#16120c]" : "text-white/70 hover:bg-white/5"
                }`}
              >
                <Icon className="size-3.5" /> {c.name}
              </button>
            );
          })}
        </div>

        {(preparing || studioError) && (
          <p className="flex items-center gap-2 px-3 pt-3 text-xs text-white/60" role="status">
            {preparing ? (
              <>
                <Spinner /> Preparing your piece from the studio…
              </>
            ) : (
              <>Your studio piece could not be loaded: {studioError}</>
            )}
          </p>
        )}

        <div className="flex gap-2 overflow-x-auto px-3 pt-3 [scrollbar-width:none]">
          {prepared && (
            /*
             * The piece from the studio, first and selected by default: it is
             * what the visitor came here to try on. Shown in every category,
             * since only they know whether their pendant is for the neck or
             * the ear; the fit adapts to whichever they pick.
             */
            <button
              onClick={() => setUseStudio(true)}
              aria-pressed={wearingStudio}
              title="The piece from the studio"
              className={`shrink-0 rounded-xl border px-3 py-2 text-left transition ${
                wearingStudio
                  ? "border-[var(--gold)] bg-white/5"
                  : "border-white/10 hover:border-white/25"
              }`}
            >
              <div className="text-xs font-medium text-white">Your piece</div>
              <div className="max-w-[11rem] truncate text-[10px] text-white/50">
                {prepared.name || "From the studio"}
              </div>
            </button>
          )}
          {cat.styles.map((s) => {
            const on = !wearingStudio && s.id === style.id;
            return (
              <button
                key={s.id}
                onClick={() => {
                  setUseStudio(false);
                  setStyles((m) => ({ ...m, [category]: s.id }));
                }}
                aria-pressed={on}
                title={s.blurb}
                className={`shrink-0 rounded-xl border px-3 py-2 text-left transition ${
                  on ? "border-[var(--gold)] bg-white/5" : "border-white/10 hover:border-white/25"
                }`}
              >
                <div className="text-xs font-medium text-white">{s.name}</div>
                <div className="max-w-[11rem] truncate text-[10px] text-white/50">{s.blurb}</div>
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 px-3 pt-3 sm:grid-cols-2 lg:grid-cols-1">
          <Field label="Metal" value={metalById(metalId)?.name}>
            <div className="flex gap-2">
              {TRYON_METALS.map((id) => {
                const m = metalById(id)!;
                return (
                  <Swatch
                    key={id}
                    on={id === metalId}
                    color={m.color}
                    label={m.name}
                    onClick={() => setMetalId(id)}
                    metal
                  />
                );
              })}
            </div>
          </Field>

          {showStone && (
            <Field label="Stone" value={gemById(gemId)?.name}>
              <div className="flex gap-2">
                {TRYON_GEMS.map((id) => {
                  const g = gemById(id)!;
                  return (
                    <Swatch
                      key={id}
                      on={id === gemId}
                      color={g.color}
                      label={g.name}
                      onClick={() => setGemId(id)}
                    />
                  );
                })}
              </div>
            </Field>
          )}

          {!wearingStudio && style.stone && (
            <Field label={style.stone.label} value={`${carat.toFixed(2)} ct`}>
              <input
                type="range"
                min={style.stone.min}
                max={style.stone.max}
                step={style.stone.step}
                value={carat}
                onChange={(e) => setCarats((m) => ({ ...m, [caratKey]: Number(e.target.value) }))}
                className="w-full accent-[var(--gold)]"
                aria-label={style.stone.label}
              />
            </Field>
          )}

          <Field label="Fit" value={`${Math.round(fit * 100)}%`}>
            <input
              type="range"
              min={0.8}
              max={1.2}
              step={0.01}
              value={fit}
              onChange={(e) => setFit(Number(e.target.value))}
              className="w-full accent-[var(--gold)]"
              aria-label="Fit adjustment"
            />
          </Field>

          {category === "ring" && (
            <Field label="Finger">
              <Segmented options={FINGER_OPTIONS} value={finger} onChange={setFinger} />
            </Field>
          )}

          {category === "necklace" && (wearingStudio ? studioChain : style.id !== "riviere") && (
            <Field label="Chain length">
              <Segmented options={CHAIN_OPTIONS} value={chain} onChange={setChain} />
            </Field>
          )}

          {showStone && (
            <Field label="Sparkle">
              <Segmented
                options={[
                  { id: "off", label: "Clean", hint: "Product-photo look" },
                  { id: "on", label: "Sparkle", hint: "Star glints on the brightest flashes" },
                ]}
                value={sparkle ? "on" : "off"}
                onChange={(v) => setSparkleChoice(v === "on")}
              />
            </Field>
          )}

          {started && mode === "preview" && (
            <Field label="Background" value={backdropById(backdrop).name}>
              <div className="flex gap-2">
                {BACKDROPS.map((b) => (
                  <Swatch
                    key={b.id}
                    on={b.id === backdrop}
                    color={b.swatch}
                    label={b.name}
                    onClick={() => setBackdrop(b.id)}
                  />
                ))}
              </div>
            </Field>
          )}
        </div>
        <p className="px-3 pt-2 text-[10px] text-white/35">
          Tracking runs on your device with Google MediaPipe. Your camera video is never uploaded.
        </p>
      </nav>

      {/* ------------------------------------------------------- snapshot */}
      {shot && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/85 p-4"
          role="dialog"
          aria-label="Your photo"
        >
          <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0c0a10]">
            <img src={shot.url} alt="Your try-on photo" className="min-h-0 flex-1 object-contain" />
            <div className="flex items-center justify-end gap-2 p-3">
              <button
                onClick={() => {
                  URL.revokeObjectURL(shot.url);
                  setShot(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm text-white/80 hover:bg-white/5"
              >
                <X className="size-4" /> Close
              </button>
              <button
                onClick={share}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/5"
              >
                <Share2 className="size-4" /> Share
              </button>
              <button
                onClick={() => downloadBlob(shot.blob, fileName)}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--gold)] px-4 py-2 text-sm font-medium text-[#16120c]"
              >
                <Download className="size-4" /> Save
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ bits */

function Spinner() {
  return <LoaderCircle className="size-3.5 animate-spin" />;
}

function StageMessage({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/70">
      {icon} {text}
    </div>
  );
}

function Intro({
  category,
  pieceName,
  onStart,
  ownTab,
  onPreview,
}: {
  category: Category;
  /** Set when the studio's own piece is the one being tried on. */
  pieceName?: string;
  onStart: () => void;
  /** Embedded where the camera is not allowed: the button opens a new tab. */
  ownTab?: boolean;
  onPreview: () => void;
}) {
  const Icon = CATEGORY_ICON[category];
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto px-6 pb-8 pt-16 text-center"
      style={{
        background:
          "radial-gradient(ellipse 60% 55% at 50% 40%, #241a0f 0%, #110d13 45%, #06050a 100%)",
      }}
    >
      <Icon className="mb-3 size-9 shrink-0 text-[var(--gold)]" strokeWidth={1.2} />
      <h2
        className="text-3xl text-white sm:text-5xl"
        style={{ fontFamily: "var(--font-serif-display)" }}
      >
        Virtual Try-On
      </h2>
      <p className="mt-2 max-w-md text-sm text-white/60">
        {pieceName !== undefined ? (
          <>
            Try <span className="text-white/85">{pieceName || "your piece"}</span> on live through
            your camera. Check where it should go below, then start.
          </>
        ) : (
          <>
            See brilliant-cut diamonds on your own hand, wrist, ears and neck, live through your
            camera. Pick a piece below, then start.
          </>
        )}
      </p>
      <button
        onClick={onStart}
        className="mt-6 inline-flex shrink-0 items-center gap-2 rounded-full bg-[var(--gold)] px-7 py-3 text-sm font-medium text-[#16120c] shadow-lg shadow-black/40 hover:brightness-110"
      >
        <Camera className="size-4" /> {ownTab ? "Open try-on in a new tab" : "Start camera"}
      </button>
      <button
        onClick={onPreview}
        className="mt-3 text-xs text-white/60 underline-offset-4 hover:text-white hover:underline"
      >
        No camera? View in 3D
      </button>
      <p className="mt-3 text-[11px] text-white/40">
        Everything runs on your device. Nothing is recorded or uploaded.
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between text-[10px] uppercase tracking-[0.14em] text-white/45">
        <span>{label}</span>
        {value && <span className="normal-case tracking-normal text-white/75">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function Swatch({
  on,
  color,
  label,
  onClick,
  metal,
}: {
  on: boolean;
  color: string;
  label: string;
  onClick: () => void;
  metal?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={on}
      className={`size-7 shrink-0 rounded-full ring-offset-2 ring-offset-[#0c0a10] transition ${
        on ? "ring-2 ring-[var(--gold)]" : "ring-1 ring-white/15 hover:ring-white/40"
      }`}
      style={{
        background: metal
          ? `linear-gradient(135deg, #fff8 0%, ${color} 35%, ${color} 60%, #0006 100%)`
          : `radial-gradient(circle at 35% 30%, #fff 0%, ${color} 45%, ${color} 70%, #0008 100%)`,
      }}
    />
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-full border border-white/10 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={o.id === value}
          title={o.hint}
          className={`flex-1 rounded-full px-2 py-1 text-[11px] transition ${
            o.id === value ? "bg-white/10 text-white" : "text-white/55 hover:text-white/80"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

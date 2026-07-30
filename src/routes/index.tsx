import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { finishes, type Finish } from "@/data/finishes";
import { products, type Product } from "@/data/products";
import { ControlTrigger } from "@/components/jewelry/ControlSheet";
import { StudioPanel } from "@/components/jewelry/StudioPanel";
import type { StudioApi } from "@/components/jewelry/StudioRig";
import { LoadingOverlay } from "@/components/jewelry/LoadingOverlay";
import { UploadPiece, type UploadStatus } from "@/components/jewelry/UploadPiece";
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
      { title: "Starlink Jewels — 3D Fine Jewelry Atelier" },
      {
        name: "description",
        content:
          "Explore Starlink Jewels in interactive 3D. Rotate each piece in 360° and switch between gold, platinum and silver finishes live.",
      },
      { property: "og:title", content: "Starlink Jewels — 3D Fine Jewelry Atelier" },
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
  const [autoRotate, setAutoRotate] = useState(true);
  const [rotateSpeed, setRotateSpeed] = useState(1);
  const [resetSignal, setResetSignal] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [upload, setUpload] = useState<UploadStatus | null>(null);
  const [uploadMsg, setUploadMsg] = useState<{ kind: "error" | "notice"; text: string } | null>(
    null,
  );
  const uploadRef = useRef<HTMLDivElement>(null);
  const studio = useRef<StudioApi | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) setAutoRotate(false);
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

  const handleUploaded = useCallback((p: Product) => {
    setProduct(p);
    setResetSignal((n) => n + 1);
    setLoaded(false);
    setShowUpload(false);
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

  return (
    <main className="stage" onPointerDown={() => setShowHint(false)}>
      {/* ── Floating header ─────────────────────────────────────── */}
      <header className="stage-top pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3">
        <div className={`pointer-events-auto min-w-0 ${embed ? "sr-only" : ""}`}>
          <h1 className="truncate font-serif text-xl tracking-wide sm:text-3xl">
            Starlink <span className="text-accent">✦</span> Jewels
          </h1>
          <p className="mt-0.5 truncate text-[0.5rem] uppercase tracking-[0.3em] text-muted-foreground sm:text-[0.58rem] sm:tracking-[0.36em]">
            Fine Jewelry · 3D Atelier
          </p>
        </div>

        {/* Upload trigger — top right, and only behind the passphrase. A
            client-facing link shows the piece it was given and nothing else, so
            a visitor cannot swap in a file of their own. Rendered conditionally
            rather than hidden, so it is absent from the page, not just unseen. */}
        {canUpload && (
          <div ref={uploadRef} className="pointer-events-auto relative">
            <button
              className="dock-btn"
              onClick={() => setShowUpload((v) => !v)}
              aria-label="Upload custom model"
              aria-expanded={showUpload}
              title="Upload your own .3dm / .glb"
            >
              <svg
                className="size-3.5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {/* Icon-only below sm so the brand keeps its room on narrow phones */}
              <span className="hidden sm:inline">Upload</span>
            </button>

            {showUpload && (
              <div className="upload-popover">
                <UploadPiece
                  onLoaded={handleUploaded}
                  onStatus={setUpload}
                  onResult={setUploadMsg}
                />
              </div>
            )}
          </div>
        )}
      </header>

      {/* ── Full-bleed 3D canvas ─────────────────────────────────── */}
      {/* touch-none stops the page panning/pull-to-refresh while orbiting */}
      <div className="absolute inset-0 touch-none">
        {mounted ? (
          <Suspense fallback={upload ? null : <LoadingOverlay />}>
            <Viewer
              product={product}
              finish={finish}
              autoRotate={autoRotate}
              rotateSpeed={rotateSpeed}
              resetSignal={resetSignal}
              hideLoader={upload !== null}
              onLoadedChange={onLoadedChange}
              studioRef={studio}
            />
          </Suspense>
        ) : (
          <LoadingOverlay />
        )}
      </div>

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

      {/* ── Bottom band: piece identity + the single control trigger ── */}
      <div className="stage-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3">
        <div
          className="min-w-0"
          style={{
            opacity: loaded ? 1 : 0,
            transform: loaded ? "translateY(0)" : "translateY(6px)",
            transition: "opacity 0.7s ease, transform 0.7s ease",
          }}
        >
          <h2 className="truncate font-serif text-lg tracking-wide sm:text-2xl">{product.name}</h2>
          <p className="mt-0.5 truncate text-[0.5rem] uppercase tracking-[0.28em] text-muted-foreground sm:text-[0.58rem] sm:tracking-[0.3em]">
            {product.ref}
          </p>
        </div>

        <div className="pointer-events-auto shrink-0">
          <ControlTrigger finish={finish} onClick={() => setShowControls(true)} />
        </div>
      </div>

      {showControls && (
        <>
          {/* Phones get a dismissable sheet; from lg up it docks as a sidebar,
              which is where a studio panel belongs when there is room. */}
          <div className="sheet-backdrop lg:hidden" onClick={closeControls} aria-hidden="true" />
          <div
            className="sheet studio-scroll max-lg:max-h-[85dvh] lg:studio-sidebar"
            role="dialog"
            aria-modal="true"
            aria-label="Studio"
          >
            <div className="sheet-grabber lg:hidden" aria-hidden="true" />
            <StudioPanel
              finish={finish}
              onSelectFinish={setFinish}
              autoRotate={autoRotate}
              onToggleRotate={() => setAutoRotate((v) => !v)}
              onReset={() => setResetSignal((n) => n + 1)}
              rotateSpeed={rotateSpeed}
              onRotateSpeed={setRotateSpeed}
              studio={studio}
              onBusyChange={setExporting}
              productRef={product.ref}
              onClose={closeControls}
            />
          </div>
        </>
      )}
    </main>
  );
}

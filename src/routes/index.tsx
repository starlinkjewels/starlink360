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

export const Route = createFileRoute("/")({
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

  return (
    <main className="stage" onPointerDown={() => setShowHint(false)}>
      {/* ── Floating header ─────────────────────────────────────── */}
      <header className="stage-top pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3">
        <div className="pointer-events-auto min-w-0">
          <h1 className="truncate font-serif text-xl tracking-wide sm:text-3xl">
            Starlink <span className="text-accent">✦</span> Jewels
          </h1>
          <p className="mt-0.5 truncate text-[0.5rem] uppercase tracking-[0.3em] text-muted-foreground sm:text-[0.58rem] sm:tracking-[0.36em]">
            Fine Jewelry · 3D Atelier
          </p>
        </div>

        {/* Upload trigger — top right */}
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
              <UploadPiece onLoaded={handleUploaded} onStatus={setUpload} onResult={setUploadMsg} />
            </div>
          )}
        </div>
      </header>

      {/* ── Full-bleed 3D canvas ─────────────────────────────────── */}
      {/* touch-none stops the page panning/pull-to-refresh while orbiting */}
      <div className="absolute inset-0 touch-none">
        {mounted ? (
          <Suspense fallback={<LoadingOverlay />}>
            <Viewer
              product={product}
              finish={finish}
              autoRotate={autoRotate}
              rotateSpeed={rotateSpeed}
              resetSignal={resetSignal}
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
          detail={`${upload.fileName} · ${(upload.fileBytes / 1048576).toFixed(1)} MB`}
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

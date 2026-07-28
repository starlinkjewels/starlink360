import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { Product } from "@/data/products";
import { loadJewelryFile, preloadDecoders, type LoadProgress } from "@/lib/loadJewelryFile";

export interface UploadStatus {
  progress: LoadProgress;
  fileName: string;
  fileBytes: number;
}

export function UploadPiece({
  onLoaded,
  onStatus,
  onResult,
}: {
  onLoaded: (p: Product) => void;
  /**
   * Reports upward so the stage owns the loading UI. A 240px popover is the
   * wrong place to watch a 20-second decode.
   */
  onStatus: (s: UploadStatus | null) => void;
  /**
   * Outcome message, surfaced by the page. The popover is closed by then, so a
   * message left in here would never be read.
   */
  onResult: (m: { kind: "error" | "notice"; text: string } | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  /**
   * iOS and Android resolve `accept` through their own type registries, and
   * `.3dm` is not a type either of them knows. The filter therefore greys out
   * every Rhino file in the picker and there is no way to select one. Drop the
   * filter on touch devices and validate the extension in JS instead — the
   * loader already rejects anything it cannot read, with a clear message.
   */
  const [filterPicker, setFilterPicker] = useState(true);
  useEffect(() => {
    setFilterPicker(!window.matchMedia("(pointer: coarse)").matches);
  }, []);

  // Prefetch decoder libs on idle so first upload is faster
  useEffect(() => {
    const id =
      typeof requestIdleCallback !== "undefined"
        ? requestIdleCallback(preloadDecoders, { timeout: 4000 })
        : (setTimeout(preloadDecoders, 2000) as unknown as number);
    return () => {
      if (typeof cancelIdleCallback !== "undefined") cancelIdleCallback(id);
      else clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    };
  }, []);

  async function handleFile(file: File) {
    setBusy(true);
    onResult(null);

    const report = (progress: LoadProgress) =>
      onStatus({ progress, fileName: file.name, fileBytes: file.size });

    report({ phase: "Reading file", percent: 4 });
    try {
      const object = await loadJewelryFile(file, report);
      // Parts Rhino saved without a render mesh can't be drawn — say so rather
      // than let the piece show up missing its band with no explanation.
      const notices = (object.userData as { notices?: string[] }).notices;
      if (notices?.length) onResult({ kind: "notice", text: notices.join(" ") });
      const base = file.name.replace(/\.[^.]+$/, "");
      onLoaded({
        id: `upload-${Date.now()}`,
        name: base.slice(0, 28) || "My Piece",
        ref: `Ref. ${base.slice(0, 10).toUpperCase()}`,
        glbUrl: "",
        description: `Uploaded ${file.name} · ${(file.size / 1048576).toFixed(1)} MB.`,
        object,
      });
    } catch (e) {
      onResult({
        kind: "error",
        text: e instanceof Error ? e.message : "Could not read that file.",
      });
    } finally {
      setBusy(false);
      onStatus(null);
    }
  }

  return (
    <div className="mt-3">
      <input
        ref={inputRef}
        type="file"
        accept={filterPicker ? ".3dm,.glb,.gltf,model/gltf-binary" : undefined}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void handleFile(f);
        }}
      />
      <button
        type="button"
        className="dock-btn w-full justify-center"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-3.5" aria-hidden="true" />
        Upload .3dm
      </button>

      <p className="mt-2 text-[0.6rem] leading-relaxed text-muted-foreground">
        .3dm, .glb or .gltf — decoded in your browser, nothing leaves your device.
      </p>
    </div>
  );
}

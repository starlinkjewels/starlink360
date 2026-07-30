import type * as THREE from "three";
import { loadJewelryFile, type LoadProgress } from "./loadJewelryFile";

/*
 * Loading a piece from a URL instead of a file picker.
 *
 * This is the integration path: a jewellery management system that already
 * stores .3dm files links to the viewer with `?file=<url>`, and the viewer
 * fetches and renders it. There is no backend involved — the browser fetches
 * the file and the existing worker decodes it, exactly as it does for an
 * upload, so this adds a download step and nothing else.
 *
 * Because the browser does the fetching, the file's own host controls access.
 * That is a feature: the viewer cannot be used to reach anything the visitor
 * could not already reach, so there is no request-forgery surface. It is also
 * the one thing that goes wrong in practice — a host that does not send CORS
 * headers blocks the read, and the browser deliberately hides why. Hence the
 * explicit message below rather than a bare "failed to fetch".
 */

/** Extensions the decoder understands, in the order a picker would list them. */
const SUPPORTED = ["3dm", "glb", "gltf"] as const;

export class RemoteLoadError extends Error {
  constructor(
    message: string,
    /** Shown under the headline message; usually what to do about it. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "RemoteLoadError";
  }
}

/**
 * Extracts a usable filename from a URL.
 *
 * `loadJewelryFile` dispatches on the extension, so this has to be right or a
 * .3dm gets handed to the glTF parser. Query strings are stripped first —
 * signed download links routinely end in `?X-Amz-Signature=...`.
 */
function fileNameFrom(url: URL, fallback: string): string {
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const decoded = (() => {
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  })();
  const ext = decoded.split(".").pop()?.toLowerCase();
  if (ext && (SUPPORTED as readonly string[]).includes(ext)) return decoded;

  /*
   * No usable extension in the path. Plenty of real download endpoints look
   * like `/api/files/8fa21c/download`, so fall back to the type the caller
   * declared rather than refusing outright.
   */
  return `${decoded.replace(/\.[^.]*$/, "") || "model"}.${fallback}`;
}

/** Rejects anything that is not a plain web URL. */
function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw, window.location.href);
  } catch {
    throw new RemoteLoadError("That model link is not a valid URL.", raw.slice(0, 120));
  }
  // Only http(s). Blocks javascript:, data: and file: reaching the fetch.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RemoteLoadError(
      "Model links must start with http:// or https://.",
      `Got "${url.protocol}"`,
    );
  }
  return url;
}

export interface RemoteJewelry {
  object: THREE.Group;
  fileName: string;
  bytes: number;
}

export interface RemoteLoadOptions {
  /** Assumed extension when the URL has none. */
  assumeType?: (typeof SUPPORTED)[number];
  /**
   * Name and size, as soon as each is known — first when the URL is parsed,
   * again once the response headers give a length.
   *
   * This exists so a caller never has to reach into the returned object from
   * inside `onProgress`. Writing
   *
   *   const { fileName, bytes } = await loadRemoteJewelry(url, {
   *     onProgress: () => show(fileName),   // <- fileName is not initialised yet
   *   });
   *
   * throws "Cannot access 'fileName' before initialization" on the very first
   * progress tick, because the destructuring on the left cannot complete until
   * the promise resolves. It is an easy mistake to make and a confusing one to
   * read once minified, so the information is pushed instead of pulled.
   */
  onMeta?: (info: { fileName: string; bytes: number }) => void;
  onProgress?: (p: LoadProgress) => void;
  signal?: AbortSignal;
}

/**
 * Fetches a model by URL and decodes it.
 *
 * Download is reported as 0-40% and decoding takes the rest, because on a big
 * .3dm over a phone connection the download really is a comparable share of the
 * wait, and a bar that sits at zero until the file lands reads as broken.
 */
export async function loadRemoteJewelry(
  raw: string,
  { assumeType = "3dm", onMeta, onProgress, signal }: RemoteLoadOptions = {},
): Promise<RemoteJewelry> {
  const url = parseUrl(raw);
  const fileName = fileNameFrom(url, assumeType);
  // Name first; the size is not known until the headers arrive.
  onMeta?.({ fileName, bytes: 0 });

  onProgress?.({ phase: "Fetching model", percent: 2 });

  let response: Response;
  try {
    response = await fetch(url.href, { signal, mode: "cors", credentials: "omit" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    /*
     * A cross-origin block and a dead host are the same TypeError here — the
     * browser will not say which, on purpose. CORS is overwhelmingly the cause
     * in an integration, so lead with it.
     */
    throw new RemoteLoadError(
      "The model could not be downloaded.",
      `${url.host} either is unreachable or does not allow this site to read its files. ` +
        `It needs to send the header "Access-Control-Allow-Origin".`,
    );
  }

  if (!response.ok) {
    throw new RemoteLoadError(
      `The model link returned ${response.status}.`,
      response.status === 404
        ? "The file may have been moved, or the link may have expired."
        : response.statusText || undefined,
    );
  }

  const declared = Number(response.headers.get("content-length")) || 0;
  onMeta?.({ fileName, bytes: declared });
  const buffer = await readWithProgress(response, declared, onProgress);

  if (buffer.byteLength === 0) {
    throw new RemoteLoadError("That model link returned an empty file.");
  }

  const file = new File([buffer], fileName);
  // Decoding owns 40-100%, so rescale what the decoder reports into that band.
  // A null percent means indeterminate and has to stay null, or the bar would
  // jump back to 40% every time the decoder hits a phase it cannot measure.
  const object = await loadJewelryFile(file, (p) =>
    onProgress?.({ phase: p.phase, percent: p.percent === null ? null : 40 + p.percent * 0.6 }),
  );

  return { object, fileName, bytes: buffer.byteLength };
}

/**
 * Streams the body so download progress is real rather than a guess.
 *
 * Falls back to `arrayBuffer()` where streaming is unavailable, and also when
 * the server sends no content-length — without a total there is no percentage
 * to report, so counting bytes would buy nothing.
 */
async function readWithProgress(
  response: Response,
  total: number,
  onProgress?: (p: LoadProgress) => void,
): Promise<ArrayBuffer> {
  if (!response.body || !total) {
    onProgress?.({ phase: "Downloading model", percent: 20 });
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress?.({
      phase: `Downloading model · ${(received / 1048576).toFixed(1)} of ${(total / 1048576).toFixed(1)} MB`,
      percent: 2 + Math.min(received / total, 1) * 38,
    });
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

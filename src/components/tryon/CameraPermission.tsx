import { useEffect, useRef } from "react";
import { Camera, CameraOff, Lock, ShieldCheck, Smartphone, X } from "lucide-react";

/*
 * The camera permission dialog: ours first, the browser's second.
 *
 * A browser asks for the camera once. A visitor who taps "Block" in that
 * prompt by reflex, before knowing why a jewellery site wants the camera,
 * is locked out until they dig through site settings. So the try-on says
 * what the camera is for and that nothing leaves the device, and only the
 * Allow button here triggers the browser's own prompt.
 *
 *  - "ask":     before the browser has been asked. Allow opens its prompt.
 *  - "blocked": the browser was told no, and will not ask again by itself.
 *               Explains how to switch it back on, for the device in hand.
 */
export type PermissionStep = "ask" | "blocked";

function platform(): "ios" | "android" | "desktop" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1))
    return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

const UNBLOCK_STEPS: Record<ReturnType<typeof platform>, string[]> = {
  desktop: [
    "Click the lock or camera icon at the left of the address bar.",
    "Set Camera to Allow.",
    "Come back here and press Try again.",
  ],
  android: [
    "Tap the lock icon at the left of the address bar, then Permissions.",
    "Turn Camera on.",
    "Come back here and press Try again.",
  ],
  ios: [
    "Tap aA at the left of the address bar, then Website Settings.",
    "Set Camera to Allow.",
    "Come back here and press Try again.",
  ],
};

export function CameraPermission({
  step,
  onAllow,
  onRetry,
  onClose,
  onPreview,
}: {
  step: PermissionStep;
  /** Allow pressed: start the camera, which shows the browser's prompt. */
  onAllow: () => void;
  /** Check again after the visitor has changed the setting. */
  onRetry: () => void;
  onClose: () => void;
  /** The way forward without a camera. */
  onPreview: () => void;
}) {
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, onClose]);

  const blocked = step === "blocked";
  const where = platform();

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-permission-title"
        className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0c0a10] p-6 text-white shadow-2xl"
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-full text-white/60 hover:bg-white/5 hover:text-white"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>

        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[var(--gold)]/15">
          {blocked ? (
            <CameraOff className="size-6 text-[var(--gold)]" />
          ) : (
            <Camera className="size-6 text-[var(--gold)]" />
          )}
        </div>

        <h2 id="camera-permission-title" className="text-center text-lg font-medium">
          {blocked ? "Camera access is blocked" : "Allow camera access"}
        </h2>

        {blocked ? (
          <>
            <p className="mt-2 text-center text-sm text-white/65">
              Your browser is set to block the camera for this site, so it won't ask again. To turn
              it back on:
            </p>
            <ol className="mt-4 space-y-2 text-sm text-white/80">
              {UNBLOCK_STEPS[where].map((text, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px]">
                    {i + 1}
                  </span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <p className="mt-2 text-center text-sm text-white/65">
              The try-on uses your camera to place the jewellery on your hand, ears or neck as you
              move.
            </p>
            <ul className="mt-4 space-y-2.5 text-sm text-white/80">
              <li className="flex gap-3">
                <Smartphone className="mt-0.5 size-4 shrink-0 text-[var(--gold)]" />
                Everything runs on this device.
              </li>
              <li className="flex gap-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--gold)]" />
                Nothing is recorded or uploaded.
              </li>
              <li className="flex gap-3">
                <Lock className="mt-0.5 size-4 shrink-0 text-[var(--gold)]" />
                The camera stops as soon as you leave the try-on.
              </li>
            </ul>
            <p className="mt-4 text-center text-xs text-white/45">
              Your browser will ask for permission next. Choose Allow.
            </p>
          </>
        )}

        <button
          ref={primary}
          onClick={blocked ? onRetry : onAllow}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--gold)] px-5 py-2.5 text-sm font-medium text-[#16120c] hover:brightness-110"
        >
          <Camera className="size-4" /> {blocked ? "Try again" : "Allow camera"}
        </button>
        <div className="mt-3 flex justify-center gap-4 text-xs">
          {!blocked && (
            <button onClick={onClose} className="text-white/60 hover:text-white">
              Not now
            </button>
          )}
          <button onClick={onPreview} className="text-white/60 hover:text-white">
            View in 3D instead
          </button>
        </div>
      </div>
    </div>
  );
}

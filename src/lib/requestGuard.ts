/*
 * Cheap guards for the one server endpoint that spends money: /api/chat.
 *
 * Every chat request is paid for on the Sarvam key, and the endpoint used to
 * accept any request from anywhere, of any size, as often as it came. These
 * three checks keep casual abuse off the bill. They do not make the endpoint
 * private: anything a browser can call, a script can call too.
 *
 *  - Same origin. A browser always sends `Origin` on a POST, and the viewer
 *    only ever calls its own server, even inside a partner's iframe (the
 *    iframe's page is ours). So a request from another site's page is
 *    refused. A script can forge the header; this stops other websites
 *    spending the key through their visitors, not a determined caller.
 *  - Size. Refused by `content-length` before the body is read.
 *  - Rate. A fixed window per client IP, held in memory. On Cloudflare each
 *    isolate keeps its own count and isolates come and go, so this is a
 *    speed bump, not a quota. For a hard limit, add a rate-limiting rule for
 *    /api/chat in the Cloudflare dashboard as well.
 *
 * Kept free of imports so the suite can compile it on its own.
 */

/** Whether a request came from a page served by this same host. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const from = new URL(origin).host;
    // Behind a proxy that rewrites Host (Replit, some preview hosts), the
    // public name arrives in x-forwarded-host instead. A caller could set it,
    // but a caller can set Origin too; see the note at the top.
    const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    return from === new URL(request.url).host || (!!forwarded && from === forwarded);
  } catch {
    return false;
  }
}

/** Whether the declared body size is over `maxBytes`. A missing or bad
 *  length is let through here; the schema still bounds what is parsed. */
export function isTooLarge(request: Request, maxBytes: number): boolean {
  const declared = Number(request.headers.get("content-length"));
  return Number.isFinite(declared) && declared > maxBytes;
}

/** The caller's IP as the platform reports it, or "unknown". */
export function clientKey(request: Request): string {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export interface RateLimiter {
  /** Counts one request for `key`. Returns how many seconds to wait, or 0
   *  if the request is allowed. */
  hit(key: string, now?: number): number;
}

export function createRateLimiter({
  limit,
  windowMs,
  maxKeys = 10_000,
}: {
  limit: number;
  windowMs: number;
  /** Past this many tracked clients, expired windows are swept out, so a
   *  flood of distinct IPs cannot grow the map without bound. */
  maxKeys?: number;
}): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();

  return {
    hit(key, now = Date.now()) {
      if (windows.size >= maxKeys) {
        for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
        // Every entry still live: drop the oldest rather than grow.
        if (windows.size >= maxKeys) {
          const oldest = windows.keys().next().value;
          if (oldest !== undefined) windows.delete(oldest);
        }
      }

      const w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return 0;
      }
      if (w.count >= limit) return Math.max(1, Math.ceil((w.start + windowMs - now) / 1000));
      w.count++;
      return 0;
    },
  };
}

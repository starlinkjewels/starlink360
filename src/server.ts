import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

/**
 * Lets the viewer be embedded in any site's iframe.
 *
 * Partner systems put the viewer in an iframe on their own domain, so framing
 * has to be allowed. Two headers are needed, not one:
 *
 *  - `X-Frame-Options` is the legacy control and has no wildcard — its only
 *    values are DENY and SAMEORIGIN, both of which break an embed. It must be
 *    absent, not permissive. Hosting platforms add it by default, so it is
 *    deleted here rather than merely left unset.
 *  - `frame-ancestors *` is the modern control and takes precedence where both
 *    are present. Stated explicitly so the intent survives a platform that adds
 *    a restrictive default.
 *
 * The exposure this accepts is clickjacking: another site can frame the viewer
 * and overlay it. That is tolerable because the viewer holds no session, no
 * credentials and no state worth stealing — there is no privileged action a
 * disguised click could trigger. If sign-in is ever added, this must become an
 * allowlist of partner origins.
 */
function allowEmbedding(response: Response): Response {
  // Headers on an opaque or already-sent response can be immutable, so clone
  // rather than assume a mutable instance.
  const headers = new Headers(response.headers);
  headers.delete("x-frame-options");
  if (!headers.has("content-security-policy")) {
    headers.set("content-security-policy", "frame-ancestors *");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return allowEmbedding(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { z } from "zod";
import {
  buildSystemPrompt,
  looksLikeBareProse,
  parseModelReply,
  type ChatReply,
} from "@/components/jewelry/chatProtocol";
import { MAX_CHAT_MESSAGES, MAX_MESSAGE_CHARS } from "@/components/jewelry/chatHistory";
import { clientKey, createRateLimiter, isSameOrigin, isTooLarge } from "@/lib/requestGuard";

/*
 * Proxies chat messages to Sarvam, so the API key never reaches the browser.
 *
 * `SARVAM_API_KEY` is read from `process.env` here — a server-only var,
 * never prefixed `VITE_` (that prefix is what gets a variable bundled into
 * client code; this one must never be). See .env.example.
 */

const RequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(MAX_MESSAGE_CHARS),
      }),
    )
    .min(1)
    // The client trims to this before sending (chatHistory.ts).
    .max(MAX_CHAT_MESSAGES),
  /** A one-line description of the piece's current state, built client-side
   *  (routes/index.tsx) from live app state — see `describeContext`. */
  context: z.string().max(2000).optional(),
});

const SARVAM_URL = "https://api.sarvam.ai/v1/chat/completions";

/*
 * Every request is paid for on the Sarvam key, so the endpoint refuses other
 * sites, oversized bodies and rapid repeats before any of it reaches Sarvam.
 * See lib/requestGuard.ts for what each of these does and does not stop.
 *
 * The body cap is the largest a valid request can be (every message at full
 * length, plus the context) with room for JSON escaping.
 */
const MAX_BODY_BYTES = 2 * (MAX_CHAT_MESSAGES * MAX_MESSAGE_CHARS + 2000) + 4096;
/** Generous for a person typing, far too slow for a script draining the key. */
const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

const FALLBACK_REPLY: ChatReply = {
  reply: "Sorry, I didn't quite follow that — could you try rephrasing?",
  actions: [],
};

type ChatCompletion = { choices?: { message?: { content?: string } }[] };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isSameOrigin(request)) {
          return json({ error: "Requests must come from this site." }, 403);
        }
        if (isTooLarge(request, MAX_BODY_BYTES)) {
          return json({ error: "That conversation is too long to send." }, 413);
        }
        const wait = limiter.hit(clientKey(request));
        if (wait > 0) {
          return new Response(
            JSON.stringify({
              error: `You're sending messages too quickly. Try again in ${wait} seconds.`,
            }),
            {
              status: 429,
              headers: { "content-type": "application/json", "retry-after": `${wait}` },
            },
          );
        }

        const apiKey = process.env.SARVAM_API_KEY;
        if (!apiKey) {
          return json({ error: "AI chat is not configured on this server." }, 500);
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Malformed request body." }, 400);
        }

        const parsedBody = RequestSchema.safeParse(body);
        if (!parsedBody.success) {
          return json({ error: "Malformed request body." }, 400);
        }

        const baseMessages = [
          { role: "system" as const, content: buildSystemPrompt() },
          ...(parsedBody.data.context
            ? [{ role: "system" as const, content: parsedBody.data.context }]
            : []),
          ...parsedBody.data.messages,
        ];

        const callSarvam = async (messages: typeof baseMessages) => {
          const res = await fetch(SARVAM_URL, {
            method: "POST",
            headers: {
              "api-subscription-key": apiKey,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: "sarvam-105b-conversations",
              messages,
              temperature: 0.2,
              max_tokens: 800,
            }),
          });
          if (!res.ok) throw new Error(`AI service returned ${res.status}.`);
          const data = (await res.json().catch(() => null)) as ChatCompletion | null;
          return data?.choices?.[0]?.message?.content;
        };

        let raw: string | undefined;
        try {
          raw = await callSarvam(baseMessages);
        } catch (e) {
          return json(
            { error: e instanceof Error ? e.message : "Could not reach the AI service." },
            502,
          );
        }
        if (!raw) return json(FALLBACK_REPLY);

        /*
         * The model sometimes drops the JSON format entirely and just
         * answers in plain prose — observed directly against the real API,
         * answering "make it normal again" with the correct plain sentence
         * "Done, the stones are back to Diamond." instead of the required
         * object. One retry, explicitly asking it to reformat the same
         * answer, recovers the action that prose alone can't carry; if the
         * retry ALSO comes back as prose, `parseModelReply`'s own fallback
         * still shows that text rather than a canned "I didn't understand."
         */
        if (looksLikeBareProse(raw)) {
          try {
            const retryRaw = await callSarvam([
              ...baseMessages,
              { role: "assistant" as const, content: raw },
              {
                role: "user" as const,
                content:
                  "Reformat your last answer as ONLY the required JSON object — no other text, same meaning.",
              },
            ]);
            if (retryRaw) raw = retryRaw;
          } catch {
            // Keep the original prose reply; parseModelReply below still
            // recovers it as plain text.
          }
        }

        const parsedReply = parseModelReply(raw);
        if (!parsedReply) console.error("[chat] unparseable model output:", raw);
        return json(parsedReply ?? FALLBACK_REPLY);
      },
    },
  },
});

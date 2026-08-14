import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { z } from "zod";
import {
  buildSystemPrompt,
  looksLikeBareProse,
  parseModelReply,
  type ChatReply,
} from "@/components/jewelry/chatProtocol";

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
        content: z.string(),
      }),
    )
    .min(1)
    .max(40),
  /** A one-line description of the piece's current state, built client-side
   *  (routes/index.tsx) from live app state — see `describeContext`. */
  context: z.string().max(2000).optional(),
});

const SARVAM_URL = "https://api.sarvam.ai/v1/chat/completions";

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

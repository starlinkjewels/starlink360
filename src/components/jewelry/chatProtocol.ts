import { z } from "zod";
import { GEMS, METALS } from "./library";
import { ENVIRONMENTS } from "./lighting";

/*
 * The AI chat's tool-calling layer.
 *
 * Sarvam's conversational model (sarvam-105b-conversations) has no
 * documented function-calling or JSON-mode support — unlike, say, recent
 * OpenAI/Anthropic models, there is no `tools` parameter to hand it and no
 * guarantee of a machine-parseable response shape. So the "tool calling" here
 * is hand-rolled: the system prompt instructs the model to always answer
 * with one JSON object of a fixed shape, and this file is what validates
 * that shape once it comes back. Every action is checked against the actual
 * library/lighting data below before it ever reaches a setter — a
 * hallucinated gem or environment name fails validation and never touches
 * the render, the same way a bad value from any other source would.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const ChatActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setStoneColor"), gem: z.string() }),
  z.object({ type: z.literal("setMetal"), metal: z.string() }),
  z.object({ type: z.literal("setEnvironment"), environment: z.string() }),
  z.object({ type: z.literal("setBackgroundColor"), hex: z.string() }),
  z.object({ type: z.literal("toggleBestLook") }),
  /*
   * "Make it normal/original again" had no action to map to before this —
   * the model would either invent something that failed validation, or (as
   * observed against the real API) drop the JSON format entirely and just
   * say what it would have done in plain prose, which this codebase then
   * had no way to actually apply. This is the fix for the capability gap,
   * not just the format one.
   */
  z.object({ type: z.literal("resetStones") }),
  z.object({ type: z.literal("resetMetal") }),
  z.object({ type: z.literal("setTheme"), theme: z.enum(["dark", "light"]) }),
  z.object({ type: z.literal("setShadowMode"), mode: z.enum(["contact", "directional"]) }),
  z.object({ type: z.literal("toggleGround"), enabled: z.boolean() }),
  z.object({ type: z.literal("setGroundStyle"), style: z.enum(["matte", "mirror"]) }),
  z.object({ type: z.literal("setBloom"), enabled: z.boolean() }),
  z.object({ type: z.literal("setExposure"), value: z.number() }),
  z.object({ type: z.literal("setEnvironmentRotation"), degrees: z.number() }),
  z.object({
    type: z.literal("setCameraProjection"),
    projection: z.enum(["perspective", "orthographic"]),
  }),
  z.object({ type: z.literal("setSpin"), enabled: z.boolean() }),
]);

export type ChatAction = z.infer<typeof ChatActionSchema>;

/** Action types that take no fields — the ones a model is prone to send as
 *  a bare string ("toggleBestLook") instead of an object. */
const NO_ARGUMENT_ACTIONS = new Set(["toggleBestLook", "resetStones", "resetMetal"]);

export interface ChatReply {
  reply: string;
  actions: ChatAction[];
}

/**
 * What the model is told it can do, spelled out with the exact ids this
 * build's library actually has — not a fixed list that could drift out of
 * sync with `library.ts`/`lighting.ts` as those grow.
 */
export function buildSystemPrompt(): string {
  const gemList = GEMS.map((g) => `${g.id} (${g.name})`).join(", ");
  const metalList = METALS.map((m) => `${m.id} (${m.name})`).join(", ");
  const envList = ENVIRONMENTS.map((e) => `${e.id} (${e.label} — ${e.hint})`).join(", ");

  return [
    "You are the assistant built into Starlink, a browser-based 3D jewelry viewer and studio.",
    "It renders a jewelry piece with real diamond refraction, live metal finishes, and a full lighting/camera/export studio, all client-side.",
    "You can answer questions about the app, and you can change what the viewer is showing by requesting actions.",
    "You will also be told the CURRENT state of the piece before the conversation — use it. If someone asks to turn something on that is already on, say so instead of guessing; if they ask to revert something, use the reset actions below rather than assuming a specific colour.",
    "",
    "Respond with ONLY a single JSON object, no markdown code fences, no text outside the JSON, EVEN for a short confirmation or a simple question. This is the one rule that matters most — never reply in plain prose. Its shape is exactly:",
    '{ "reply": "a short, natural sentence for the person", "actions": [ ...zero or more action objects... ] }',
    "",
    "Valid action objects:",
    `- { "type": "setStoneColor", "gem": "<id>" } — sets every stone on the piece to this gem. Valid ids: ${gemList}.`,
    `- { "type": "setMetal", "metal": "<id>" } — sets the piece's metal. Valid ids: ${metalList}.`,
    `- { "type": "setEnvironment", "environment": "<id>" } — sets the lighting/reflection environment. Valid ids: ${envList}.`,
    '- { "type": "setBackgroundColor", "hex": "#rrggbb" } — sets a solid backdrop colour.',
    '- { "type": "toggleBestLook" } — applies (or reverts, if already applied) the built-in "Best Look" preset: a real cast shadow, sparkle bloom, and a light theme. In the viewport itself this is a wand-icon button that sits beside the reset-view and fullscreen buttons, in the corner of the 3D view — NOT in the side panel. People often call it "the default settings", "the default button", or describe it by its position next to fullscreen/reset-view. ALL of those mean this action, not the reset actions below.',
    '- { "type": "resetStones" } — puts the stones back to the colour the file was loaded with, undoing a colour change. For "make it/them normal/original again", "undo the stone colour", "back to how it was" — about the STONES specifically, not about turning best-look on.',
    '- { "type": "resetMetal" } — the same, for the metal.',
    '- { "type": "setTheme", "theme": "dark" | "light" } — switches the whole app\'s interface (not the 3D scene) between dark and light mode.',
    '- { "type": "setShadowMode", "mode": "contact" | "directional" } — "contact" is the soft dark pool under the piece (the default, used in every render so far); "directional" is a real cast shadow with a visible outline of the piece on the ground. Use this for "cast a real shadow", "shadow direction", "make the shadow look real".',
    '- { "type": "toggleGround", "enabled": true | false } — shows or hides the ground/plinth surface under the piece.',
    '- { "type": "setGroundStyle", "style": "matte" | "mirror" } — the ground surface finish; "mirror" gives a reflective floor.',
    '- { "type": "setBloom", "enabled": true | false } — the sparkle/glow post-processing effect around bright highlights.',
    '- { "type": "setExposure", "value": <number 0.1-4> } — overall scene brightness. Higher is brighter. 1.4 is the default.',
    '- { "type": "setEnvironmentRotation", "degrees": <number 0-360> } — turns the lighting environment around the piece, which moves where reflections/highlights fall on the metal. "Rotate the lighting/environment/reflection" means this.',
    '- { "type": "setCameraProjection", "projection": "perspective" | "orthographic" } — the camera lens model. "Perspective" is normal 3D depth; "orthographic" removes perspective distortion (flat, technical-drawing look).',
    '- { "type": "setSpin", "enabled": true | false } — turns the piece\'s auto-rotation (turntable spin) on or off.',
    "",
    "Rules:",
    "- Use the exact id strings given above, never invent one, never translate or rephrase them.",
    '- If the person asks something you can answer without changing anything (a question about the app, or general conversation), set "actions" to an empty array and just answer in "reply".',
    '- If a request is genuinely ambiguous (e.g. a colour with no close gem match, or a number/setting you cannot confidently infer), say so in "reply", ask a short clarifying question, and leave "actions" empty rather than guessing.',
    '- The wording will often be casual, garbled, typo-laden, or use a synonym instead of the exact term above (e.g. "spin it", "turntable", "auto-rotate" all mean setSpin; "floor", "plinth", "base" all mean ground) — read for intent, not exact phrasing. If a sentence is too garbled to be confident, or could plausibly mean two different actions above, ask a short clarifying question in "reply" with empty "actions" rather than guessing. You always have the right to ask before acting — prefer asking over a wrong guess. Never invent a feature, control, or location (like a toggle \'in the side panel\') that isn\'t one of the actions listed above.',
    '- Keep "reply" short — one or two sentences, like a chat message, not a report.',
    '- Every entry in "actions" is always a JSON OBJECT with a "type" field, even for an action with nothing else to configure. Never write a bare action name as a plain string.',
    "",
    "Three full examples of a correct reply:",
    '{ "reply": "Done, the stones are ruby now.", "actions": [ { "type": "setStoneColor", "gem": "ruby" } ] }',
    '{ "reply": "Here\'s the best look.", "actions": [ { "type": "toggleBestLook" } ] }',
    '{ "reply": "Back to the original stones.", "actions": [ { "type": "resetStones" } ] }',
  ].join("\n");
}

/**
 * A one-line summary of what the piece currently looks like, so the model
 * is not reasoning blind. Built by the caller (routes/index.tsx), which is
 * the only place holding the live state and the library lookups needed to
 * turn an id into a name a person would recognise — this file only shapes
 * the sentence, it does not resolve anything itself.
 */
export function describeContext(input: {
  stone: string;
  metal: string;
  environment: string;
  background: string;
  bestLookOn: boolean;
  theme: "dark" | "light";
  shadowMode: "contact" | "directional";
  groundOn: boolean;
  groundStyle: "matte" | "mirror";
  bloomOn: boolean;
  exposure: number;
  environmentRotationDegrees: number;
  cameraProjection: "perspective" | "orthographic";
  spinOn: boolean;
}): string {
  return [
    `Current stone colour: ${input.stone}.`,
    `Current metal: ${input.metal}.`,
    `Current environment: ${input.environment}.`,
    `Current background: ${input.background}.`,
    `Best Look preset: ${input.bestLookOn ? "on" : "off"}.`,
    `App theme: ${input.theme}.`,
    `Shadow mode: ${input.shadowMode}.`,
    `Ground: ${input.groundOn ? `on, ${input.groundStyle} style` : "off"}.`,
    `Bloom/sparkle effect: ${input.bloomOn ? "on" : "off"}.`,
    `Exposure: ${input.exposure.toFixed(2)} (range 0.1-4).`,
    `Environment rotation: ${input.environmentRotationDegrees} degrees.`,
    `Camera projection: ${input.cameraProjection}.`,
    `Auto-rotate (spin): ${input.spinOn ? "on" : "off"}.`,
  ].join(" ");
}

/**
 * Pulls the JSON envelope out of the model's raw text and validates it.
 *
 * Models asked for "JSON only" still sometimes wrap it in a markdown fence or
 * add a stray word before/after — stripping fences and taking the first
 * `{...}` block handles the common cases without being so lenient that
 * genuinely malformed output silently passes.
 *
 * `reply` and each entry of `actions` are validated SEPARATELY rather than
 * the envelope as one all-or-nothing shape. Found necessary in practice: a
 * real response came back as
 * `{ "reply": "...(perfectly good text)...", "actions": ["toggleBestLook"] }`
 * — one action written as a bare string instead of `{ "type": ... }`. An
 * all-or-nothing schema threw the whole reply away over that single
 * malformed entry, turning a correct, helpful answer into "sorry, I didn't
 * follow that." Dropping only the one action that does not parse — while
 * still coercing the common bare-string shorthand for no-argument actions —
 * keeps the conversation working even when the model's JSON is imperfect.
 *
 * When there is no `{...}` at all, the model ignored the format entirely and
 * just talked — also observed in practice, answering "make it normal again"
 * with the plain sentence "Done, the stones are back to Diamond." instead of
 * JSON. The caller retries once when this happens (see routes/api/chat.ts),
 * but if even the retry comes back as prose, that prose is still a real,
 * usually-correct answer — showing it as the reply beats discarding it for
 * a canned "I didn't understand" that actively contradicts what the model
 * just said. It only ever carries text this way, never a guessed action.
 */
export function parseModelReply(raw: string): ChatReply | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  if (!stripped) return null;

  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return { reply: stripped, actions: [] };
  }

  // A brace exists, so this is an attempt at the format, not plain prose —
  // if it doesn't actually parse into the right shape, showing it as-is
  // would dump raw JSON text into the chat, which is worse than the canned
  // fallback message. `null` here, not the prose fallback.
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const replyValue = (parsed as Record<string, unknown>).reply;
  if (typeof replyValue !== "string") return null;

  const rawActions = (parsed as Record<string, unknown>).actions;
  const actions: ChatAction[] = [];
  if (Array.isArray(rawActions)) {
    for (const item of rawActions) {
      // "toggleBestLook" instead of { "type": "toggleBestLook" }.
      const candidate =
        typeof item === "string" && NO_ARGUMENT_ACTIONS.has(item) ? { type: item } : item;
      const result = ChatActionSchema.safeParse(candidate);
      if (result.success) actions.push(result.data);
    }
  }

  return { reply: replyValue, actions };
}

/** Whether the raw text has no JSON object in it at all — the signal
 *  routes/api/chat.ts uses to decide whether a reformat retry is worth it. */
export function looksLikeBareProse(raw: string): boolean {
  return !raw.includes("{") || !raw.includes("}");
}

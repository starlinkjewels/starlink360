/*
 * How much of the conversation goes to the server with each message.
 *
 * The server rejects a request with more than `MAX_CHAT_MESSAGES` messages
 * (routes/api/chat.ts), and the chat panel used to send its whole history
 * every time. So the 21st question of a session, the 41st message, always
 * came back as "Malformed request body." and every message after it failed
 * the same way. The assistant was dead until the page was reloaded.
 *
 * Only the most recent turns are sent now. The model loses the oldest part
 * of a very long chat, which is fine: the live state of the piece goes with
 * every request anyway (`describeContext`), so it never has to remember what
 * the stones were set to twenty messages ago.
 *
 * Kept free of imports so the suite can compile it on its own.
 */

/** The most messages one request may carry; shared by client and server. */
export const MAX_CHAT_MESSAGES = 40;

/**
 * The longest one message may be, in characters. The chat box stops typing
 * at `MAX_INPUT_CHARS`; the rest of the headroom is for the assistant's own
 * replies, which come back to the server as history (800 tokens is roughly
 * 3,000 characters).
 */
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_INPUT_CHARS = 1000;

/**
 * The last `max` messages, starting with a user message.
 *
 * A window cut at an even point can still begin on an assistant reply: a
 * failed request leaves a user message with no answer, so the history does
 * not always alternate. A reply with no question before it reads oddly to
 * the model, so any assistant messages at the start of the window are
 * dropped too.
 */
export function recentMessages<T extends { role: "user" | "assistant" }>(
  messages: readonly T[],
  max: number = MAX_CHAT_MESSAGES,
): T[] {
  const window = messages.slice(-Math.max(1, max));
  const firstUser = window.findIndex((m) => m.role === "user");
  return firstUser === -1 ? [] : window.slice(firstUser);
}

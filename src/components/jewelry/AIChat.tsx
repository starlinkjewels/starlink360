import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { ChatAction, ChatMessage } from "./chatProtocol";

/**
 * What a completed exchange with the assistant looks like on screen: the
 * text it actually said, plus whatever the app has to say back about any
 * action it tried (a hallucinated id, mainly) — kept separate from the
 * model's own words so one is never mistaken for the other.
 */
interface Exchange {
  role: "user" | "assistant";
  text: string;
  note?: string;
}

const GREETING =
  "Hi! Ask me to change a stone, the metal, the lighting, or the background — or ask me anything about this viewer.";

/** A literal, static className per role — never built by interpolating
 *  `h.role` into a template string. Tailwind's build only emits CSS for
 *  class names it can find written out somewhere in the source; a name
 *  assembled at runtime (`` `ai-chat-bubble-${role}` ``) never appears as
 *  literal text, so it silently gets no styles at all. This is exactly what
 *  was happening: every user bubble rendered with no background, no
 *  padding, no right alignment, because `ai-chat-bubble-user` doesn't exist
 *  anywhere in the file as a real string — only `ai-chat-bubble-assistant`
 *  does (in the greeting and the typing indicator below), which is why only
 *  assistant bubbles were ever styled. */
function bubbleClass(role: "user" | "assistant"): string {
  return role === "user"
    ? "ai-chat-bubble ai-chat-bubble-user"
    : "ai-chat-bubble ai-chat-bubble-assistant";
}

export function AIChat({
  onAction,
  context,
}: {
  /** Applies one action the model requested. Returns whether it actually
   *  matched something real, and an optional note to show if it did not. */
  onAction: (action: ChatAction) => { ok: boolean; note?: string };
  /** One line describing the piece's current state — see `describeContext`
   *  in chatProtocol.ts. Sent fresh with every message, not just once, since
   *  it can change between one message and the next. */
  context?: string;
}) {
  const [history, setHistory] = useState<Exchange[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, busy, error]);

  // Sending used to disable the input while waiting on the reply, and a
  // disabled element can't hold focus — the browser drops it, and nothing
  // ever gave it back. The input now stays enabled throughout (only the
  // send button and the Enter handler gate on `busy`), and this refocuses
  // it the moment a reply lands, so typing the next message needs no click.
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;

    setInput("");
    setError(null);
    const next = [...history, { role: "user" as const, text }];
    setHistory(next);
    setBusy(true);

    try {
      const messages: ChatMessage[] = next.map((h) => ({ role: h.role, content: h.text }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages, context }),
      });
      const data = (await res.json().catch(() => null)) as {
        reply?: string;
        actions?: ChatAction[];
        error?: string;
      } | null;

      if (!res.ok || !data || typeof data.reply !== "string") {
        setError(data?.error ?? "The assistant is unavailable right now.");
        setHistory(next);
        return;
      }

      const notes: string[] = [];
      for (const action of data.actions ?? []) {
        const result = onAction(action);
        if (!result.ok && result.note) notes.push(result.note);
      }

      setHistory([
        ...next,
        { role: "assistant", text: data.reply, note: notes.length ? notes.join(" ") : undefined },
      ]);
    } catch {
      setError("Could not reach the assistant — check your connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-log studio-scroll" ref={scrollRef}>
        <div className="ai-chat-bubble ai-chat-bubble-assistant">{GREETING}</div>
        {history.map((h, i) => (
          <div key={i} className={bubbleClass(h.role)}>
            {h.text}
            {h.note && <p className="ai-chat-note">{h.note}</p>}
          </div>
        ))}
        {busy && (
          <div
            className="ai-chat-bubble ai-chat-bubble-assistant ai-chat-typing"
            aria-label="Thinking"
          >
            <span className="ai-chat-dot" />
            <span className="ai-chat-dot" />
            <span className="ai-chat-dot" />
          </div>
        )}
        {error && <p className="ai-chat-error">{error}</p>}
      </div>

      <div className="ai-chat-input-row">
        <input
          ref={inputRef}
          className="ai-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Make the diamond blue…"
          aria-label="Message"
        />
        <button
          className="ai-chat-send"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          aria-label="Send"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}

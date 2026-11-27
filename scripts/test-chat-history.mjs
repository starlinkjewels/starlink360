/**
 * The chat's request window.
 *
 * The server refuses more than MAX_CHAT_MESSAGES messages, and the panel used
 * to send its whole history, so the chat died for good after about twenty
 * questions. These checks pin down that a request never goes over the cap,
 * however long the session runs, and that the window always opens on a
 * question the person asked.
 *
 * Usage: npm run test:chat
 */
import { MAX_CHAT_MESSAGES, recentMessages } from "../.tmp-jewelry/chatHistory.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

/** A session of `turns` questions, each answered. */
const session = (turns) =>
  Array.from({ length: turns }, (_, i) => [
    { role: "user", content: `q${i}` },
    { role: "assistant", content: `a${i}` },
  ]).flat();

// A short chat goes as it is.
{
  const msgs = [...session(3), { role: "user", content: "next" }];
  const out = recentMessages(msgs);
  check(
    out.length === msgs.length,
    "a short chat is sent whole",
    `${out.length} of ${msgs.length}`,
  );
}

// The exact case that used to fail: the 21st question is message 41.
{
  const msgs = [...session(20), { role: "user", content: "q20" }];
  check(msgs.length === 41, "the 21st question is the 41st message");
  const out = recentMessages(msgs);
  check(out.length <= MAX_CHAT_MESSAGES, "the 21st question fits under the cap", `${out.length}`);
  check(out.at(-1)?.content === "q20", "the newest question is always sent");
  check(out[0]?.role === "user", "the window opens on a question", out[0]?.content);
}

// However long the session runs, no request goes over the cap.
{
  let worst = 0;
  let allStartUser = true;
  for (let turns = 0; turns <= 200; turns++) {
    const out = recentMessages([...session(turns), { role: "user", content: "now" }]);
    worst = Math.max(worst, out.length);
    if (out[0]?.role !== "user") allStartUser = false;
  }
  check(worst <= MAX_CHAT_MESSAGES, "no session length goes over the cap", `largest ${worst}`);
  check(worst >= MAX_CHAT_MESSAGES - 1, "a long chat still uses the window", `largest ${worst}`);
  check(allStartUser, "every window opens on a question");
}

// A failed request leaves two questions in a row, so the history does not
// always alternate. A window that would open on a reply drops that reply.
{
  const msgs = [
    { role: "user", content: "lost" },
    ...session(19),
    { role: "assistant", content: "orphan" },
    { role: "user", content: "now" },
  ];
  const out = recentMessages(msgs, 4);
  check(
    out[0]?.role === "user",
    "an assistant reply at the window's edge is dropped",
    out[0]?.content,
  );
  check(out.at(-1)?.content === "now", "and the newest question survives it");
}

// Odd inputs.
check(recentMessages([]).length === 0, "an empty history sends nothing");
check(
  recentMessages([{ role: "assistant", content: "x" }]).length === 0,
  "a history with no question sends nothing",
);
check(
  recentMessages([{ role: "user", content: "x" }], 0).length === 1,
  "a cap of 0 still sends the newest question",
);

if (fail) {
  console.log(`\n  ${fail} check(s) failed`);
  process.exit(1);
}
console.log("\n  All checks passed");

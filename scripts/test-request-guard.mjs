/**
 * The guards in front of /api/chat.
 *
 * Every chat request is paid for on the Sarvam key. These checks pin down that
 * another site's page is refused, an oversized body is refused before it is
 * read, and a client sending too fast is told to wait, without a normal person
 * ever tripping any of it.
 *
 * Usage: npm run test:guard
 */
import {
  clientKey,
  createRateLimiter,
  isSameOrigin,
  isTooLarge,
} from "../.tmp-jewelry/requestGuard.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

const req = (headers = {}, url = "https://netram.example/api/chat") =>
  new Request(url, { method: "POST", headers });

// Origin.
check(isSameOrigin(req({ origin: "https://netram.example" })), "the site's own page is allowed");
check(!isSameOrigin(req({ origin: "https://evil.example" })), "another site's page is refused");
check(
  !isSameOrigin(req({ origin: "https://netram.example.evil.example" })),
  "a look-alike host is refused",
);
check(
  !isSameOrigin(req({ origin: "http://netram.example:8080" })),
  "the same name on another port is refused",
);
check(!isSameOrigin(req()), "a request with no Origin is refused");
check(!isSameOrigin(req({ origin: "null" })), "a sandboxed 'null' origin is refused");
check(
  isSameOrigin(req({ origin: "http://localhost:5000" }, "http://localhost:5000/api/chat")),
  "local development is allowed",
);

check(
  isSameOrigin(
    req(
      { origin: "https://netram.example", "x-forwarded-host": "netram.example" },
      "http://10.0.0.5:5000/api/chat",
    ),
  ),
  "behind a Host-rewriting proxy, the forwarded host is accepted",
);
check(
  !isSameOrigin(
    req(
      { origin: "https://evil.example", "x-forwarded-host": "netram.example" },
      "http://10.0.0.5:5000/api/chat",
    ),
  ),
  "but another site is still refused there",
);

// Size.
check(isTooLarge(req({ "content-length": "500001" }), 500000), "an oversized body is refused");
check(!isTooLarge(req({ "content-length": "500000" }), 500000), "a body at the cap is allowed");
check(!isTooLarge(req(), 500000), "a missing length is left to the schema");

// Client key.
check(clientKey(req({ "cf-connecting-ip": "1.2.3.4" })) === "1.2.3.4", "Cloudflare's IP is used");
check(
  clientKey(req({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" })) === "5.6.7.8",
  "the first forwarded IP is used",
);
check(clientKey(req()) === "unknown", "no IP header falls back to one shared bucket");

// Rate.
{
  const rl = createRateLimiter({ limit: 3, windowMs: 60_000 });
  const t = 1_000_000;
  const results = [rl.hit("a", t), rl.hit("a", t + 1), rl.hit("a", t + 2)];
  check(
    results.every((w) => w === 0),
    "requests under the limit pass",
    results.join(","),
  );
  const wait = rl.hit("a", t + 3);
  check(wait > 0 && wait <= 60, "the next one is told to wait", `${wait}s`);
  check(rl.hit("b", t + 3) === 0, "another client is not affected");
  check(rl.hit("a", t + 60_000) === 0, "the window resets after it ends");
}
{
  const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
  rl.hit("a", 0);
  check(rl.hit("a", 59_999) === 1, "the wait never rounds down to zero");
}
{
  // A flood of distinct clients cannot grow the map past its cap.
  const rl = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 });
  for (let i = 0; i < 1000; i++) rl.hit(`ip${i}`, i);
  check(rl.hit("ip999", 1000) > 0, "the newest client is still tracked after a flood");
  check(rl.hit("ip0", 1000) === 0, "the oldest were dropped to make room");
}

if (fail) {
  console.log(`\n  ${fail} check(s) failed`);
  process.exit(1);
}
console.log("\n  All checks passed");

/**
 * Post processing: what is on, what it costs, and when the chain must be rebuilt.
 *
 * The composer cannot be exercised without a GPU, so this checks the decisions
 * around it — which are where the bugs live. Two in particular:
 *
 *  - Some values are baked into a pass at construction. Updating those in place
 *    does nothing at all, so the control moves and the render does not. That is
 *    what `composerKey` exists to catch.
 *  - An effect that is switched off must cost nothing. "Enabled but zero
 *    strength" is the case that quietly builds a whole composer to draw
 *    nothing.
 *
 * Usage: node scripts/test-post.mjs
 */
import {
  DEFAULT_BLOOM,
  DEFAULT_DOF,
  DEFAULT_POST,
  DEFAULT_SSR,
  composerKey,
  postWarning,
  usesComposer,
} from "../.tmp-jewelry/bloom.js";

let fail = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

const withBloom = (patch) => ({ ...DEFAULT_POST, bloom: { ...DEFAULT_BLOOM, ...patch } });
const withDof = (patch) => ({ ...DEFAULT_POST, dof: { ...DEFAULT_DOF, ...patch } });
const withSsr = (patch) => ({ ...DEFAULT_POST, ssr: { ...DEFAULT_SSR, ...patch } });

console.log("=== everything is off by default ===");
check(!DEFAULT_BLOOM.enabled, "bloom is off");
check(!DEFAULT_DOF.enabled, "depth of field is off");
check(!DEFAULT_SSR.enabled, "SSR is off");
check(
  !usesComposer(DEFAULT_POST),
  "so no composer is built at all, and the render path stays a plain gl.render",
);
check(
  DEFAULT_BLOOM.resolutionX === 0 && DEFAULT_BLOOM.resolutionY === 0,
  "and bloom's buffer follows the renderer, exactly as it did before",
);

console.log("\n=== a composer exists only when something needs one ===");
check(usesComposer(withBloom({ enabled: true })), "bloom needs one");
check(usesComposer(withDof({ enabled: true })), "depth of field needs one");
check(usesComposer(withSsr({ enabled: true })), "SSR needs one");
/*
 * Enabled with zero strength draws nothing, so building the whole chain for it
 * is pure cost — a full extra render target and three passes to composite an
 * unchanged image.
 */
check(
  !usesComposer(withBloom({ enabled: true, strength: 0 })),
  "but bloom at zero strength does not — it would build a chain to change nothing",
);
check(
  usesComposer({
    ...withBloom({ enabled: true, strength: 0 }),
    dof: { ...DEFAULT_DOF, enabled: true },
  }),
  "though another effect still brings one back",
);

console.log("\n=== the chain is rebuilt only when its shape changes ===");
{
  const base = DEFAULT_POST;
  check(composerKey(base) === composerKey({ ...base }), "an identical setting is the same chain");

  // Live uniforms: these must NOT force a rebuild, or every slider drag would
  // tear down and recreate the whole pipeline.
  check(
    composerKey(base) === composerKey(withBloom({ strength: 2 })),
    "bloom strength is a uniform, not a rebuild",
  );
  check(
    composerKey(withDof({ enabled: true })) === composerKey(withDof({ enabled: true, focus: 9 })),
    "so is the focus distance",
  );
  check(
    composerKey(withSsr({ enabled: true })) ===
      composerKey(withSsr({ enabled: true, thickness: 0.5, opacity: 0.2, fresnel: false })),
    "and SSR's thickness, opacity and fresnel",
  );

  /*
   * Baked in at construction. Changing any of these in place silently does
   * nothing, which is the failure that looks like a broken control.
   */
  check(
    composerKey(base) !== composerKey(withBloom({ enabled: true })),
    "turning an effect on changes which passes exist",
  );
  check(
    composerKey(withBloom({ enabled: true })) !==
      composerKey(withBloom({ enabled: true, resolutionX: 512 })),
    "bloom's buffer size is baked in, so it needs a rebuild",
  );
  check(
    composerKey(withSsr({ enabled: true })) !==
      composerKey(withSsr({ enabled: true, bouncing: true })),
    "and so is SSR bouncing, which decides which render targets exist",
  );
  check(
    composerKey(withSsr({ enabled: true })) !==
      composerKey(withSsr({ enabled: true, width: 1024 })),
    "and its buffer size",
  );
}

console.log("\n=== the warnings are honest about the cost ===");
{
  check(postWarning(DEFAULT_POST) === null, "silence when nothing is on");

  /*
   * SSR is the one that will disappoint: it reads a depth buffer, and
   * transmissive materials do not write one usefully — on a piece that is
   * mostly diamonds the stones reflect wrongly or not at all. Saying so is the
   * difference between a considered choice and a bug report.
   */
  const ssr = postWarning(withSsr({ enabled: true }));
  check(
    !!ssr && /transmissive/.test(ssr),
    "SSR warns about exactly what it cannot do",
    ssr?.slice(0, 48),
  );

  const dof = postWarning(withDof({ enabled: true }));
  check(!!dof && /focus/.test(dof), "depth of field explains what the focus distance means");

  const both = postWarning({
    ...withDof({ enabled: true }),
    bloom: { ...DEFAULT_BLOOM, enabled: true },
  });
  check(!!both && /frame rate/.test(both), "two passes together warn about frame rate");

  // SSR's caveat outranks a general cost note: it is a correctness problem,
  // not a speed one.
  const all = {
    bloom: { ...DEFAULT_BLOOM, enabled: true },
    dof: { ...DEFAULT_DOF, enabled: true },
    ssr: { ...DEFAULT_SSR, enabled: true },
  };
  check(/transmissive/.test(postWarning(all)), "and SSR's caveat wins when everything is on");
}

console.log(fail === 0 ? "\n  All checks passed" : `\n  ${fail} FAILED`);
process.exit(fail ? 1 : 0);

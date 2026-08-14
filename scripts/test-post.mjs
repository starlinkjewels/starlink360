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
  DEFAULT_FILM,
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
const withFilm = (patch) => ({ ...DEFAULT_POST, film: { ...DEFAULT_FILM, ...patch } });

/*
 * Bloom is the exception, and deliberately so. On a jewellery viewer the halo
 * around a stone is not an effect to opt into, it is what makes the stone read
 * as a stone — a client compared the old flat dots against a competitor and
 * called them an obvious render. Everything else still costs nothing until it
 * is asked for.
 */
console.log("=== bloom is on, the rest is off ===");
check(DEFAULT_BLOOM.enabled, "bloom is on, because sparkle is the product");
check(
  DEFAULT_BLOOM.threshold > 0.9,
  "and kept honest by a high threshold, so metal does not glow",
  `${DEFAULT_BLOOM.threshold}`,
);
check(!DEFAULT_DOF.enabled, "depth of field is off");
check(!DEFAULT_SSR.enabled, "SSR is off");
check(
  usesComposer(DEFAULT_POST),
  "so a composer is built, which is what puts bloom on screen at all",
);
check(
  DEFAULT_BLOOM.resolutionX === 0 && DEFAULT_BLOOM.resolutionY === 0,
  "and bloom's buffer follows the renderer, exactly as it did before",
);

/*
 * Film — grain, vignette, lens aberration — is the other effect that is on by
 * default and for the same reason bloom is: without it the frame is a
 * mathematically clean image, which is not what any camera actually produces,
 * and that absence alone is enough to read a correct render as computed.
 */
console.log("\n=== film is on, subtly ===");
check(DEFAULT_FILM.enabled, "film is on — a frame with none of this reads as computed");
check(
  DEFAULT_FILM.grain > 0 && DEFAULT_FILM.grain < 0.1,
  "grain is present but subtle",
  `${DEFAULT_FILM.grain}`,
);
check(
  DEFAULT_FILM.vignette > 0 && DEFAULT_FILM.vignette < 0.6,
  "vignette darkens the corners without being obvious",
  `${DEFAULT_FILM.vignette}`,
);
check(
  DEFAULT_FILM.aberration >= 0 && DEFAULT_FILM.aberration < 0.5,
  "lens aberration is a hint of fringing, not a toy-camera effect",
  `${DEFAULT_FILM.aberration}`,
);

console.log("\n=== a composer exists only when something needs one ===");
check(usesComposer(withBloom({ enabled: true })), "bloom needs one");
check(usesComposer(withDof({ enabled: true })), "depth of field needs one");
check(usesComposer(withSsr({ enabled: true })), "SSR needs one");
check(usesComposer(withFilm({ enabled: true })), "film needs one too");
check(
  !usesComposer({
    ...withBloom({ enabled: false }),
    dof: { ...DEFAULT_DOF, enabled: false },
    ssr: { ...DEFAULT_SSR, enabled: false },
    film: { ...DEFAULT_FILM, enabled: false },
  }),
  "and none at all when every effect, film included, is off",
);
/*
 * Enabled with zero strength draws nothing, so building the whole chain for it
 * is pure cost — a full extra render target and three passes to composite an
 * unchanged image.
 */
check(
  !usesComposer({
    ...withBloom({ enabled: true, strength: 0 }),
    film: { ...DEFAULT_FILM, enabled: false },
  }),
  "but bloom at zero strength does not, on its own — it would build a chain to change nothing",
);
check(
  usesComposer({
    ...withBloom({ enabled: true, strength: 0 }),
    dof: { ...DEFAULT_DOF, enabled: true },
    film: { ...DEFAULT_FILM, enabled: false },
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
  check(
    composerKey(base) === composerKey(withFilm({ grain: 0.2, vignette: 0.9, aberration: 0.8 })),
    "and film's grain, vignette and aberration are uniforms too",
  );

  /*
   * Baked in at construction. Changing any of these in place silently does
   * nothing, which is the failure that looks like a broken control.
   */
  check(
    composerKey(base) !== composerKey(withBloom({ enabled: false })),
    "turning an effect off changes which passes exist",
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
  check(
    composerKey(base) !== composerKey(withFilm({ enabled: false })),
    "turning film off changes which passes exist too",
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

  /*
   * Bloom is turned off here on purpose. With it on — the default now — depth
   * of field is the second full-screen pass and the warning that matters is
   * the one about frame rate, which is checked above. The focus advice is what
   * a person sees when depth of field is the only pass they have added.
   */
  const dof = postWarning({
    ...withDof({ enabled: true }),
    bloom: { ...DEFAULT_BLOOM, enabled: false },
  });
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

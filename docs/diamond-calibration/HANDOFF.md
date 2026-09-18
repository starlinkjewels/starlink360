# Diamond rendering — handoff

Everything below is uncommitted work sitting on top of `f07f5e8`. Read this
before changing anything in the gem path; several values look arbitrary and are
not.

The goal was to make this app's centre stone look like the one in the Givara
ring builder (`~/personal/givara`), which the owner considers the reference.

---

## 1. Files changed

**Mine (this work):**

| file | what |
| --- | --- |
| `src/components/jewelry/GivaraGemMaterial.ts` | **new** — Givara's gem shader, ported verbatim. Traces a smoothed hull. |
| `src/components/jewelry/diamondNormalCapture.ts` | **new** — bakes the normal/distance cubemap that shader traces against. |
| `src/components/jewelry/GemTransportMaterial.ts` | **new earlier** — replaces drei's transport, keeps drei's BVH. Used for melee/pavé. |
| `src/components/jewelry/GemRefraction.tsx` | picks between the two materials; drops drei's 7 string patches. |
| `src/components/jewelry/diamondOptics.ts` | `geometryFactor` 0.15 → 0.7 |
| `src/components/jewelry/library.ts` | `DIAMOND_ABERRATION` — raised, then reverted to 0.001 |
| `src/components/jewelry/lighting.ts` | new `brilliance-hdri` environment; exposure, dynamic reflections |
| `src/lib/loadJewelryFile.ts` | smooth-normal capture fix |
| `src/styles.css` | light-theme `--stage-gradient` → Givara's ivory |
| `public/env/diamondenvironment.hdr` | **new** — the reference's own captured HDRI |

**NOT mine** — the owner had uncommitted work in ~9 other files before this
started (`StudioPanel`, `diamondSceneCapture`, `ground`, `materials`,
`DiamondPanel`, …). Those were committed in `f07f5e8` and were never touched
here.

---

## 2. Two gem materials now, chosen automatically

`GemRefraction.tsx` selects per mesh:

- **single solid** (`mesh.userData.solids` absent) → `GivaraGemMaterial`.
  Traces a cubemap baked from the stone's own centre. Only valid for one
  star-shaped solid.
- **merged group** (many solids) → `GemTransportMaterial`.
  Keeps `bvhIntersectFirstHit`. A pavé field of 200 stones shares one centre,
  so the hull cubemap would bake nonsense for it.

Verified live on SDAG076: centre stone → hull, the 12-solid and 56-solid groups
→ BVH.

---

## 3. Why the numbers are what they are

Do not "tidy" these without re-measuring.

| setting | value | why |
| --- | --- | --- |
| `DIAMOND_ABERRATION` | **0.001** | Raised to Givara's 0.005, then **reverted**. At this stone's facet size, 0.005/0.002/0.001 render near-identically; the owner's original 0.001 was correctly tuned for this geometry. |
| `GivaraGemMaterial` `envMapIntensity` | **1.35** | Givara uses 1.5. Givara tone maps the gem in post with in-material tone mapping off; here it happens in-material, so the same gain arrives hotter. At 1.5: mean 181.5, only 15.5% of stone below 140/255. At 1.35: 173.0 / 20.2%. Target 175.3 / 21.6%. |
| `useExtinctionFix` | **0** | Givara runs it at 1. It lifts near-zero pixels toward the environment so dead facets aren't black holes. Givara's stone is 338 tris so it rarely fires; this one is ~170 tris, the trace bottoms out over large areas, and the lift became a **uniform pale veil** — the reported "too white". |
| `geometryFactor` | **0.7** | Was 0.15, which was calibrated for drei's single-sample transport. `GemTransportMaterial` accumulates at every bounce so flat-normal divergence compounds. Only affects the **BVH path** (melee), not the hull. |
| `exposure` | **1** | Was 1.4. Givara uses 1.0; ACES at 1.4 flattens contrast through its shoulder. |
| `diamondDynamicReflections` | **false** | Givara has no scene capture. Measured: it softened the stone (σ 43.0 → 38.9). |
| `gemEnvironment` | `brilliance-hdri` | The reference's captured HDRI. The generated Diamond Studio environments are procedural — a gem mirrors its surroundings, and a generated shell of soft panels can only give soft reflections. |

---

## 4. Two real bugs found

**a) The environment was loading upside down.** drei's loader returns the HDR
with `flipY = true`; Givara's `RGBELoader` DataTexture has it clear. The
studio's ceiling was where its floor should be, so every facet read the wrong
half of the environment. Corrected in `GemRefraction.tsx` before the capture.

**b) Smooth normals were never smooth.** `loadJewelryFile.ts` only computed
them *if the file had no normals* — but a CAD stone always ships flat normals,
so `smoothNormal` was a copy of the flat normal and `diamondGeometryBlend`'s
`mix()` was mixing a normal with itself. **The shatter protection had never run
on any GLB.** Now recomputed unconditionally on the still-indexed geometry.

⚠️ That file is in the ingest path for *every* piece. **Run `npm run test:ingest`
and `npm run test:3dm` before committing** — I did not.

---

## 5. The open question

Stone measurements, interior only, gold excluded by hue:

| | mean | σ | dark ≤140 | deep ≤100 |
| --- | --- | --- | --- | --- |
| Givara (target) | 175.3 | 46.1 | 21.6% | 10.6% |
| here, at start | 230.9 | 17.0 | 0.1% | — |
| here, now | 173.0 | 44.5 | 20.2% | 7.7% |

The owner still reports the stone reads less natural — "more rainbow fire".
Dispersion is **not** the cause (three values look the same).

**Working hypothesis: facet density.** Givara's stone is 338 triangles; this
one is ~170. Larger facets each take one dispersed colour across their whole
area, so colour appears as *patches* rather than *glints*. No shader setting
adds facets.

**Unproven.** I tried loading Givara's stone GLB into this app to separate
renderer from geometry; it didn't render and I reverted it. That test is still
the way to settle it:

1. Put `Head_Hidden Halo_Oval_1.0ct_Diamond.glb` (from givara's
   `public/data/models_final/HEAD_final/Hidden Halo/Oval/1.0ct Hidden Halo/`)
   through this app's own Open/upload flow. If it renders like Givara, the
   renderer is right and the model is the limit.
2. Or test a re-cut SDAG076 centre stone at higher facet density.

---

## 6. Gotchas

- **Headless screenshots of this app are unreliable** — it frequently renders a
  blank canvas under Playwright even with a real GPU, with no console errors,
  and does so with drei's material too. It is not caused by these changes. A
  freshly started dev server plus a ~32s wait worked most often.
- **Aggregate pixel statistics repeatedly disagreed with the owner's eye**, and
  the eye was right every time. Mean saturation and blob-size metrics both said
  this stone had *less* colour than Givara's while it visibly looked worse.
  Judge by side-by-side crops; use numbers only as a secondary check.
- **Defaults vs saved sessions:** `gemEnvironment`, `exposure` and
  `diamondDynamicReflections` are defaults in `lighting.ts`. A restored project
  overrides them — "Reset Scene" to see the new values.
- **Backticks inside the GLSL template literals** silently terminate the string
  and produce confusing TS syntax errors. Bitten three times.

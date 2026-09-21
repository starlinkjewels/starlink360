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
| `GivaraGemMaterial` `envMapIntensity` | **1.5** | Givara's own value. It was 1.35 on the theory that this app tone maps in-material and so the same gain "arrives hotter" — **that theory was wrong**, see §7. |
| `useExtinctionFix` | **1** | Givara's own value. It was 0 because at a 256 capture the trace bottomed out over large areas and the lift became a pale veil. At the 1024 capture (§6) the trace rarely bottoms out, so it now fires only where it should and **lowers** zoomed edge noise 0.893 → 0.800. |
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

## 6. Hull capture resolution — why it is not a constant

Reported as "the diamond looks blurry when you zoom in". It is not blur: at
full zoom every facet edge broke into a visible **staircase**.

The hull cubemap's angular resolution is fixed when it is baked — 90°/size per
texel — but a stone's on-screen size is not, and `OrbitControls.minDistance`
here is `fit.radius * 0.12`. Past the crossover one texel covers several screen
pixels. The target is sampled with `NearestFilter`, correctly — interpolating
across a facet edge invents a normal belonging to neither facet — so the
quantisation shows up as ragged edges rather than a soft blur.

Givara never exposes this: it has fixed views and no free zoom.

Measured on the reference piece's 0.27-radius centre stone, at full zoom:

| capture | edge noise | staircase px |
| --- | --- | --- |
| 256 (was) | 1.150 | 0.12% |
| 512 | 0.969 | 0.07% |
| **1024** | **0.893** | **0.05%** |

512 was clearly better but still visibly stepped along the long facets; 1024
was clean.

`captureSizeForRadius()` now picks from the stone's **world** radius. Note the
geometry's own radius is useless for this — the same stone measured 7.17 in
geometry units and 0.27 once the node scale was applied, because a piece is
normalised by its transform, not by baking the scale into the geometry.

**The cache budget is in bytes, not entries.** 128 → 0.8 MB but 1024 → 50.3 MB,
so the old four-entry cap was either far too loose or far too tight depending
on which sizes landed in it. Eviction is LRU and **skips anything touched in
the last 5 s**, because freeing a texture a live material still points at is a
black stone, not a slow one; every capture for a piece is taken within one
build pass. If nothing is old enough to drop, the budget is allowed to
overshoot rather than break the render.

---

## 7. Parity audit — and one wrong assumption corrected

Asked to make this app's gem setup identical to Givara's, every surface was
diffed. `GivaraGemMaterial.ts` is now **byte-identical to Givara's
`GemMaterial.ts` apart from comments** — GLSL, presets and uniforms.

Everything else already matched, which was not obvious:

| surface | Givara | here |
| --- | --- | --- |
| renderer | `antialias: true`, dpr ≤ 2, ACES, exposure 1 | same |
| composer target | half-float, `samples: 4` | same (`bloom.ts`) |
| chain | RenderPass → … → OutputPass | same |
| gem HDRI | `diamondenvironment.hdr` | same |
| capture filter/type | Nearest, no mipmaps, half-float | same |

**The wrong assumption.** The 1.35 above was justified by "Givara tone maps in
post, here it happens in-material, so the gain arrives hotter". Three.js only
compiles in-material tone mapping when drawing **straight to the canvas** —
`WebGLPrograms` forces `NoToneMapping` whenever a render target is bound:

```js
if ( material.toneMapped ) {
  if ( currentRenderTarget === null || currentRenderTarget.isXRRenderTarget === true ) {
    toneMapping = renderer.toneMapping;
  }
}
```

`DEFAULT_FILM.enabled` and `DEFAULT_HIGHLIGHTS.enabled` are both `true`, so
`BloomRig`'s composer is always up and the gem is drawn into a render target.
ACES therefore arrives exactly once, from `OutputPass` — the same as Givara.
`hull.toneMapped = true` in `GemRefraction` is inert on that path; it is kept
only to cover a hypothetical direct-to-canvas render.

**What identical settings do NOT buy.** With Givara's exact numbers this stone
still reads brighter and flatter than Givara's, measured on the centre stone at
default framing:

| config | mean | sd | dark ≤140 | deep ≤100 | zoomed edge noise |
| --- | --- | --- | --- | --- | --- |
| env 1.35, ext 0 | 176.7 | 42.8 | 17.3% | 5.9% | 0.893 |
| env 1.50, ext 0 | 185.0 | 41.2 | 13.4% | 4.9% | 0.852 |
| env 1.35, ext 1 | 178.8 | 38.2 | 16.9% | 3.9% | 0.838 |
| **env 1.50, ext 1 (Givara)** | 186.8 | 36.7 | 13.0% | 2.8% | **0.800** |
| Givara's actual look | 175.3 | 46.1 | 21.6% | 10.6% | — |

Givara's values are kept: they are the requested parity *and* the lowest edge
noise. The residual gap is contrast (sd 36.7 vs 46.1), and it is **evidence for
the facet-density hypothesis in §5, not against parity**. The extinction fix is
the diagnostic: on a 338-triangle stone it fires rarely, so contrast survives
and no facet goes dead. On this ~170-triangle stone the trace bottoms out far
more, so the fix either fires widely (contrast drops) or is off (dead black
facets and edge speckle). Both symptoms have the same cause, and no shader
setting adds facets.

---

## 8. Gotchas

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

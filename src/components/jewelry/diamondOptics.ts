/**
 * Global diamond shader tuning, as opposed to per-stone optics (`library.ts`,
 * `GemOptics`) which vary by which gem is assigned to a part.
 *
 * These apply to every refractive stone regardless of which one it is —
 * bounces and fresnel are properties of the shader's approximation, not of a
 * particular gem — so they live here rather than in the material catalogue.
 *
 * Tried and reverted TWICE for the same underlying complaint ("muddy gray
 * facet" / soft internal gradients) — read both before attempting a third:
 *
 * - Phase 28 added a diamond-scoped midtone contrast stretch
 *   (`pivot + (x - pivot) * strength`, pre-knee). At the chosen values it
 *   produced large, artificial-looking pure-black triangular regions in
 *   production. Cause: the stretch is additive and unbounded — it keeps
 *   extrapolating darker below the pivot with no floor.
 * - Phase 29 replaced it with a Gaussian-weighted MULTIPLICATIVE gain
 *   (`x' = x * gain`, `gain` provably bounded to `[1-boost, 1+boost]`,
 *   `boost < 1` guaranteeing `gain > 0` for any input) specifically to fix
 *   that unbounded-additive flaw, verified mathematically bounded away from
 *   zero, checked in screenshots at full size/tight-crop/second-camera-angle
 *   with a measured darkest pixel of 39/255 (nothing near black) — and
 *   *still* shipped a result the user rejected as containing black
 *   triangular/shard regions. Reverted in full.
 *
 * The lesson from the second attempt: being mathematically bounded away
 * from a hard zero is not the same as being visually acceptable. A
 * "dark-gray" 39/255 in one specific screenshot's specific crop does not
 * mean every facet, under every camera angle/lighting condition, stays
 * that far from black — and more importantly, the user's own perception
 * of what counts as an unacceptable "black shard" was not the same as this
 * agent's. Before attempting a third pre-knee contrast-shaping mechanism,
 * get the user to confirm what "acceptable dark" looks like on an actual
 * candidate screenshot BEFORE shipping it as the default, not after.
 *
 * Phase 30 tried a different class of fix entirely — not tone-mapping the
 * existing value, but changing which environment DIRECTION an exhausted ray
 * samples. Traced `totalInternalReflection()` in the installed drei source:
 * a ray that fails to find a valid refraction within the `bounces` budget
 * falls through with no fallback of its own, using whatever direction
 * resulted from its last forced `reflect()` as if it were a genuine exit —
 * at `bounces: 2`, Phase 26/27 measured ~72% of the visible stone taking
 * this path. A patch (`diamondExitTransport.ts`, since deleted) blended
 * that raw direction toward a discriminant-clamped extension of Snell's law
 * (a physically motivated "grazing exit" reconstruction). Swept the blend
 * from 0 to 1 and checked known facet coordinates directly: a *known bright*
 * facet dropped from 242/255 to 102/255 at blend 0.5, while a *known dark*
 * facet jumped from 89/255 to 241/255 at blend 0.25 and stayed there. The
 * mechanism doesn't clean up the exhausted-ray fallback — it reshuffles
 * which part of the environment each exhausted facet happens to sample,
 * with no correlation to whether that facet "should" read bright or dark.
 * Reverted in full; no blend value passed the visual gate. The lesson: not
 * every remaining defect in this shader is reachable by changing WHERE a
 * ray samples, or WHAT value gets tone-mapped — some may require change
 * outside this file's scope entirely (the environment's own directional
 * resolution, or the geometry/BVH itself), which this phase did not
 * attempt.
 *
 * Phase 31 ran a genuinely different diagnostic first: swapped the gem's
 * material at runtime for a plain multi-light Blinn-Phong shader on the
 * SAME geometry/normals (diffuse-dominated → nearly uniform flat white;
 * pure specular → nearly all black with a few pinpoint highlights — neither
 * resembled the reference), then for a plain `reflect(view, normal)` sample
 * of the actual environment cube map, which DID show real, coherent
 * facet-to-facet variation — evidence the geometry/normals are capable, and
 * the refraction/TIR transport is what flattens that capability. Built the
 * evidence-backed hybrid this pointed to: a small additive
 * `weight * luminance(reflect(view,normal) sampled against envMap)` term on
 * top of the existing refracted colour (`diamondFacetReflection.ts`, since
 * deleted) — achromatic, no touch to ray direction/dispersion. Swept
 * `weight` from 0.001 to 0.1. At the production camera it looked
 * ambiguous — some facets gained apparent differentiation, others in the
 * same crop looked softer. At a second, independent camera angle the
 * verdict was unambiguous: a large, well-defined dark facet plane
 * (present and correct at weight 0) was visibly washed toward flat
 * mid-grey by weight 0.02, and further washed out by weight 0.04 — this is
 * the exact "broad per-facet brightness, not localized sparkle" failure
 * already on record from an earlier phase's reflected-environment attempt,
 * now independently reconfirmed with a different formulation and direct
 * two-camera evidence. Reverted in full. The lesson: the environment's raw
 * reflected luminance has enough dynamic range that even a very small
 * additive weight can dominate a facet whose reflection direction happens
 * to hit a bright region of the environment — "small weight" alone does
 * not make an additive environment term safe, because the environment
 * itself, not the weight, is what's unbounded.
 */
export interface DiamondOpticsSettings {
  /**
   * Bounces of total internal reflection, per traced ray.
   *
   * Raised to 6 on the theory that more traced internal path means more
   * brilliance. Visually calibrated against a real market reference render on
   * `SD AG 076` and disproven: 6 (and worse, 8) reads as a busy, fragmented
   * "shattered glass" surface next to the reference's clean, smooth facet
   * planes, and the effect was monotonic going up — checked at 3/4/5/6/8,
   * each step up gets busier, none closer to the target — which is what made
   * 3 the closest match found at the time.
   *
   * That sweep never checked below 3. Once the diamond's environment and
   * dispersion were separately fixed, the same "shattered glass" symptom was
   * still visible at 3 — many small, independently-sampled facets reading as
   * disconnected shards rather than one coherent stone, next to the
   * reference's much larger, cleaner facet planes. The trend from the
   * original sweep continued downward: 2 produces visibly larger, more
   * coherent facet regions much closer to the reference's structure; 1 goes
   * too far and starts losing the faceted-cut read entirely, reading almost
   * as a smooth dome. 2 is the new closest match, confirmed at a second,
   * unrelated camera angle so it isn't a one-viewpoint artifact.
   */
  bounces: number;
  /**
   * Scales `gemFresnel`'s edge-brightening. At 1.0 every grazing facet blends
   * fully to white; lowered so the stone keeps facet contrast at the edges
   * instead of reading as glass everywhere the view angle turns shallow.
   * Re-checked at 0.4 and 0.75 alongside the `bounces` investigation above —
   * neither moved the diamond's overall facet-coherence problem either way,
   * only the girdle's own edge brightness. 0.6 stands.
   */
  fresnelScale: number;
  /**
   * Selects the shader's cheap per-channel dispersion approximation
   * (`FAST_CHROMA`) instead of tracing red/blue separately. This is a
   * compile-time `#define`, not a uniform, so toggling it recompiles every
   * stone's shader program — expect a brief stall, not a live update.
   */
  fastChroma: boolean;
  /**
   * A power curve on the raw environment sample, applied before it enters
   * `diffuseColor` — see `diamondEnvResponse.ts`.
   *
   * Phase 20 read drei's actual compiled shader end to end and confirmed
   * there is no true surface-reflection term: the only thing standing in for
   * "the stone catching light" is `mix(diffuseColor.rgb, vec3(1.0), nFresnel)`
   * (`MeshRefractionMaterial.js`), and a direct grayscale visualization of
   * `nFresnel` on this model showed it is genuinely zero across the entire
   * visible stone except a thin line at the girdle silhouette — confirmed
   * numerically (sampled pixels all exactly (0,0,0)), not just by eye.
   * Scaling that contribution from 0% to 100% moved nothing but that thin
   * edge line, so the "too much gray" complaint cannot be a Fresnel problem
   * on this piece: essentially the entire visible diamond is the raw
   * refracted-environment sample, unmodified by any reflection term.
   *
   * That sample reaches the screen with no tone-adjustment of its own before
   * ACES's tonemapping `saturate()` — and the studio environment's raw HDR
   * values run "well above 50" (`gemAbsorption.ts`), far past where ACES's
   * filmic curve has already flattened toward white. Many different bright
   * facet values were converging on the same near-white output there, which
   * reads as broad, same-toned gray/white regions rather than distinct
   * bright-vs-dark facets. Exponent 1.0 is drei's untouched default (a
   * 1.0/1.1/1.2/1.3/1.4 sweep confirmed it as a no-op: <1/255 difference from
   * the original at exactly 1.0). Raising it pulls bright samples down before
   * they hit that wall, spreading them back out: 1.1 and 1.2 both showed a
   * real, repeatable increase in facet-to-facet contrast against the market
   * reference, confirmed at a second, unrelated camera angle; 1.3 and 1.4
   * overshot, pushing enough facets into shadow to look artificially dark
   * next to the reference's actual dark/light balance. 1.2 is the current
   * best match.
   *
   * Raised 1.2 -> 1.8 after `CRISP_PANELS` was rebuilt around
   * `buildStudioArray` (~80 procedural panels — see `lighting.ts`) and the
   * user supplied real reference screenshots from a separate renderer.
   * Those references were NOT softly graduated the way this session had
   * been tuning toward — they were bold and graphic, individual facets
   * reading as cleanly bright-white or clearly dark, sharply bounded, with
   * comparatively little middle gray. The dense panel array had already
   * fixed the actual structural problem (facets merging into one
   * undifferentiated blob), but the softened tone curve built on top of it
   * (feather, lowered shell ceiling, gentler exponent) was pulling every
   * facet's already-distinct value back toward a narrow middle band —
   * correct instinct, wrong direction once the environment itself had
   * enough real per-facet variety. Raising the exponent pushes each
   * facet's OWN distinct value further from the middle in both
   * directions — already-dark facets read more clearly dark (dark<90
   * population: 0.48% -> 13.89%, matching the reference's real dark
   * regions instead of nearly none), already-bright facets stay bright,
   * without touching how many DISTINCT facets there are (that's the
   * panel array's job, not this exponent's). Confirmed at a second camera
   * angle, gold/pave pixel-identical, fire within noise (2.23% -> 2.63%).
   */
  envResponseExponent: number;
  /**
   * Pre-ACES HDR compression threshold — see `gemHdrKnee.ts`.
   *
   * Phase 24 measured the diamond's actual pre-tonemap HDR values at six
   * representative facets and found genuine, large brightness separation
   * (dark ≈0.07, mid ≈0.75, bright ≈12–19) that was fully intact right up
   * to ACES's own tonemapping stage — confirmed independently in Phase 25
   * from fresh HALF_FLOAT readback, not assumed. The loss happens inside
   * ACES itself: its filmic curve is so flat above roughly raw 2–3 that two
   * genuinely different bright facets (measured ≈12 and ≈19, a real 58%
   * difference) both land at exactly 1.0 — indistinguishable pure white.
   *
   * Below this threshold, values pass through completely unchanged — dark
   * and mid-tone facets are untouched, verified via the same six-facet
   * measurement showing bit-identical values below the knee. Only the
   * excess above the threshold is compressed (see `uKneeStrength`), pulling
   * bright facets down into ACES's steeper, more differentiating range
   * instead of its flat near-1.0 shoulder.
   *
   * 0.8 was chosen after testing a family of thresholds (2.0, 1.5, 1.0, 0.8,
   * 0.6): 2.0 and 1.5 left compressed values still deep enough in ACES's
   * flat zone to be visually imperceptible; 0.6 started reading as slightly
   * duller/less bright overall. 0.8 was the point where genuine, visible
   * facet-to-facet contrast first appeared without a perceptible loss of
   * overall white brilliance, confirmed at a second, unrelated camera angle.
   */
  kneeThreshold: number;
  /**
   * Compression strength for the excess above `kneeThreshold` — see
   * `gemHdrKnee.ts`, a Reinhard-style `excess/(1+k*excess)`. At 0 this is an
   * exact identity (no compression at all, not merely an approximation of
   * one). Applied identically to R, G, and B, so it cannot shift hue or
   * introduce colour on its own — verified: the fire-prone facet region's
   * own colour-channel spread was *lower* with this enabled than in the
   * untouched baseline, not higher.
   *
   * Worth recording honestly: this curve family has a real, known limitation
   * — it has a hard asymptote (ceiling = kneeThreshold + 1/kneeStrength), so
   * any two SUFFICIENTLY bright values get pulled toward the same ceiling as
   * strength rises. That limitation turned out to be exactly the cause of a
   * later "too gray, not enough sparkle" complaint at strength 1.0 (ceiling
   * 1.8) — a dense HALF_FLOAT grid readback of the actual gem mesh (isolated
   * from metal/pavé, which are not knee-limited and would otherwise
   * contaminate the numbers) found 31%+ of the visible stone's raw,
   * exponent-shaped samples above 1.5, spanning raw ≈1.5 up to ≈25 — but at
   * strength 1.0 the post-knee p90/p99/max were 1.72/1.76/1.76: essentially
   * every one of those genuinely different bright facets was being pulled
   * within 2% of the same ceiling before it ever reached ACES, so a facet
   * that should read as a sharp white flash and one that was merely
   * decently lit became visually indistinguishable — read as one flat
   * bright plateau rather than localized sparkle. Confirmed in the actual
   * 8-bit screenshot: at strength 1.0, only 0.05% of the stone's sampled
   * pixels landed in a genuine 245-255 "flash white" band, versus 50.18% in
   * the next band down (225-245) — a big flat shelf, no pop. Lowering
   * strength to 0.7 and 0.5 (raising the ceiling to 2.23 / 2.8) was tested
   * directly in the running app: at 0.5, the flash band grew to 30.45% and
   * the 225-245 shelf shrank to 19.91%, while the dark (<90) and medium
   * (90-180) populations were UNCHANGED to two decimal places (0.98% /
   * 39.7ish% at every strength tested) — confirming the fix redistributes
   * only within the already-bright population, never touches the dark/mid
   * facets that give the stone its crystalline depth. Confirmed at a
   * second, independent camera angle, and fire prevalence (colour-channel
   * spread >40/255) was unchanged (2.63% -> 2.64%, noise-level), consistent
   * with this curve being applied identically to R/G/B. A
   * non-asymptotic (e.g. logarithmic) curve was considered as a longer-term
   * fix for the extreme-outlier case specifically, but was not implemented
   * — 0.5 already cleared the actual visual gate.
   *
   * Partially walked back 0.5 -> 0.75 in a later pass, after the 0.5
   * setting (combined with an increasingly large set of aimed environment
   * panels — see `lighting.ts`'s `CRISP_PANELS`) was found to overshoot in
   * a different direction: 63% of the stone's sampled pixels had been
   * pushed into the 245-255 flash band, versus only 7% in the 180-225
   * "light gray" band — so many genuinely different facets were being
   * compressed toward the same near-white ceiling that ADJACENT bright
   * facets stopped reading as visually distinct from each other, which is
   * what a "blended, not sharp, looks CGI" complaint turned out to mean in
   * practice, not a resolution or antialiasing issue. 0.75 (ceiling ~2.13)
   * cut the flash band roughly in half without touching the dark/black
   * facets that already read correctly. See the shell-stops comment in
   * `lighting.ts` for the other, larger half of this same fix.
   *
   * Re-tested (both threshold and strength) after `CRISP_PANELS` was
   * rebuilt around `buildStudioArray` (~80 procedural panels instead of a
   * hand-aimed handful) and found NOT to be the effective lever for that
   * change: swinging strength from 0.75 up to 1.4, and threshold from 0.8
   * down to 0.45, barely moved the brightish+flash population (stayed
   * ~78-80% throughout). The actual fix for that round was upstream, in
   * the raw panel brightness itself — see `buildStudioArray`'s and
   * `diamond-studio-crisp`'s own comments in `lighting.ts`. Left at 0.8 /
   * 0.75 (unchanged) once that was clear.
   */
  kneeStrength: number;
}

export const DEFAULT_DIAMOND_OPTICS: DiamondOpticsSettings = {
  bounces: 2,
  fresnelScale: 0.6,
  fastChroma: false,
  envResponseExponent: 1.8,
  kneeThreshold: 0.8,
  kneeStrength: 0.75,
};

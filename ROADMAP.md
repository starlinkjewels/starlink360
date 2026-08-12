# Roadmap — closing the gap to TiaraRender

15 features pending, grouped into 7 phases.

Phases are grouped by **the panel section and subsystem they touch**, not by how
the competitor lists them. That is deliberate: a phase that lands in one section
is one coherent change, one set of tests, and one thing to review. Cherry-picking
features across sections means touching the same files five times and re-testing
the same paths five times.

Each phase is independently shippable. Nothing here needs a backend.

## The three constraints that shape every decision

1. **No GPU on the render box, no backend.** Everything runs in the visitor's
   browser. This rules out path tracing and makes every per-frame pass expensive.
2. **60% of traffic is mobile.** Any feature that adds a full-screen pass has to
   be optional and default off on low-end devices.
3. **The current look is signed off.** New looks are added as _options_. Nothing
   replaces the default without being asked for — that lesson cost eight reverts.

## Order at a glance

| Phase                    | Features        | Size | Risk     | Why here                                             |
| ------------------------ | --------------- | ---- | -------- | ---------------------------------------------------- |
| 1 · Camera ✅ **done**   | #10, #11, #12   | S    | Low      | Safe, fast, immediately reads as professional        |
| 2 · Lighting ✅ **done** | #4, #6, #7      | M    | Med      | Biggest lever on how the diamonds look               |
| 3 · Ground               | #8, #13         | M    | Med-high | Biggest lever on "product shot" presentation         |
| 4 · Export & branding    | #18, #19, #20   | M    | Low-med  | Watermark is trivial and commercially useful         |
| 5 · Post-processing      | #9 (bloom only) | S    | High     | Needs measurement before it ships                    |
| 6 · Import & inspection  | #1, #2          | M    | Med      | Widens the funnel; #2 is nearly free                 |
| 7 · Surface textures     | #5              | L    | Med      | Asset-heavy, and depends on Phase 6's selection work |

---

## Phase 1 · Camera — DONE

**Features:** #10 object rotation · #11 camera XYZ, FOV, clipping planes ·
#12 orthographic projection

New **Camera** section in the panel. Numeric position on X/Y/Z, a field-of-view
slider, near/far clipping, a Perspective/Orthographic toggle, and object rotation
on a chosen axis with adjustable speed (separate from the existing camera spin).

**Why first.** No new assets, no new render passes, no performance question. It
is pure camera maths on top of code that already exists, and orthographic is a
genuine jewellery workflow need — catalogue rows only look consistent when every
piece is shot without perspective distortion.

**Watch out for:** the export path has its own framing maths in `studio.ts`
(`fitDistance`, `applyAngle`). Orthographic and a custom FOV have to be honoured
there too, or the download will not match the screen. That is the whole risk in
this phase, and it is exactly the class of bug the background tests were written
to catch.

**Done when:** a still and a video exported in orthographic match the viewport,
and the existing turntable is unaffected.

**Outcome.** The duplicated framing maths was unified into `camera.ts`, which
both the viewport and `studio.ts` now call — that duplication was the risk, and
it is gone rather than worked around. Numeric camera XYZ was dropped in favour
of the existing orbit controls plus a reset: typing coordinates for a camera you
can already drag is a CAD habit, not a jewellery one, and it would have fought
OrbitControls for ownership of the position every frame.

34 checks in `npm run test:camera`, which found a real bug on the way: a
degenerate model produced `near > far` — a silently broken projection matrix
rather than an exception.

---

## Phase 2 · Lighting and environment — DONE

**Features:** #4 studio HDRIs + separate gem environment · #6 custom light setup ·
#7 soft shadow controls

A **Lighting** section: environment picker, add/remove lights with intensity and
position, debug helpers to show where lights sit, and shadow controls (size,
softness, samples, resolution).

**Why this is the highest-value phase.** The refraction material samples _only_
the environment map — scene lights do not reach it at all. The environment is
therefore the single biggest determinant of how a diamond looks, larger than any
material change. drei already ships ten studio environments, so most of #4 costs
almost nothing.

**The thing to be careful about.** A studio light-tent environment was built,
shown, and reverted at the client's request. It goes back in as **one option in a
list**, with the current look as the default. Anyone who prefers it can pick it;
nobody has it forced on them.

**Watch out for:** "separate gem environment" means the stones and the metal
sample different maps. That is how real jewellery photography works — the piece
in a room, the stone in a tent — but it doubles the environment memory. Needs a
measured decision on mobile.

**Done when:** switching environment changes the stones live, the default is
unchanged from today, and memory on a mid-range phone is measured, not assumed.

**Outcome.** Eleven environments (ten drei presets plus the generated light
tent), a "light stones separately" toggle, key/fill/rim/ambient sliders and full
ground-shadow control. `environment.ts` is gone, superseded by `lighting.ts`.

The light tent came back as an **option**, never a default — and it is generated
as an equirectangular half-float map rather than baked with PMREM, because
drei's refraction shader samples with `equirectUv` and a CubeUV atlas makes the
stones vanish. That is the mistake that cost a day earlier; the test now asserts
the mapping so it cannot recur.

39 checks in `npm run test:lighting`. Every default is asserted literally against
the values that were on screen when the look was approved, so a stray edit to one
of them fails the suite instead of silently changing a signed-off render. The
tent is measured through the real display path — ACES at exposure 1.4, then sRGB
— giving min 135/255, nothing below 90, 64.6% bright and 35.4% midtones.

Not built: arbitrary add/remove lights and debug helpers. The four sliders cover
what the fixed three-light rig can express, and the stones ignore lights
entirely, so more of them buys very little.

---

## Phase 3 · Ground plane and reflections — DONE

**Features:** #8 ground plane settings · #13 reflective ground

Show/hide, standard vs transparent, custom size or auto-fit to the piece, then
metalness / roughness / reflectivity, and a mirror reflector with blur, mix
strength and depth threshold.

**Why it matters.** Every competitor screenshot has the piece on a reflective
floor. It is probably half the perceived quality of those images, and it is
presentation rather than physics — cheap in modelling terms.

**Watch out for:** a real-time reflector is a **second render of the whole scene**
per frame. With a 900-frame video export that doubles a long job, and on a phone
it may simply be unaffordable. Plan: ship the ground plane and shadow first
(cheap), then the reflector behind a quality setting that defaults off on coarse
pointers — the same `matchMedia("(pointer: coarse)")` check the export limits
already use.

**Done when:** ground and shadow work everywhere; the reflector is measured on a
phone and gated on the result rather than on hope.

**Outcome.** Ground off by default. Matte and Mirror styles, six colour presets,
polish, size, and mirror softness/strength/detail. 30 checks in
`npm run test:ground`.

**On "measured on a phone":** I could not do that — I have no browser and no
device. What I did instead was read what the reflector actually costs in drei's
source (`gl.render(scene, virtualCamera)` into an FBO plus blur passes, every
frame) and gate on that reading: the mirror is never the default, a coarse
pointer is capped at 512, and a 2048 setting saved on a desktop is **clamped**
when the same link is opened on a phone rather than silently honoured. The
warning text says what the cost is instead of hiding it. Real frame numbers on
a device would still be worth having.

The z-fight between ground and contact shadow is prevented structurally rather
than by a tuned constant: both heights come from one `groundY()` helper, and the
test asserts the separation across four piece shapes including a degenerate one.

---

## Phase 4 · Export and branding — DONE (except interactive capture)

**Features:** #20 live watermark · #18 turntable at 4K/60fps + interactive
capture · #19 video settings · image DPI field

Watermark: studio name typed into the panel, drawn live on the canvas, with size,
angle, opacity and placement, baked into every export. Then video resolution up
to 4K, frame rates to 60, and an interactive capture mode that can pause and
resume mid-record.

**Why here.** The watermark is a couple of hours of canvas work and is
commercially useful immediately — it is the difference between a client sharing a
render and a client sharing _your_ render. It also slots straight into the
`composite()` path the background work just added, so the plumbing exists.

**Watch out for:** 4K at 60fps is 4× the pixels and 2× the frames of today's
1080p/30 — roughly 8× the work and 8× the peak memory. On a phone that is a
killed tab, not a slow export. The existing mobile caps must extend to cover it,
and the UI should say why an option is unavailable rather than silently hiding it.

**Done when:** the watermark appears identically on screen, in stills and in
video; 4K/60 works on desktop and is refused with a clear reason on devices that
cannot hold it.

**Outcome.** Watermark with text, position, size, angle, opacity and colour —
live on the stage and burned into every export, transparent PNGs included.
Video gains 1440p and 2160p, and 24/30/60 fps, with phones capped at 1080p30.
34 checks in `npm run test:export`.

**The bug that mattered.** The codec string was the constant `avc1.640028` —
H.264 High at **Level 4.0**, which is capped at 8192 macroblocks per frame and
245,760 per second: 1080p30 and no more. Adding a 4K option without touching it
would have made `isConfigSupported` return false, and the code then falls
through to the WebM branch — so choosing 4K would have silently produced a
real-time WebM instead of the frame-by-frame MP4 that is the entire point of
this exporter. The level is now derived from frame size and rate (4.0 / 4.2 /
5.0 / 5.1 / 5.2), and the test asserts 1080p30 still resolves to exactly the old
string so existing exports are unchanged. Bitrate scales with pixel count for
the same reason.

Sizing is a fraction of the frame's short edge throughout, never pixels — a
16px mark is legible at 900px, invisible at 4K and enormous in a thumbnail.

**Not built: interactive capture** (record while orbiting, with pause/resume).
It is a different mechanism from the frame-by-frame exporter — real-time
capture, so quality depends on the machine, which is the property this exporter
was specifically built to avoid. Worth doing only if someone actually asks for
a hand-driven recording.

---

## Phase 5 · Post-processing — DONE (bloom)

**Feature:** #9 — **bloom only**

Bloom on the highlights, as an option.

**What I am recommending against, and why.** #9 as they list it is three things:
Unreal Bloom, depth-of-field bokeh, and screen-space reflections. Bloom is one
cheap pass and makes sparkle read as sparkle — worth doing. **SSR and DoF are
each a full-screen pass with multiple samples per pixel.** Given no GPU and 60%
mobile, they would cost more than they return, and SSR in particular is famously
unreliable on transmissive materials — which is every stone in the scene.

If they are wanted for parity on a feature list, the honest version is
desktop-only with a visible warning. I would rather say that plainly than ship
something that makes phones crawl.

**Done when:** bloom is measured on a mid-range phone with a frame-time number,
and gated on that number.

**Outcome.** A **Glow** section with threshold, strength and spread. Off by
default: with it off no composer is constructed at all and both the live loop
and the export path fall back to a plain `gl.render`, so the feature cannot cost
anything until it is switched on.

**Two traps, both avoided deliberately.**

`OutputPass` must be last in the chain. Tone mapping and sRGB conversion happen
when a material writes to the default framebuffer, which a composer bypasses —
so `RenderPass -> UnrealBloomPass` and stop would wash the entire render out, in
a way that reads as a lighting mistake rather than a pipeline one. three 0.185
ships `OutputPass`; three-stdlib does not, which is why the imports come from
`three/examples/jsm`.

The composer had to become the renderer for **both** paths. Exports call
`gl.render` directly, so bloom would have appeared on screen and been missing
from every download. `CaptureTarget` now takes an optional `renderFrame`, and
`beginOffscreen` resizes the composer with the export and calls it.

The render target is **half-float**: the whole point is highlights carrying
values above 1, and an 8-bit buffer clamps them to white before the bright-pass
ever sees them, leaving bloom keyed off nothing.

**Still not measured on a device.** Same honest limit as Phase 3 — no browser
here. It is off by default and the panel says it costs a render pass.

**SSR and depth of field remain unbuilt, on purpose.** Each is a full-screen
multi-sample pass, and SSR is unreliable on transmissive materials — which is
every stone in the scene.

---

## Phase 6 · Import and inspection — DONE

**Features:** #1 OBJ/STL import + up-axis choice · #2 raw geometry view

**#2 is nearly free** — swap every material for a flat clay material and skip the
gem treatment. It is genuinely useful for checking a model before styling it, and
it is a good diagnostic for us too.

**#1** adds `OBJLoader` and `STLLoader`, plus a control to say which axis is up,
because Rhino and most CAD exports disagree with three.js about that and a piece
that arrives on its side looks broken.

**Watch out for:** OBJ and STL carry **no layers and no render materials**. Every
piece of stone/metal classification we have depends on those. An STL is a single
unnamed mesh, so it will import as one metal object with no stones — that is not
a bug, and the UI has to say so rather than let someone think the stones vanished.
This is where the object-selection work needed by Phase 7 belongs: letting
someone select part of an imported mesh and mark it as stone.

**Done when:** a `.3dm` is unaffected, an OBJ/STL imports upright, and the
limitation on materials is stated in the UI rather than discovered.

**Outcome.** OBJ and STL both import, an **Up axis** control fixes the Z-up /
Y-up mismatch, and **Show raw mesh** strips every material to leave flat clay.
Both new controls sit in the Camera section. Six new checks in
`npm run test:camera`.

**Up axis is corrected after load, not at upload.** TiaraRender asks at import;
nobody knows which convention a file used until they see it on screen, so the
control is where the piece is. It rotates the inner root _before_ the bounding
box is measured — rotating afterwards would leave the camera framing the old
orientation.

**The limitation is stated, not hidden.** OBJ keeps object and group names, so
the existing name-based sorting still separates stones from metal, but it has no
layers and its materials live in a separate `.mtl` that is not part of the
upload. STL carries geometry and nothing else — no names, no materials, no
colour — so the whole piece arrives as metal and there is no way to find the
stones. Both now emit a notice saying exactly that, because otherwise it reads
as lost geometry.

---

## Phase 7 · Surface textures — DONE

**Feature:** #5 — Opal, Florentine, Snakeskin, Hammer, Scratch, Brushed, Noise,
Velour Velvet, Metal Plate, Oak Veneer

Applied to a selected object, live.

**Why last.** Two reasons. It needs ten tileable texture assets, several of which
(hammer, brushed, scratch, noise) are better generated procedurally than shipped
as files — that is real work, not a download. And it needs the ability to select
an arbitrary object, which today only exists for stones; Phase 6 is where that
gets generalised.

**Watch out for:** textures need UV coordinates. Rhino render meshes frequently
arrive without them, so this needs triplanar mapping — projecting the texture
from three directions in the shader — rather than a straight UV lookup. Worth
knowing up front, because it changes the approach from "load a texture" to
"write a shader".

---

## How each phase ends

Same as the work already done:

- typecheck, lint, build
- a test script for the new logic, run in Node against the real code
- the LP 043 baseline re-checked, so nothing regresses on a real client file
  (`metal 982,782 verts`, one `#ffffff` gem group at `80,080 verts`)
- what was measured, stated as numbers rather than adjectives

## What we have that they do not

Worth keeping in view while chasing parity:

- **Per-stone colour picker** — select a stone on the piece and change it
- **Layer-aware `.3dm` stone grouping** — centre stone separated from melee
- **Stone colour read from material names** — the RhinoGold/MatrixGold pattern,
  where the colour is in the name and the material itself is white
- **Depth-based gem absorption** — colour deepens with path length
- **iframe embed API** — drives the viewer from a management system by URL
- **Mobile-first** — theirs is a desktop application

---

## All 20 features complete

Nine finishes — Brushed, Hammered, Florentine, Scratched, Sandblast, Snakeskin,
Metal plate, Velour, Opal — plus Polished as the default. 40 checks in
`npm run test:textures`.

**Generated, not shipped.** Ten tileable PNGs would add megabytes to a product
whose premise is no backend and a phone. These are arithmetic, built once,
cached, and seamless by construction — which a photographed texture is not. The
test measures the wrap on both axes for every finish; all nine come out at 0.000
except scratch at 0.001.

**Height, not colour.** These are finishes, not decals: hammering changes how
metal catches light, it does not paint it. Each pattern is a height field, and
the normal map is derived from it by central difference so the two cannot
disagree. Low ground is made rougher than high ground, which is what makes a
dimple read as worked metal rather than a bumpy mirror. Applying them as colour
would tint gold grey — the wrong answer that looks plausible in a screenshot.

**Two bugs the tests caught.** The hammer dimples were hashed on the unwrapped
cell index, so the two sides of the tile disagreed and a line of half-dimples
ran round the band. And a hash constant exceeded `Number.MAX_SAFE_INTEGER`, so
the multiplier the engine used was not the one written and the hash quietly lost
entropy.

**Known limit: UVs are box-projected from position**, because Rhino render
meshes almost never carry them and a lookup without UVs samples one texel for
the whole mesh — a flat tint that reads as the texture having failed. Projection
means a seam is possible where a surface turns through 45 degrees. Triplanar
mapping in the shader would remove it, at the cost of three texture lookups per
pixel instead of one. Worth doing only if the seams actually show on real pieces.

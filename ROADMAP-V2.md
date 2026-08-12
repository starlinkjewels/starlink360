# RenderGod — Roadmap V2: same-to-same UI, zero gaps

Target: match TiaraRender's layout and close every gap found in
[GAP-ANALYSIS.md](GAP-ANALYSIS.md). Eleven phases.

## Rules for this rebuild

1. **The shell comes first.** Every later phase lands inside it. Building
   features into the old accordion and then moving them is doing the work twice.
2. **Match the layout, not the identity.** Their arrangement — icon rail, framed
   viewport, tabbed panels — is a UI pattern and fair to follow. Their logo,
   wordmark and copy are theirs. Everything ships as RenderGod.
3. **Numeric boxes with the range in the label.** `Samples (1 - 100)`, not a
   slider reading "50". This idiom is most of why their panels read as a tool.
4. **State costs in the UI.** Copy their `⚠ High-performance GPU required`
   pattern rather than burying warnings in hints.
5. **Every phase ends the way the last twelve did** — typecheck, lint, build, a
   Node test for the new logic, and the LP 043 baseline re-checked
   (`metal 982,782 verts`, one `#ffffff` gem group at `80,080`).

## One decision needed before Phase 1

Their UI is **light by default**; ours is dark, and the dark look was signed off
by your client. Same-to-same means switching the default to light and keeping
dark as the option — the exact inverse of today.

**I will default to light** unless you say otherwise, because you asked for
same-to-same. Both themes stay available, so nothing is lost either way.

---

## Phase 1 · Shell skeleton — DONE

Top bar (logo · Reset Scene · Save Project · Upload · account), **framed
viewport card**, **right icon rail** (13 icons), and the **section panel**
container with `SECTION TITLE` + tab row.

Plus the two shared primitives every later phase needs:

- `NumberField` — label with range, numeric box, optional slider
- `TabRow` — the icon+label tabs used by Materials, Environment and Export

All existing sections get ported into the new panel unchanged. **No new
features.** This is pure restructure, and it is the phase that changes how the
product reads.

**Touches:** `index.tsx`, `StudioPanel.tsx` (split into per-section panels),
`styles.css`. **Risk:** medium — large diff, but no logic changes.
**Done when:** every control that works today still works, in the new frame.

**Outcome.** Top bar, framed viewport, 14-icon rail and section panel, plus the
`NumberField` primitive. Light is now the default theme; dark remains an option.

The accordion did not need splitting into per-section files: its `open` state was
already a single section id, so the rail drives it directly and `Section` renders
only when active. One prop, no rewrite.

The panel is mounted always and shown by **CSS**, not by a JS-measured
breakpoint. Gating the mount on `matchMedia` cost a frame on every load and
showed the desktop app briefly panel-less.

`TabRow` was not built — nothing needs tabs until Phase 4. Building it now would
be guessing at an interface with no caller.

Verified in the served HTML: 14 rail sections, 4 top-bar actions, viewport frame,
and the panel heading rendering server-side.

## Phase 2 · Canvas furniture — DONE

Bottom toolbar (select · move · scale · rotate · measure · grid · lock ·
contrast), **axis gizmo** bottom-left, **undo / fullscreen** bottom-right, and
the **selection HUD** top-left.

Tools that need a selection engine are rendered but inert until Phase 3 — with
the disabled reason shown, not hidden.

**Risk:** low.

**Outcome.** The camera gained numeric Position X/Y/Z, shown live as it orbits
and typeable to pin it. `CameraSettings.position` is null by default, which is
the behaviour every piece has had: framed on the standard direction at whatever
distance fits. A number pins it, which is what reproducing a shot across twenty
pieces needs — "the same angle" is a position, not a gesture, and a catalogue
row shot at slightly different angles reads as sloppy even when nobody can say
why.

The position is reported on a hundredth-of-a-unit change rather than every
frame: orbiting moves the camera continuously and a state update per frame would
re-render the panel sixty times a second for numbers displayed to two decimals.

`cameraPosition()` resolves framed-versus-pinned in one place so the viewport
and an export cannot disagree — the failure being a download taken from the
framed angle while the screen shows the pinned one. **All three axes at zero is
rejected rather than honoured**: a camera at the origin is inside the piece
looking at itself, `lookAt` has no direction to work with, and the result is a
blank frame that reads as a broken render. Clearing the fields would otherwise
produce exactly that.

**Animation** is one panel now. Camera turntable and object spin were in two
sections, which is the wrong split: they look identical on screen and do
completely different things to the light. Orbiting the camera sweeps the
lighting across a still piece — what sells a polished band. Turning the piece
holds the lighting still and shows every side the same — what a spec shot wants.
Nobody can tell them apart from the result, so they sit together with the
difference written down, and running both at once is warned about because the
rotations compound into a drift.

**Up-axis moved into an import prompt** with an orientation preview, shown when
a file loads. It was buried in the Camera panel, which is no use to someone
watching their ring load sideways who does not know the words "up axis" — they
conclude the viewer cannot open their file. The extension supplies a guess (OBJ
and STL are Z-up; GLB and our own .3dm decoder are Y-up) and the choice is still
changeable afterwards.

The preview is a drawn silhouette rather than a render: a real one would need a
second WebGL context per option, and the thing being previewed is the
ORIENTATION, which a shape on a ground line says more plainly than a shaded
model. **Done when:** the frame is complete and nothing is a dead
control without saying why.

**Outcome.** Toolbar with all eight tools, axis gizmo, reset-view and fullscreen,
and the selection HUD.

More of it works than planned. **Grid** draws a real ground grid scaled to the
piece — a fixed-size grid is invisible around a ring and swallows a necklace.
**Lock** disables OrbitControls so a framing cannot be nudged by accident.
**Contrast** switches light and dark. **Fullscreen** uses the Fullscreen API on
the viewport, failing silently when refused — inside an iframe without
`allow="fullscreen"` there is nothing useful to tell someone who clicked.
**Reset view** re-fits the camera. The **axis gizmo** is drei's `GizmoHelper`, so
it is interactive: clicking an axis snaps the view.

Select, Move, Scale, Rotate and Measure are rendered **disabled with the reason
in the tooltip** rather than hidden. Hiding them would make the toolbar change
shape when Phase 3 lands, and a control that says why it is unavailable is
better than one that silently does nothing.

The HUD reads the existing stone selection, so it is live today rather than a
placeholder — and **ESC clears it**, because the HUD advertises that key.

Tool definitions live in `shell/tools.ts`, not beside the components: exporting
data from a component file breaks fast refresh, which lint caught.

## Phase 3 · Object selection — DONE

The load-bearing phase. Click to select, Ctrl+Click select all, ESC clear, live
count in the HUD, hover highlight, and a selection outline in the viewport.

Generalises the existing stone picker to **any mesh**, and lets a material or
texture apply to a selection rather than to everything.

**Touches:** `Viewer.tsx`, `Model.tsx`, new `selection.ts`.
**Risk:** high — it changes what "apply" means everywhere downstream.
**Done when:** selecting a prong and assigning a metal changes only the prong.

**Outcome.** Selection works on metal and stones alike: click replaces,
Ctrl/Shift+Click adds and removes, clicking the only selection clears it, ESC
clears, and the HUD names what is selected rather than counting it.

The real work was in the decoder. Metal used to arrive as **one merged mesh** —
cheap to draw, but it makes a shank, a head and two hundred prongs the same
object, so "select this part" has nothing to refer to. `buildGems()` became
`buildGroups(bucket)` and both buckets are now grouped by colour and layer, using
the jeweller's own layer names. On the client's LP 043 that is **4 metal groups
totalling exactly 982,782 verts** — the same total as the single mesh, so the
split costs no geometry, only three extra draw calls.

Selection lives in `selection.ts` as pure functions over a `Set<string>`, tested
standalone (`test:selection`, 18 checks). Both the decode suites and the
real-file worker suite were updated to the grouped shape; the worker suite now
validates index bounds and normals **per group**, since one bad group is enough
to drop a draw call.

Highlight went through two attempts. A `box3Helper` per part was the first, and
it does not work: around a 740k-vert metal group the box encloses the whole ring,
so it says "this piece" rather than "this part", and thin lines over a bright
specular render are near-invisible on a phone.

What replaced it tints the part itself — the **same geometry** re-drawn as flat
cyan over the top, so no new buffers, no BVH, one draw call per pass. Cyan
because gold-on-gold would be invisible and no jewellery is cyan. A second,
fainter pass with `depthTest: false` means a selected prong behind the shank
still reads. Not an `EdgesGeometry` outline: building one on 740k verts is
prohibitive on a phone, and not an emissive tint either, since a refractive
stone's shader has no emissive term.

The overlay is parented to the part rather than positioned, so it inherits the
transform and cannot drift, and its `raycast` is a no-op — otherwise it would sit
over the part and swallow every click, making "click a selected part to deselect"
silently do nothing.

**Hover** was added with it. Without it a merged part list is undiscoverable:
"Metal 01" and "Metal 02" mean nothing until pointing at one lights it up.

Exports exclude the tint. `renderAtSize` and `beginOffscreen` both wrap their
render in `hideOverlays` — a still or a turntable is a photo of the piece, not a
screenshot of the editor.

Grouping stops at the layer. Finer is not available and should not be faked — a
pavé field is hundreds of solids merged into one draw call, and splitting them to
allow picking one stone would cost hundreds of draw calls and BVHs on mobile.

**Correcting Phase 2:** that section says five tools turn on here. Only **Select**
does. Move, Scale and Rotate need transform gizmos and Measure needs a
point-to-point probe — none of which selection provides. Their tooltips now say
so specifically instead of pointing at this phase.

## Phase 4 · Material libraries — DONE

`MATERIALS` panel: **Gems / Metals tabs**, grid/list toggle, **18 metal
swatches** and **~24 gem materials** as rendered preview spheres, and a **custom
material editor** behind the sliders icon (base colour, metalness, roughness,
IOR, transmission).

Preview spheres are generated once and cached, the same approach as the light
tent — no shipped assets.

**Depends on:** Phase 3. **Risk:** medium.

**Outcome.** `library.ts` carries **18 metals** and **24 gems** as plain data,
grouped into families, with `preview.ts` shading a swatch for each. Both are
pure, so `test:library` checks all 42 without a browser — including that no two
swatches can cache to the same image.

The gem numbers are the published mineral constants, not taste: diamond 2.417 /
0.044, moissanite 2.65 / **0.104**, corundum 1.77 / 0.018. Dispersion is scaled
into the shader's aberration against diamond as the anchor, so the diamond look
already signed off is unchanged and every other stone moves relative to it.
**Until now every stone in every piece was traced at diamond's IOR** — an
emerald was a diamond that happened to be green.

Preview spheres are **2D canvas, not WebGL**, and that is the deliberate choice.
42 rendered spheres each need the current environment map and re-render whenever
it changes; on a machine without a GPU that is seconds of stall to draw a 44px
circle. The shading is derived from the material's own numbers — roughness
decides whether a metal forms a specular dot at all, dispersion decides how many
glints a stone gets — so the grid still tells 18k from 14k at a glance.

Where a material lands is `assign.ts`, one rule: **it goes on the selected parts
it can go on; if none are selected, on every part of that kind.** The panel
states the scope on screen above the grid rather than leaving it implied. A
gem clicked while only metal is selected falls back to all gems rather than
doing nothing, because a swatch that does nothing reads as broken.

**The Stones section is gone.** Metals and gems are one panel with two tabs, and
the rail's Stones icon opens it on the Gems tab. Two panels each held a colour
for the same stone, the render had to pick one, and nothing on screen said
which.

Also fixed in passing: metal used to be identified by sniffing `metalness === 1`,
which the custom editor breaks the moment it sets metalness below 1 — the
black-rhodium entry alone would have dropped out of every later update and
frozen. Metal is now identified from `userData.part`, with the sniff kept only
for GLB and fallback scenes that carry no tags.

`opaque` and the transmission slider are wired through to a real material swap:
below 0.5 a stone stops being traced and renders as a polished solid. Tracing an
opaque body does not just waste work, it renders the background through it. The
swap is a separate effect from the build, so changing a stone never rebuilds its
BVH.

**Bug found on first use, and fixed.** Nothing applied — not metal, not stones.
`userData.part` was written **only by the .3dm loader**, so on a GLB, on an
OBJ/STL upload, or on the built-in piece the part list was empty; every swatch
click wrote an assignment for zero parts and changed nothing, with no error to
explain it. The same gap made Phase 3's selection dead on those pieces.

Tagging moved into `DressedScene`, where every load path converges, and never
overwrites a tag the .3dm loader already wrote — the jeweller's own layer name
beats anything derived from a mesh name. Untagged meshes get a label cleaned of
exporter decoration ("Cube.001" to "Cube", "mesh_shank" to "Shank"), numbered on
collision so two meshes called "Cube" stay separately selectable. Stones also
get the second `userData.stone` identity, without which a colour override had
nothing to key on.

**Paint mode**, added on request: arm a material with the brush toggle, then
click stones on the piece one at a time. Setting a halo through
select-then-apply is two steps per stone. A painted click is consumed whole, so
the selection is left alone rather than accumulating tint across every stone.

**Still not verified on screen.** Typechecked, linted, built, and covered by
42 + 39 + 14 unit checks — but there is no browser here, so nobody has looked at
the panel.

## Phase 4b · One stone, not one layer — DONE

A Rhino layer is not a part. Measured on the client's file: **"Gem 03" is 140
separate diamonds**, "Metal 01" is 285 solids, "Metal 02" is 476. Selecting the
layer selected all of them, which is right for "make every stone ruby" and
useless for "make THIS one ruby" — the thing actually asked for.

`parts` was no guide either: the decoder reported **17,780** for that gem layer,
because those are BRep faces, not objects. Connectivity is the only honest
answer, so the worker now runs union-find over each merged group — welding by
quantised position, since every chunk duplicates its seam vertices — and
**reorders the index buffer so each solid is one contiguous run**. It emits the
offsets. ~1.7s for the whole million-vertex file, once, off the main thread.

Contiguity is what makes it cheap: one stone is a draw range, so clicking it and
lighting it costs an offset and a count, not a new buffer. Highlight shares the
original's vertex buffers through a wrapper geometry rather than `clone()`,
which deep-copies every attribute — a second copy of 740k vertices per selected
stone.

**Two bugs the tests caught before they shipped.** Group ids end with a hex
colour, so a `#<n>` suffix made `Metal 01|#999` parse as solid 999 of a group
called `Metal 01|`; the suffix is `#solid<n>` now. And the geometry `clone()`
above was doing exactly the copy the draw range existed to avoid.

**Applying a material to one solid now works too.** `plan.ts` turns the
assignments for a mesh into contiguous draw runs, and the mesh takes a material
array with `geometry.groups` pointing each run at its slot. Because the decoder
made every solid contiguous, the untouched stretches between customised ones
stay merged — **three recoloured stones out of 140 is seven draw calls, not
140**, and an untouched piece is still the single-material mesh it always was.
That property is what `test:plan` exists to hold.

Both renderers use it. Metal builds one `MeshPhysicalMaterial` per distinct
spec. Gems do the same with the traced material, which meant splitting the BVH
out into a per-geometry cache first: the BVH is the expensive part of setting up
a stone and depends only on geometry, so choosing a different stone must never
rebuild it. Opaque stones drop out of tracing per run rather than per mesh, so
one onyx among diamonds is now expressible.

`targetIds` no longer widens a solid id to its group — the id selected is the id
assigned — and the panel names the exact target: "Gem 03 · 12" for one stone,
"Gem 03 — all 140" when the whole group is selected.

## Phase 5 · Textures — DONE

`TEXTURES` panel: **thumbnail previews** of each finish, `Enable Texture`
toggle, **Texture Channels** (colour / roughness / normal / bump), **Hammer1-3**
variants, and the two **colour textures** (Velour Velvet, Oak Veneer) our
height-only pipeline cannot currently express.

Applies to the current selection.

**Depends on:** Phase 3. **Risk:** medium — colour textures need a second
pipeline beside the height one.

**Outcome.** Its own rail section, built like Materials on purpose: a grid of
previews over the current selection with the scope stated above it. A finish is
a property of a part — a brushed shank with polished prongs is an ordinary
piece — so it is assigned exactly the way a metal is.

**Thumbnails** are generated from the same height and colour fields the real
maps come from, so a swatch cannot drift from what it previews. Height finishes
are lit from the top left using the same slope the normal map is built from; a
flat grey sample would make every finish look identical.

**Hammer 1–3** are three planishing weights, differing in hammer face: 10, 7 and
4 cells across, dishing 0.50 / 0.62 / 0.73 deep. Three entries that rendered the
same would be three lies in the grid, so the suite asserts the ordering.

**Velour Velvet and Oak Veneer** are the two colour textures, and they needed
the second pipeline the risk note predicted. `colourAt` returns null for a metal
finish — deliberately, because a caller that painted its grey onto gold would
produce exactly the tinted-metal bug the height/colour split exists to prevent.

**Texture Channels** (colour / roughness / normal / bump) each build their map
or don't, so a switched-off channel costs no memory. Colour is disabled rather
than hidden on a metal finish, so the set of controls does not change shape
while browsing.

`repeat` is baked into the texture cache key rather than set by the caller.
Textures are shared between every part using a finish and `repeat` lives on the
texture, so setting it afterwards would change the scale for every other part
and the last one to render would win.

Material and finish are folded into ONE per-part spec, because the renderer
merges draw runs by comparing those objects: two prongs in the same gold with
different finishes must stay separate runs, and comparing colour alone would
merge them.

Stones are excluded. A diamond is not hammered, and offering it would be a
control that cannot do anything.

## Phase 6 · Lights and Shadows — DONE

`LIGHTS`: a real manager — `N lights · M active`, `Reset defaults`, **Debug
Helpers**, **+ Add Light**, per-light duplicate / hide / delete / expand with
type, colour, intensity and position.

`SHADOWS`: replace `ContactShadows` with a **directional shadow camera** and its
eleven controls — Size, Focus, Samples, mapSize width/height, and shadow camera
near/far/left/right/top/bottom.

**Risk:** high. This swaps the shadow mechanism; the current soft ground shadow
is not the same thing and the change is visible on every piece.

**Outcome.** `lights.ts` makes the rig a list. It was five elements written into
the viewport's JSX, so the rig was whatever a developer had typed — nothing
could be added, moved, recoloured or switched off, and the first thing anyone
does on a real set is kill the fill to see what the key is doing alone.

`DEFAULT_LIGHTS` is those five transcribed exactly — key 5.5 spot at #fff6ee,
[2.8, 6, 3.5], cone 0.38, penumbra 0.55; fill 1.4; rim 1.1; ambient 0.12;
sparkle 1.6 — because they are the values that were on screen when the look was
signed off. The suite asserts them literally so a tidy-up cannot restyle every
render.

The manager gives `N lights · M on`, Reset defaults, Debug Helpers, + Add of
four types, and per-light duplicate / hide / delete / expand with name, type,
colour, intensity, XYZ, cone, penumbra and falloff. Ids are derived from the
list rather than from `Math.random` or a clock, so a saved project reloads with
the ids it was saved with. A duplicate is offset and never inherits the caster
flag: one at the same position looks like the button did nothing, and a second
caster is a whole extra render of the piece plus a crossed double shadow.

**The shadow risk was real, and it is resolved by not taking it silently.** Both
mechanisms exist and **contact stays the default**. Swapping the mechanism
restyles every render a client may already have approved, and that is the user's
call to make, not something to do on their behalf — it is one dropdown away
instead.

Directional is a real shadow camera with all eleven controls: Size, Focus,
Samples, map width/height, and near/far/left/right/top/bottom. The frustum is
expressed in multiples of the piece's own size, since every load path normalises
to a unit sphere and absolute numbers would need re-tuning per ring.

Three things that would have been silent failures:

- `near >= far` does not throw. It produces a depth range with nothing in it and
  the shadow simply vanishes, which reads as a broken feature. `clampShadows`
  forces far strictly beyond near.
- The shadow map is allocated at its old size until disposed, so setting
  `mapSize` alone keeps rendering at whatever size it was first created with.
- PCF ignores both `shadow.radius` and `blurSamples`, so a Samples slider over
  it would be a control that does nothing. The map type follows the mode — PCF
  for contact, which is what the viewer has always used, VSM for directional
  where the softness controls actually mean something.

Directional mode also supplies a stand-in shadow-catching floor when no ground
plane is switched on, because a real shadow with nothing to land on shows
nothing at all.

## Phase 7 · Environment — DONE

`ENVIRONMENT` with **HDRI / GEM HDRI / Background** tabs, **12 HDRIs as preview
spheres**, `Separate Gem Env`, and **HDRI Settings** (rotation, intensity).

Background sub-tabs: Solid / Gradient / Image, upgrading gradients to **8 stops
on a draggable bar** with hex and position per stop plus radial directions, and
images to **built-in presets** with **Back / Front** placement.

**Risk:** low-medium. Mostly extending code that exists.

**Outcome.** Three tabs, because these are three jobs people conflate: what the
METAL reflects, what the STONES refract, and what sits BEHIND the piece. Only
the last is a backdrop; the first two are the light in the room.

**Twelve HDRIs as preview spheres.** The swatches are drawn from each
environment's own sky and ground colours rather than by sampling the real map:
the HDRIs are megabytes fetched on demand, so sampling them to draw a 44px
circle would mean downloading all twelve just to browse the list. The suite
checks no two swatches are the same pair and that sky is lighter than ground in
every one, so none reads upside down.

**HDRI Settings** are rotation and intensity, both starting at the values that
change nothing (0 and 1). Rotation is the control that matters most on a
polished band — the highlight IS the room, so turning the room is how the
highlight is moved along a shank. Y only: tipping an environment sideways puts
the horizon on a diagonal and nothing looks photographed.

**Gradients now carry up to 8 stops** on a bar, with hex and position per stop,
plus **radial** with five centres. Two things that break gradient editors, both
silent, are handled explicitly:

- `gradientStops()` is the single place that decides what a gradient IS, so the
  live CSS and the export painter cannot draw different things — which shows up
  as a download that does not match the screen.
- `updateStop` does NOT re-sort. Dragging a stop past its neighbour would
  renumber the array mid-drag and the pointer would start moving a different
  stop. Order is resolved on read instead.

A single stop is completed into a flat run rather than left to reach
`addColorStop` on an empty list, and settings saved before the bar existed still
read correctly from `from`/`to`.

**Image presets** are four generated backdrops — studio sweep, marble, linen,
dark vignette — for the same reason the finishes are generated: megabytes of
JPEG in a product with no backend, and these are resolution-independent so an
export renders its own rather than upscaling.

**Back / Front placement.** Front means the piece is shot THROUGH the image, so
it is painted after the render and before the watermark. Painting it in the
backdrop pass would put it behind the jewellery, which is the one thing the
setting exists to prevent — so `paintBackground` deliberately skips it and
`paintForeground` handles it.

## Phase 8 · Ground and reflector — DONE

`Show Ground`, **Standard / Transparent**, **Shape** (Square → Width+Length,
Circle → Radius+Segments), all with `blank = auto`, and the full **twelve
reflector parameters**.

**Risk:** medium — the reflector cost still needs gating on device.

**Outcome.** Show Ground, Standard / Transparent, Shape with Square →
Width+Length and Circle → Radius+Segments, every dimension blank-for-auto, and
all twelve reflector parameters.

**Transparent is not "off".** It keeps the plane and its shadow while hiding the
surface — the cyclorama trick, a piece floating on a gradient with a real shadow
under it. Switching the ground off loses the shadow with it, which is why a
plain on/off was never enough. A reflector has to be drawn to reflect anything,
so Mirror overrides Transparent and the panel says so rather than silently
picking one.

**Blank means auto, and zero does not.** `groundDimensions` resolves every auto
in one place, so the panel's placeholder and the actual mesh cannot disagree — a
field reading "auto 24.0" over a plane 12 wide makes every other number in the
panel suspect. Zero is honoured as a real value, because conflating it with
blank would make the field impossible to clear back to auto. Segments are
floored at 3 (two sides is not a shape) and capped at 256.

**The twelve reflector parameters** are resolution, blur X/Y, mix blur /
strength / contrast, mirror, and the depth four — scale, min, max and the
blur-ratio bias — plus distortion. They are not equal and the panel says which
is which: resolution is the one that costs, the blur pair is free, and the depth
group decides whether the reflection fades with distance or lies flat like a
decal.

`clampGround` guards `maxDepthThreshold < minDepthThreshold`, which does not
error — it inverts the fade so the reflection appears exactly where it should
have vanished, and reads as a shader bug rather than a bad number.

The device gating stayed: the resolution list is filtered to what the device
should be offered, 512 on a touch screen, and a value saved on a desktop is
clamped rather than honoured. Defaults are the values the mirror already
rendered with, plus drei's own for the parameters that were never exposed, so
nothing changes until it is asked for.

## Phase 9 · Post processing — DONE

Bloom gains **Resolution X/Y**. Adds **Depth of Field (Bokeh)** and **Screen
Space Reflections** (Thickness, Max Distance, Opacity, Width, Height) plus
**Blur / Bouncing / Fresnel** options.

Both default **off**, both carry the GPU warning. I previously argued these were
not worth their cost; their product ships them with a warning, and that is the
right answer for a product competing on a feature list.

**Risk:** high on performance — SSR is unreliable on transmissive materials, so
expect the stones to look wrong with it on. Warn, do not hide.

**Outcome.** Bloom gained Resolution X/Y; Depth of Field (Bokeh) and
Screen-Space Reflections were added with the parameters named. All three off by
default, so nothing changes and nothing is paid for until asked.

`BloomSettings` became `PostSettings` with three sections. `usesComposer` now
answers for the whole chain, and still returns false for bloom enabled at zero
strength — that case would build a render target and three passes to composite
an unchanged image.

**Pass order is not a preference.** SSR replaces the image with a reflected one
so it sees the plain render and goes first; bloom keys off brightness so it must
see those reflections; depth of field blurs whatever is finally there. Blurring
before bloom would make the bloom key off a blurred image and smear the sparkle
rather than spread it.

**`composerKey` is the load-bearing addition.** Some values are baked into a
pass at construction — which passes exist at all, SSR's bouncing render targets,
bloom's buffer size — and updating those in place does nothing whatsoever. That
is the failure where a control moves and the render does not. The key changes
only for those, so a slider drag updates uniforms and never tears down the
pipeline.

Two API details worth recording: `BokehPass` copies its constructor params into
uniforms, so assigning the fields back is a no-op and the uniforms have to be
written directly. And `SSRPass` takes `isBouncing`, not `bouncing`.

**The SSR warning says what it actually cannot do**, rather than a generic
performance note: it reflects only what is on screen and reads a depth buffer
that transmissive materials do not write usefully, so on a piece that is mostly
diamonds the stones will reflect wrongly or not at all. That caveat outranks the
frame-rate warnings when several effects are on, because it is a correctness
problem rather than a speed one.

Bloom's resolution is the cheapest quality dial in the pipeline and the panel
says so: a blur does not need full resolution, and halving both axes quarters
the work for a difference close to invisible.

## Phase 10 · Camera, Animation, Import — DONE

Camera gains **numeric Position X/Y/Z**. Object and camera rotation move into
one `ANIMATION` panel. Up-axis moves into an **import modal** with a live
orientation preview, matching theirs.

**Risk:** low.

**Outcome.** The camera gained numeric Position X/Y/Z, shown live as it orbits
and typeable to pin it. `CameraSettings.position` is null by default, which is
the behaviour every piece has had: framed on the standard direction at whatever
distance fits. A number pins it, which is what reproducing a shot across twenty
pieces needs — "the same angle" is a position, not a gesture, and a catalogue
row shot at slightly different angles reads as sloppy even when nobody can say
why.

The position is reported on a hundredth-of-a-unit change rather than every
frame: orbiting moves the camera continuously and a state update per frame would
re-render the panel sixty times a second for numbers displayed to two decimals.

`cameraPosition()` resolves framed-versus-pinned in one place so the viewport
and an export cannot disagree — the failure being a download taken from the
framed angle while the screen shows the pinned one. **All three axes at zero is
rejected rather than honoured**: a camera at the origin is inside the piece
looking at itself, `lookAt` has no direction to work with, and the result is a
blank frame that reads as a broken render. Clearing the fields would otherwise
produce exactly that.

**Animation** is one panel now. Camera turntable and object spin were in two
sections, which is the wrong split: they look identical on screen and do
completely different things to the light. Orbiting the camera sweeps the
lighting across a still piece — what sells a polished band. Turning the piece
holds the lighting still and shows every side the same — what a spec shot wants.
Nobody can tell them apart from the result, so they sit together with the
difference written down, and running both at once is warned about because the
rotations compound into a drift.

**Up-axis moved into an import prompt** with an orientation preview, shown when
a file loads. It was buried in the Camera panel, which is no use to someone
watching their ring load sideways who does not know the words "up axis" — they
conclude the viewer cannot open their file. The extension supplies a guess (OBJ
and STL are Z-up; GLB and our own .3dm decoder are Y-up) and the choice is still
changeable afterwards.

The preview is a drawn silhouette rather than a render: a real one would need a
second WebGL context per option, and the thing being previewed is the
ORIENTATION, which a shape on a ground line says more plainly than a shaded
model.

## Phase 11 · Export and Save Project — MOSTLY DONE

`EXPORT OPTIONS` as **Image / Video / Watermark** tabs.

- Image: **File Name**, **DPI**
- Video: **File Name**, **Turntable / Interactive** chooser, **Interactive
  capture** with pause/resume, **Rotation Mode** (Duration / 180 / 360 /
  Custom), WebM alpha, GPU warning
- Watermark: **logo image upload** beside the text mark
- **Save Project** — serialise the whole scene to JSON and reload it

**Risk:** medium. Interactive capture is a second recording mechanism; Save
Project is new surface area.

**Outcome.** Export Options is one section with Image / Video / Watermark tabs —
the settings that apply to a DOWNLOAD rather than to the render, which were
scattered across three places.

**File Name** on both, blank falling back to the generated name. A typed name is
stripped of path separators and the Windows-reserved set rather than refused:
someone typing "Ring / Emerald" means a filename, not a path.

**DPI is real, not a label.** `canvas.toBlob` always writes 96, so a 4000px
render lands in InDesign at 42 inches wide and someone retypes the size on every
image. The pixels were already right and only the metadata was wrong, so the
encoded bytes are re-tagged rather than re-encoded — a PNG gets a `pHYs` chunk,
a JPEG gets its JFIF density. Two traps, both covered: a decoder reads the FIRST
pHYs it meets, so writing twice must REPLACE rather than append; and a JPEG
without a JFIF segment needs one inserted immediately after SOI, the only legal
placement. The panel also states that DPI does not change how many pixels are
rendered, because assuming otherwise is entirely reasonable.

**Rotation Mode** — Duration / 180 / 360 / Custom — with a warning when the
sweep does not close, because social platforms loop everything and a clip
stopping at 350° visibly jumps. Custom clamps rather than wraps: 720 means two
turns, and wrapping it to zero would produce a still frame with nothing to
explain it.

**Logo watermark**, replacing the text rather than sitting beside it — two marks
in one corner is not a design anyone asks for, and placement and angle would
then mean two things at once. Drawn from the same anchor the text uses, so
switching between them does not move the mark.

**Save Project** writes the whole studio to JSON and reads it back, with Open
beside Save in the top bar. Three rules held throughout: the MODEL is not in the
file (a .3dm is tens of megabytes and already lives in the client's system);
every field is optional on read, so a project from an older or newer build still
opens; and nothing is trusted, because the file is user-supplied JSON that goes
straight into a renderer. The suite feeds it junk, arrays, `NaN`, `Infinity`,
`javascript:` strings where colours belong and an empty light rig — all of which
open safely with a notice rather than crashing the picker or rendering black.
Opening a project saved for a different piece says so, naming the piece, because
part-keyed materials will not match.

**NOT done: interactive capture.** The Turntable/Interactive chooser and
pause/resume recording are not built. It is a second recording mechanism
alongside the existing offscreen renderer — the existing one poses a camera and
renders deterministically, while interactive capture has to grab frames from a
live session at whatever rate the machine manages, which is a different pipeline
with its own timing and dropped-frame handling. Everything else in this phase is
in.

---

## Sizing

| Phase                            | Size | Depends on |
| -------------------------------- | ---- | ---------- |
| 1 · Shell skeleton ✅ **done**   | L    | —          |
| 2 · Canvas furniture ✅ **done** | M    | 1          |
| 3 · Object selection             | L    | 2          |
| 4 · Material libraries           | L    | 3          |
| 5 · Textures                     | M    | 3          |
| 6 · Lights and Shadows           | L    | 1          |
| 7 · Environment                  | M    | 1          |
| 8 · Ground and reflector         | M    | 1          |
| 9 · Post processing              | M    | 1          |
| 10 · Camera, Animation, Import   | S    | 1          |
| 11 · Export and Save Project     | L    | 1          |

Phases 4–11 are independent of each other once 1–3 land, so order after that is
yours to choose. If you want the biggest visible jump first: **1 → 2 → 6 → 4**.
If you want the most-requested capability first: **1 → 2 → 3 → 4**.

## What I will flag rather than quietly do

- **SSR on stones will look wrong.** Screen-space reflection has no data for
  what is behind a transmissive surface. It ships with a warning.
- **Interactive capture is real-time**, so its quality depends on the machine —
  the exact property the frame-by-frame exporter exists to avoid. Both stay.
- **I cannot measure frame time.** No browser here. Anything expensive ships off
  by default with its cost stated, as now.

# RenderGod vs TiaraRender — what is still missing

Written after viewing **all 20** feature screenshots, not from their marketing
copy. An earlier version of this file was based on 6 of 20 plus inference; the
rows below are now all from direct observation, and several of my earlier
guesses were wrong.

## The headline

**We have the capabilities. We do not have the application.**

Their product reads as software because of its shell. Ours reads as a viewer
with a settings drawer. That single difference outweighs any feature on the list.

### Their shell

| Element           | Where         | What                                                              |
| ----------------- | ------------- | ----------------------------------------------------------------- |
| Top bar           | full width    | logo · **Reset Scene** · **Save Project** · **Upload** · account  |
| Viewport          | centre        | **framed white card**, inset, rounded — not full-bleed            |
| Icon rail         | far right     | ~13 vertical icons, one per section                               |
| Section panel     | right         | `SECTION TITLE` + tabs + controls                                 |
| Canvas toolbar    | bottom centre | select · move · scale · rotate · measure · grid · lock · contrast |
| Axis gizmo        | bottom left   | live X/Y/Z orientation ball                                       |
| Undo / fullscreen | bottom right  | two round buttons                                                 |
| Selection HUD     | top left      | `Selected: 0 objects ×` + `Click / Ctrl+Click / ESC`              |

Their sections are grouped differently from ours, which matters for navigation:

- **ENVIRONMENT** = HDRI + **GEM HDRI** + **Background** (solid/gradient/image) in one panel with tabs
- **SHADOWS** is its own section, not part of lighting
- **ANIMATION** = object rotation + camera rotation together
- **EXPORT OPTIONS** = Image + Video + **Watermark** as three tabs
- **GROUND** contains the reflector

### The control idiom

Theirs is **numeric text boxes with the range in the label** — `Strength (0 - 5)`,
`Samples (1 - 100)`, `shadow camera left` — often paired with a slider. Ours is
sliders with a formatted value. Theirs reads as technical software; ours reads
as a consumer app. Worth copying.

---

## Section by section

✅ done · ⚠️ partial · ❌ missing

### 1 · Smart File Import ⚠️

A **modal on upload**: filename, `Up Orientation` X/Y/Z segmented, a live
"Preview Orientation: Z-Axis → Up Direction" readout, Cancel / Import.
Ours corrects up-axis _after_ load instead. Missing: the import modal, and
**Save Project** — they persist the whole scene; we persist nothing.

### 2 · Raw Geometry ✅

Flat clay view, same as ours. The selection HUD is present here too.

### 3 · Materials ⚠️

**Gems / Metals tabs**, grid/list toggle, **18 metal swatches** as rendered
spheres plus a **sliders icon** opening a custom material editor. The Gems tab
holds **~24 coloured gem materials**. We have 5 metals, no tabs, no editor, no
gem library — our stone colours are a picker, not a material library.

### 4 · Environment (HDRI) ⚠️

Tabs **HDRI / GEM HDRI / Background**, a `Separate Gem Env` toggle, **12 HDRIs
as rendered preview spheres**, and an **HDRI Settings** link (rotation,
intensity). We have 11 environments in a text dropdown, and Background is a
separate section. Missing: preview spheres, HDRI settings, the grouping.

### 5 · Textures ⚠️

**Thumbnail previews** in a 2-column grid — Hammer1, Hammer2, Hammer3, Scratch,
Brushed, Noise, Velour Velvet, Metal Plate, Oak Veneer — an `Enable Texture`
toggle, and a **Texture Channels** section. **Velour Velvet and Oak Veneer are
colour textures** (pink, wood grain); ours are height-only, so those two cannot
look right. Missing: previews, channels, colour textures, three hammer variants,
per-object application.

### 6 · Lights ❌

A **light manager**: `2 lights · 0 active`, `Reset defaults`, **Debug Helpers**
toggle, **+ Add Light**, and a list where each light has duplicate / hide /
delete / expand. We have four fixed sliders. Largest single-section gap.

### 7 · Shadows ❌

Not three sliders — **eleven numeric fields**: Size (1-500), Focus (0-10),
Samples (1-100), shadow mapSize width/height, and shadow camera
near/far/left/right/top/bottom. This is a real directional-light shadow camera.
Ours is drei `ContactShadows` with opacity/blur/spread — a different, much
simpler mechanism. My earlier guess ("samples, resolution, frustum") understated
it.

### 8 · Ground ⚠️

`Show Ground`, **Ground Type: Standard / Transparent**, **Shape** dropdown
(Square/Circle), and **Width + Length** as separate fields with `blank = auto`.
Circle mode swaps to **Radius + Segments (8-128)**. We have one `sizeScale` and
no shape. Note their Standard/Transparent axis is _separate_ from the reflector;
ours conflates matte/mirror with it.

### 9 · Post Processing ❌ (mostly)

Bloom ✅ — but theirs also exposes **Resolution X/Y (64-4096)**.
Missing entirely: **Depth of Field (Bokeh)**, and **Screen Space Reflections**
with Thickness, Max Distance, Opacity, Width, Height, plus **Options: Blur,
Bouncing, Fresnel**.

**I was wrong to leave SSR and DoF out.** I argued they were too expensive for a
no-GPU, mobile-heavy product. Their panel ships both — and their video panel
carries a `⚠ High-performance GPU required` banner. That is the answer: ship
them, default off, warn plainly. The reasoning was right; the conclusion wasn't.

### 10 · Animation ✅

`Object Rotation` (enable, X/Y/Z, speed) and `Camera Rotation` (enable, speed) as
two collapsible groups. We have both, split across two sections.

### 11 · Camera ⚠️

Perspective/Orthographic tabs, **Position X / Y / Z** each as slider + numeric,
Field of View, Clipping Near/Far. Missing: **numeric XYZ**, which I skipped
deliberately. They ship it — reinstate it.

### 12 · Orthographic ✅

Same panel, Orthographic tab selected. No extra controls.

### 13 · Reflective Ground ⚠️

Metalness / Roughness / Reflectivity, then a **REFLECTOR** block of twelve
numeric fields: Blur X, Blur Y, Mix Blur, Mix Strength, Mix Contrast,
Resolution, Mirror, Depth Scale, Min/Max Depth Threshold, Depth To Blur Bias,
Reflector Offset. We expose three.

### 14 · Solid Background ✅

Palette icon (custom) + 6 presets. We have 8 presets + picker. Level or better.

### 15 · Gradient Background ⚠️

**Up to 8 stops** (`Color (2/8)`, `+ Add`, `Reset`) on a **live draggable
gradient bar**, each stop with hex field and position %, **8 direction buttons
including radial**, and 6 quick presets. We have exactly 2 stops and 8 linear
directions. Missing: multi-stop, drag handles, position %, radial.

### 16 · Image Background ⚠️

**Built-in backdrop presets** ("Image 1" thumbnail), Upload / Clear, a 16:9
hint, Opacity, and **Side: Back / Front** — the image can sit _in front of_ the
model. We have upload + opacity only. Missing: presets, front placement.

### 17 · Image Export ⚠️

File Name, Resolution dropdown, Image Format, Transparent Background, **DPI
slider**, Export button. Missing: **File Name** and **DPI**.

### 18 · Video mode ❌

A **two-card chooser** — _Turntable_ ("frame-by-frame at full quality") and
_Interactive_ ("live capture, pause, resume, adjust quality while recording") —
each with capability chips. We have turntable only.

### 19 · Video Settings ⚠️

File Name, Resolution, Format, Frame Rate, **GPU warning banner**, Transparent
Background with "Requires WebM format", and **Rotation Mode:
Duration / 180° / 360° / Custom°**. Missing: file name, rotation modes, the
explicit WebM-alpha path, the warning banner.

### 20 · Watermark ⚠️

Text, Size, Angle, Intensity, Placement, "Watermark is live on the canvas ✓",
and **Watermark Image — upload a logo**. Missing: **image/logo watermark**, and
ours is a section rather than a tab under Export.

---

## Build order

1. **The shell** — icon rail, framed viewport, section panel, canvas toolbar,
   axis gizmo, undo/fullscreen, selection HUD. Biggest change to how it reads.
2. **Object selection** — click / Ctrl+Click / ESC with a live count. Two
   sections depend on it.
3. **Light manager** — add, duplicate, hide, delete, per-light settings, helpers.
4. **Shadow rig** — swap ContactShadows for a real directional shadow camera
   with the eleven controls.
5. **Material libraries** — 18 metals, ~24 gems, tabs, custom editor.
6. **Texture previews + channels + the two colour textures.**
7. **DoF and SSR**, default off, GPU warning.
8. **Reflector parameters**, ground shape, multi-stop gradients, image presets
   and front placement.
9. **Export finishing** — file name, DPI, rotation modes, logo watermark,
   Interactive capture, Save Project.

## Worth copying outright

- **State costs in the UI.** Their `⚠ High-performance GPU required` sits beside
  the 60 FPS selector. We gate bloom and the mirror on device but bury the
  reasoning in a hint.
- **Numeric boxes with ranges in the label.** It is what makes their panels look
  like a tool rather than a toy.

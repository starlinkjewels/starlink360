import * as THREE from "three";
/**
 * Distance of the tent walls. Arbitrary: an environment map records direction
 * only, so this scales away. Kept large enough that the panels read as broad
 * sources rather than points.
 */
const R = 10;
const PANELS = [
    // Main softbox, overhead and slightly forward — the key light.
    { size: [16, 16], position: [0, R, 2], intensity: 7 },
    // Front pair, high and wide. These are what the crown facets throw back at
    // the camera as the big white flashes.
    { size: [10, 14], position: [-R * 0.85, R * 0.5, R * 0.5], intensity: 4.5 },
    { size: [10, 14], position: [R * 0.85, R * 0.5, R * 0.5], intensity: 4.5 },
    // Rear rim pair. Light entering from behind leaves through the crown after
    // bouncing off the pavilion — this is where the fire comes from.
    { size: [9, 9], position: [-R * 0.7, R * 0.2, -R * 0.8], intensity: 3 },
    { size: [9, 9], position: [R * 0.7, R * 0.2, -R * 0.8], intensity: 3 },
    // Bounce card under the stone, as on a real bench. Weak — a bright floor
    // fills the pavilion and flattens it.
    { size: [12, 12], position: [0, -R * 0.9, 1], intensity: 1.1 },
    // Small hard sources. A big soft panel cannot produce a pinpoint; these are
    // the individual sparkles that catch as the piece turns.
    { size: [1.6, 1.6], position: [-R * 0.35, R * 0.75, R * 0.6], intensity: 26 },
    { size: [1.4, 1.4], position: [R * 0.5, R * 0.6, R * 0.55], intensity: 22 },
    { size: [1.2, 1.2], position: [R * 0.25, -R * 0.3, R * 0.85], intensity: 14 },
    { size: [1.2, 1.2], position: [-R * 0.6, R * 0.1, -R * 0.6], intensity: 16 },
];
/**
 * The tent fabric behind the panels, as linear radiance by elevation.
 *
 * `t` runs 0 at straight up to 1 at straight down. Bright above, falling off
 * below: a stone lit by a uniform grey sphere has nothing to contrast against
 * and goes flat. Neutral all the way down, so nothing tints the stone.
 *
 * ── Why the floor is this high ──────────────────────────────────────────────
 *
 * The shader samples this map exactly once per channel and multiplies white by
 * it, so a facet can never render darker than the dimmest direction here. The
 * dimmest direction is therefore the only thing that decides whether a stone
 * has black patches in it.
 *
 * Measured through the actual display path — ACES at exposure 1.4, then sRGB —
 * a floor of 0.026 bottomed out at 65/255 and put 10.3% of all directions below
 * 90/255. Nothing there is literally black, but 65 beside a neighbouring facet
 * at 254 reads as a hole, and that is the "minor black" left in the stone.
 *
 * These values put the darkest direction near 150/255 and leave nothing below
 * 90. Contrast is still ~44x against the key panel and ~140x against the hard
 * sources, which is far more than the facet-to-facet alternation needs. Going
 * much higher is the actual failure: at a floor of 0.4 the midtones collapse to
 * 3% and 97% of the sphere is bright, which is the milky glass ball.
 */
const SHELL_STOPS = [
    [0, 1.0], // ceiling of the tent
    [0.34, 0.82],
    [0.52, 0.3], // horizon
    [0.68, 0.22],
    [1, 0.12], // the bench — dim, never dark
];
/** Overall level of the surround. Above this it washes the stone out. */
const SHELL_GAIN = 0.85;
function shellRadiance(y) {
    const t = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI;
    for (let i = 0; i < SHELL_STOPS.length - 1; i++) {
        const [t0, v0] = SHELL_STOPS[i];
        const [t1, v1] = SHELL_STOPS[i + 1];
        if (t >= t0 && t <= t1) {
            const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
            return (v0 + (v1 - v0) * k) * SHELL_GAIN;
        }
    }
    return SHELL_STOPS[SHELL_STOPS.length - 1][1] * SHELL_GAIN;
}
const FRAMES = PANELS.map((panel) => {
    const [px, py, pz] = panel.position;
    const len = Math.hypot(px, py, pz);
    const nx = px / len;
    const ny = py / len;
    const nz = pz / len;
    // up x normal. Degenerate only for a panel directly overhead, where any
    // in-plane axis will do.
    let ax = -nz;
    let az = nx;
    const axLen = Math.hypot(ax, 0, az);
    if (axLen < 1e-6) {
        ax = 1;
        az = 0;
    }
    else {
        ax /= axLen;
        az /= axLen;
    }
    // normal x u, giving the second in-plane axis.
    const bx = ny * az - 0;
    const by = nz * ax - nx * az;
    const bz = -ny * ax;
    const hw = panel.size[0] / 2;
    const hh = panel.size[1] / 2;
    return {
        nx,
        ny,
        nz,
        d: px * nx + py * ny + pz * nz,
        px,
        py,
        pz,
        ux: ax / hw,
        uy: 0,
        uz: az / hw,
        vx: bx / hh,
        vy: by / hh,
        vz: bz / hh,
        intensity: panel.intensity,
    };
});
/** Softens panel edges, so a hotspot is not a hard-aliased rectangle. */
const FEATHER = 0.12;
/**
 * What a ray leaving the stone in this direction lands on, as linear radiance.
 *
 * Exported so the tent can be measured without a browser.
 */
export function tentRadiance(dx, dy, dz) {
    let nearest = Infinity;
    let weight = 0;
    let intensity = 0;
    for (let i = 0; i < FRAMES.length; i++) {
        const f = FRAMES[i];
        const facing = dx * f.nx + dy * f.ny + dz * f.nz;
        if (facing > -1e-9 && facing < 1e-9)
            continue;
        const t = f.d / facing;
        if (t <= 1e-6 || t >= nearest)
            continue;
        const rx = dx * t - f.px;
        const ry = dy * t - f.py;
        const rz = dz * t - f.pz;
        const u = Math.abs(rx * f.ux + ry * f.uy + rz * f.uz);
        const v = Math.abs(rx * f.vx + ry * f.vy + rz * f.vz);
        const edge = u > v ? u : v;
        if (edge >= 1)
            continue;
        // Full strength in the middle, fading out across the last `FEATHER`.
        nearest = t;
        weight = edge <= 1 - FEATHER ? 1 : (1 - edge) / FEATHER;
        intensity = f.intensity;
    }
    const shell = shellRadiance(dy);
    return shell * (1 - weight) + intensity * weight;
}
/*
 * Map size. Both powers of two so mipmaps generate, and small enough that the
 * whole thing is about a megabyte — this is built on the client, including on
 * the phones that are most of the traffic. At this width one texel spans about
 * 0.7 degrees, so even the small hard sources are a dozen texels across.
 */
const WIDTH = 512;
const HEIGHT = 256;
/** Samples per texel per axis. Panels have hard edges; this stops them stepping. */
const SUPERSAMPLE = 2;
/**
 * Bakes the tent into an equirectangular half-float map.
 *
 * Half-float rather than float: WebGL2 filters half-float textures natively,
 * while linear filtering of full float needs an extension that not every phone
 * has. It also holds values far above 1, which is the point — a highlight
 * clamped to white tone-maps to flat grey instead of a spark.
 *
 * Exported for measurement. Application code wants `getGemEnvironment`.
 */
export function createGemEnvironment() {
    const data = new Uint16Array(WIDTH * HEIGHT * 4);
    const step = 1 / SUPERSAMPLE;
    const samples = SUPERSAMPLE * SUPERSAMPLE;
    /*
     * Direction of each sample, as the inverse of the shader's `equirectUv`
     * (which is three's own):
     *   u = atan2(z, x) / 2pi + 0.5
     *   v = asin(y) / pi + 0.5
     * DataTexture is not flipped, so row 0 is v = 0 — straight down.
     *
     * Latitude depends only on the row and longitude only on the column, so both
     * are tabulated once per line. Evaluating them per sample instead meant six
     * million sin/cos calls, which was nearly the whole cost of the bake.
     */
    const sinLat = new Float64Array(HEIGHT * SUPERSAMPLE);
    const cosLat = new Float64Array(HEIGHT * SUPERSAMPLE);
    for (let y = 0; y < HEIGHT; y++) {
        for (let s = 0; s < SUPERSAMPLE; s++) {
            const lat = ((y + (s + 0.5) * step) / HEIGHT - 0.5) * Math.PI;
            sinLat[y * SUPERSAMPLE + s] = Math.sin(lat);
            cosLat[y * SUPERSAMPLE + s] = Math.cos(lat);
        }
    }
    const sinLon = new Float64Array(WIDTH * SUPERSAMPLE);
    const cosLon = new Float64Array(WIDTH * SUPERSAMPLE);
    for (let x = 0; x < WIDTH; x++) {
        for (let s = 0; s < SUPERSAMPLE; s++) {
            const lon = ((x + (s + 0.5) * step) / WIDTH - 0.5) * Math.PI * 2;
            sinLon[x * SUPERSAMPLE + s] = Math.sin(lon);
            cosLon[x * SUPERSAMPLE + s] = Math.cos(lon);
        }
    }
    const alpha = THREE.DataUtils.toHalfFloat(1);
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            let total = 0;
            for (let sy = 0; sy < SUPERSAMPLE; sy++) {
                const ky = y * SUPERSAMPLE + sy;
                const sLat = sinLat[ky];
                const cLat = cosLat[ky];
                for (let sx = 0; sx < SUPERSAMPLE; sx++) {
                    const kx = x * SUPERSAMPLE + sx;
                    total += tentRadiance(cosLon[kx] * cLat, sLat, sinLon[kx] * cLat);
                }
            }
            const value = THREE.DataUtils.toHalfFloat(total / samples);
            const i = (y * WIDTH + x) * 4;
            // Neutral: a diamond takes its colour from the stone, never the tent.
            data[i] = value;
            data[i + 1] = value;
            data[i + 2] = value;
            data[i + 3] = alpha;
        }
    }
    const texture = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat, THREE.HalfFloatType);
    // Equirect, matching what the shader's non-cube branch expects.
    texture.mapping = THREE.EquirectangularReflectionMapping;
    // The values are already linear radiance, so no colour-space conversion.
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping; // longitude wraps
    texture.wrapT = THREE.ClampToEdgeWrapping; // latitude does not
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
}
let cached = null;
/**
 * The tent, baked once for the life of the page.
 *
 * It depends on nothing — not the piece, not the renderer — so re-baking it per
 * model would repeat a quarter-second of arithmetic on every upload, on the
 * phones that are most of the traffic. One megabyte held for the session is the
 * cheaper trade, and it is never disposed precisely because a later model would
 * then be handed a dead texture.
 */
export function getGemEnvironment() {
    if (!cached)
        cached = createGemEnvironment();
    return cached;
}

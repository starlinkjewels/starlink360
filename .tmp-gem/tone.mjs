import { tentRadiance } from "./gemEnvironment.js";

/* three's ACESFilmicToneMapping, scalar form (the matrices are luminance-
 * preserving for neutrals), then sRGB encode. This is what actually reaches
 * the screen — linear radiance alone says nothing about perceived black. */
const EXPOSURE = 1.4;
const aces = (c) => {
  c *= EXPOSURE / 0.6;
  const a = c * (c + 0.0245786) - 0.000090537;
  const b = c * (0.983729 * c + 0.432951) + 0.238081;
  return Math.min(1, Math.max(0, a / b));
};
const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const screen = (r) => Math.round(srgb(aces(r)) * 255);

const N = 200000, GA = Math.PI * (3 - Math.sqrt(5));
const out = [];
for (let i = 0; i < N; i++) {
  const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = GA * i;
  out.push(screen(tentRadiance(Math.cos(th) * r, y, Math.sin(th) * r)));
}
out.sort((a, b) => a - b);
const pc = (f) => ((out.filter(f).length / N) * 100).toFixed(1);
const q = (p) => out[Math.floor(N * p)];
console.log(`  on screen, 0-255:  min ${out[0]}  p05 ${q(0.05)}  median ${q(0.5)}  p95 ${q(0.95)}  max ${out[N-1]}`);
console.log(`  reads as black  (<40)   ${pc(v => v < 40)}%`);
console.log(`  reads as dark   (40-90) ${pc(v => v >= 40 && v < 90)}%`);
console.log(`  reads as mid    (90-180)${pc(v => v >= 90 && v < 180)}%`);
console.log(`  reads as bright (>=180) ${pc(v => v >= 180)}%`);

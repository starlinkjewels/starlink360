/* Re-implements the shell so the floor can be swept without editing source. */
import { tentRadiance } from "./gemEnvironment.js";

const EXPOSURE = 1.4;
const aces = (c) => { c *= EXPOSURE / 0.6;
  const a = c * (c + 0.0245786) - 0.000090537, b = c * (0.983729 * c + 0.432951) + 0.238081;
  return Math.min(1, Math.max(0, a / b)); };
const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const screen = (r) => Math.round(srgb(aces(r)) * 255);

const GAIN = 0.85;
const base = [[0,1.0],[0.34,0.82],[0.52,0.27],[0.68,0.093],[1,0.026]];
function shell(stops, y) {
  const t = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI;
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0,v0] = stops[i], [t1,v1] = stops[i+1];
    if (t >= t0 && t <= t1) return (v0 + (v1-v0)*((t-t0)/(t1-t0))) * GAIN;
  }
  return stops[stops.length-1][1] * GAIN;
}

const N = 120000, GA = Math.PI * (3 - Math.sqrt(5));
const dirs = [];
for (let i = 0; i < N; i++) {
  const y = 1 - (i/(N-1))*2, r = Math.sqrt(Math.max(0,1-y*y)), th = GA*i;
  dirs.push([Math.cos(th)*r, y, Math.sin(th)*r]);
}

// Panel contribution is whatever tentRadiance returns above its own shell.
const panelOf = (d) => { const s = shell(base, d[1]); const v = tentRadiance(d[0],d[1],d[2]); return v > s + 1e-9 ? v : null; };
const panels = dirs.map(panelOf);

console.log("  floor(0.68/1.0)   min  p05  median   dark<90   mid   bright>=180  contrast");
for (const [a, b] of [[0.093,0.026],[0.16,0.075],[0.22,0.12],[0.30,0.18],[0.40,0.26]]) {
  const stops = [[0,1.0],[0.34,0.82],[0.52,0.30],[0.68,a],[1,b]];
  const vals = dirs.map((d,i) => panels[i] ?? shell(stops, d[1]));
  const px = vals.map(screen).sort((x,y)=>x-y);
  const lin = [...vals].sort((x,y)=>x-y);
  const q = (p) => px[Math.floor(N*p)];
  const pc = (f) => ((px.filter(f).length/N)*100).toFixed(1).padStart(5);
  console.log(`  ${String(a).padEnd(6)}${String(b).padEnd(8)} ${String(px[0]).padStart(4)} ${String(q(0.05)).padStart(4)} ${String(q(0.5)).padStart(6)} ` +
    `${pc(v=>v<90)}% ${pc(v=>v>=90&&v<180)}% ${pc(v=>v>=180)}%   ` +
    `${(lin[Math.floor(N*0.95)]/Math.max(lin[Math.floor(N*0.02)],1e-6)).toFixed(0)}x`);
}

import * as THREE from "three";
import { createGemEnvironment, getGemEnvironment, tentRadiance } from "./gemEnvironment.js";
const t0 = Date.now();
const tex = createGemEnvironment();
const ms = Date.now() - t0;
const { data, width, height } = tex.image;
console.log(`  baked ${width}x${height} in ${ms}ms · ${(data.byteLength/1048576).toFixed(2)} MB`);
console.log(`  mapping ${tex.mapping === THREE.EquirectangularReflectionMapping ? "Equirectangular ✓" : "WRONG ✗"}` +
  ` · colorSpace ${tex.colorSpace === THREE.LinearSRGBColorSpace ? "linear ✓" : "WRONG ✗"}` +
  ` · type ${tex.type === THREE.HalfFloatType ? "half-float ✓" : "WRONG ✗"}` +
  ` · mipmaps ${tex.generateMipmaps ? "on ✓" : "off ✗"}`);
const px = [];
for (let i = 0; i < data.length; i += 4) px.push(THREE.DataUtils.fromHalfFloat(data[i]));
px.sort((a,b)=>a-b);
const N = px.length, q = p => px[Math.floor(N*p)];
console.log(`  linear: min ${px[0].toFixed(3)} p05 ${q(0.05).toFixed(3)} p95 ${q(0.95).toFixed(2)} max ${px[N-1].toFixed(1)}`);
const row = y => { let s=0; for (let x=0;x<width;x++) s += THREE.DataUtils.fromHalfFloat(data[(y*width+x)*4]); return s/width; };
console.log(`  orientation: down ${row(0).toFixed(2)} / up ${row(height-1).toFixed(2)} → ${row(height-1) > row(0)*3 ? "ceiling bright ✓" : "INVERTED ✗"}`);
console.log(`  greyscale: ${data.every((v,i)=> i%4===3 || v===data[i-(i%4)]) ? "neutral ✓" : "TINTED ✗"}`);
console.log(`  finite: ${px.every(Number.isFinite) ? "all ✓" : "NaN ✗"}`);
console.log(`  cached getter returns same object: ${getGemEnvironment() === getGemEnvironment() ? "✓" : "✗"}`);

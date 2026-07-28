import * as THREE from "three";
import { useMemo } from "react";

/**
 * Procedural stand-in used when a product GLB is not available.
 * Follows the same convention as the real assets: a `metal` mesh and a `gem` mesh.
 */
export function buildFallbackScene() {
  const group = new THREE.Group();

  const halo = new THREE.TorusGeometry(1, 0.14, 48, 180);
  const bail = new THREE.TorusGeometry(0.28, 0.07, 32, 96);
  bail.translate(0, 1.28, 0);
  const merged = mergeGeometries([halo, bail]);
  const metal = new THREE.Mesh(merged, new THREE.MeshPhysicalMaterial());
  metal.name = "metal";

  const gemGeo = brilliantGeometry(0.72);
  const gem = new THREE.Mesh(gemGeo, new THREE.MeshPhysicalMaterial());
  gem.name = "gem";

  group.add(metal, gem);
  return group;
}

export function useFallbackScene() {
  return useMemo(() => buildFallbackScene(), []);
}

function brilliantGeometry(radius: number) {
  // Crown + pavilion approximation of a round brilliant cut.
  const crown = new THREE.ConeGeometry(radius, radius * 0.42, 16, 1);
  crown.rotateX(Math.PI);
  crown.translate(0, radius * 0.21, 0);
  const pavilion = new THREE.ConeGeometry(radius, radius * 0.9, 16, 1);
  pavilion.translate(0, -radius * 0.45, 0);
  const geo = mergeGeometries([crown, pavilion]);
  geo.rotateX(Math.PI / 2);
  return geo;
}

function mergeGeometries(geometries: THREE.BufferGeometry[]) {
  const positions: number[] = [];
  for (const g of geometries) {
    const nonIndexed = g.index ? g.toNonIndexed() : g;
    const arr = nonIndexed.getAttribute("position").array;
    for (let i = 0; i < arr.length; i++) positions.push(arr[i]);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  out.computeVertexNormals();
  return out;
}

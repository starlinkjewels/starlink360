import * as THREE from "three";
import type { Finish } from "@/data/finishes";

export function createMetalMaterial(finish: Finish) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(finish.color),
    metalness: 1.0,
    roughness: finish.roughness,
    envMapIntensity: 2.8,
    clearcoat: 0.18,
    clearcoatRoughness: 0.06,
    reflectivity: 1.0,
  });
}

export function createGemMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#ffffff"),
    metalness: 0,
    roughness: 0.01,
    transmission: 1.0,
    ior: 2.42,
    thickness: 0.55,
    envMapIntensity: 4.2,
    specularIntensity: 1.8,
    specularColor: new THREE.Color("#ffffff"),
    attenuationColor: new THREE.Color("#fefefe"),
    attenuationDistance: 1.6,
    transparent: true,
    side: THREE.DoubleSide,
  });
}

/** Sharp, flat-shaded facets so the stone sparkles like a real brilliant. */
export function facetGeometry(geometry: THREE.BufferGeometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  return g;
}

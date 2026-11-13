// Teardown kit: the shared material palette and ink outlines.
// Glossy white shells, graphite joints, one orange accent that means "working".
import * as THREE from 'three';
import { INK, ACCENT } from './stage.js';

export const MAT = {
  shell: () => new THREE.MeshPhysicalMaterial({ color: 0xf6f4f0, roughness: 0.34, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.22, envMapIntensity: 0.7 }),
  graphite: () => new THREE.MeshPhysicalMaterial({ color: 0x1c1f23, roughness: 0.32, metalness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.6 }),
  orange: () => new THREE.MeshPhysicalMaterial({ color: ACCENT, roughness: 0.38, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.3, envMapIntensity: 0.6 }),
  steel: () => new THREE.MeshPhysicalMaterial({ color: 0xc8ccd1, roughness: 0.42, metalness: 0.75, envMapIntensity: 0.6 }),
};

// Thin ink edges on a mesh, the study-model look. Returns the edge lines.
export function addInk(mesh, threshold = 30, opacity = 0.55) {
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, threshold), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity }));
  e.userData.ink = true;
  e.raycast = () => {};
  mesh.add(e);
  return e;
}

// Same, but returns the mesh so it can be built inline: inked(new Mesh(...)).
export function inked(mesh, threshold = 35, opacity = 0.5) {
  addInk(mesh, threshold, opacity);
  return mesh;
}

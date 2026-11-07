// Teardown kit: merge parts that never move relative to their group into one draw call
// per material, and fold every ink outline in the group into one line object.
// A study model is hundreds of small meshes; on an integrated GPU the draw calls, not
// the triangles, are what drop the frame rate.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const keepOnly = (g, names) => {
  const out = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(out.attributes)) if (!names.includes(k)) out.deleteAttribute(k);
  out.morphAttributes = {};
  return out;
};

// skip(mesh) -> true keeps a mesh (and everything under it) as it is: moving parts,
// parts with their own animated material, textured parts.
export function mergeStatic(group, { skip = () => false, inkOpacity = 0.5, inkColor = 0x1d2024 } = {}) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const buckets = new Map(); // material -> [geometry]
  const inks = [];
  const removed = [];
  const skipped = new Set();
  group.traverse((o) => {
    if (o === group) return;
    if (skipped.has(o.parent) || (o.isMesh && skip(o)) || (!o.isMesh && !o.isLine && o.children.length && skip(o))) { skipped.add(o); return; }
    if (o.isInstancedMesh || !o.isMesh) return;
    if (o.material.map || Array.isArray(o.material)) { skipped.add(o); return; }
    const kids = o.children.filter((c) => !c.userData.ink);
    if (kids.length) { skipped.add(o); return; } // has parts of its own: leave it
    rel.multiplyMatrices(inv, o.matrixWorld);
    const g = keepOnly(o.geometry, ['position', 'normal']).applyMatrix4(rel);
    if (!buckets.has(o.material)) buckets.set(o.material, { geos: [], sys: o.userData.sys, cast: false, receive: false });
    const bk = buckets.get(o.material);
    bk.geos.push(g); bk.cast ||= o.castShadow; bk.receive ||= o.receiveShadow;
    for (const c of o.children) if (c.userData.ink) inks.push(keepOnly(c.geometry, ['position']).applyMatrix4(rel));
    removed.push(o);
  });
  let before = removed.length, after = 0;
  for (const o of removed) o.parent.remove(o);
  for (const [mat, bk] of buckets) {
    const m = new THREE.Mesh(mergeGeometries(bk.geos, false), mat);
    m.castShadow = bk.cast; m.receiveShadow = bk.receive; m.userData.sys = bk.sys; m.userData.merged = true;
    group.add(m); after++;
    bk.geos.forEach((g) => g.dispose());
  }
  if (inks.length) {
    const l = new THREE.LineSegments(mergeGeometries(inks, false), new THREE.LineBasicMaterial({ color: inkColor, transparent: true, opacity: inkOpacity }));
    l.userData.ink = true; l.raycast = () => {};
    group.add(l); after++;
    inks.forEach((g) => g.dispose());
  }
  return { meshesIn: before, inkIn: inks.length, objectsOut: after };
}

// Numbered callouts with thin leader lines into the parts they name.
import { HOTSPOTS } from '../model/data.js';
import { terrainHeight } from '../scene/util.js';

export class Callouts {
  constructor(engine, layer, svg, onPick) {
    this.e = engine; this.layer = layer; this.svg = svg; this.visible = true;
    this.items = HOTSPOTS.map((h) => {
      const el = document.createElement('button');
      el.className = 'callout';
      el.innerHTML = `<b>${h.n}</b>${h.title}`;
      el.addEventListener('click', (ev) => { ev.stopPropagation(); onPick(h.id); });
      layer.appendChild(el);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('r', '2.5');
      svg.append(line, dot);
      return { h, el, line, dot, sx: 0, sy: 0, init: false };
    });
    this.active = null;
  }

  setActive(id) { this.active = id; this.items.forEach((it) => it.el.classList.toggle('on', it.h.id === id)); }
  setVisible(v) { this.visible = v; this.update(true); }

  update(force) {
    const e = this.e;
    if (!force && e.frame % 2) return; // panels redrawn every other frame
    const r = e.canvas.getBoundingClientRect();
    const cx = r.width / 2, cy = r.height / 2;
    const anchors = e.S.anchors;
    anchors.lake.y = e.uniforms.uWaterY.value + 2;
    anchors.tailrace.y = e.river.mesh.position.y + 2;
    const hidden = !this.visible || e.mode === 'build';
    const live = [];
    for (const it of this.items) {
      const a = anchors[it.h.id];
      const p = e.project(a);
      const off = p.behind || p.x < -40 || p.y < -40 || p.x > r.width + 40 || p.y > r.height + 40;
      const show = !hidden && (r.width <= 900 || !off);
      it.el.style.display = show ? '' : 'none';
      it.line.style.display = it.dot.style.display = show ? '' : 'none';
      if (!show) continue;
      // label sits out from the anchor, away from the screen centre
      let dx = p.x - cx, dy = p.y - cy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      it.tx = p.x + dx * 46 + (dx > 0 ? 40 : -40); it.ty = p.y + dy * 40 - 24;
      it.w = it.el.offsetWidth || 140; it.p = p;
      // cheap occlusion: sample the analytic canyon height along the sight line
      if ((e.frame + it.h.n) % 12 === 0) {
        const c = e.camera.position; let hidden = false;
        for (let k = 1; k < 24; k++) { const t = k / 24; const x = c.x + (a.x - c.x) * t, y = c.y + (a.y - c.y) * t, z = c.z + (a.z - c.z) * t; if (terrainHeight(x, z) > y + 4) { hidden = true; break; } }
        it.occluded = hidden;
      }
      live.push(it);
    }
    // relax overlapping labels apart vertically
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
        const A = live[i], B = live[j];
        const ox = (A.w + B.w) / 2 + 6 - Math.abs(A.tx - B.tx), oy = 30 - Math.abs(A.ty - B.ty);
        if (ox > 0 && oy > 0) { const s = A.ty <= B.ty ? -1 : 1; A.ty += s * oy / 2; B.ty -= s * oy / 2; }
      }
    }
    // Keep projected controls outside fixed panels and other callouts. The phone
    // layout is a normal wrapping control list, so it needs no projection repair.
    const occupied = r.width > 900 ? [...document.querySelectorAll('.hud > *, .topbar > *')]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      .map((el) => { const b = el.getBoundingClientRect(); return { left: b.left-r.left, right: b.right-r.left, top: b.top-r.top, bottom: b.bottom-r.top }; }) : [];
    for (const it of live) {
      const p = it.p;
      if (!it.init) { it.sx = it.tx; it.sy = it.ty; it.init = true; }
      it.sx += (it.tx - it.sx) * 0.25; it.sy += (it.ty - it.sy) * 0.25;
      if (r.width > 900) {
        const hw = it.w / 2, hh = Math.max(28, it.el.offsetHeight) / 2;
        const box = (x, y) => ({ left: x-hw-3, right: x+hw+3, top: y-hh-3, bottom: y+hh+3 });
        const clear = (b) => !occupied.some((o) => b.left < o.right && b.right > o.left && b.top < o.bottom && b.bottom > o.top);
        let best = null, score = Infinity;
        for (let y = hh+8; y < r.height-hh-8; y += 34) {
          for (let x = hw+8; x < r.width-hw-8; x += 40) {
            const d = (x-it.sx)**2 + (y-it.sy)**2;
            if (d < score && clear(box(x,y))) { best = { x, y }; score = d; }
          }
        }
        if (best) { it.sx = best.x; it.sy = best.y; }
        occupied.push(box(it.sx, it.sy));
      }
      it.el.style.left = `${it.sx}px`; it.el.style.top = `${it.sy}px`;
      it.line.setAttribute('x1', p.x); it.line.setAttribute('y1', p.y); it.line.setAttribute('x2', it.sx); it.line.setAttribute('y2', it.sy);
      it.dot.setAttribute('cx', p.x); it.dot.setAttribute('cy', p.y);
      it.el.classList.toggle('dim', !!(e.focus && this.sysFor(it.h.id) !== e.focus) || !!it.occluded);
    }
  }

  sysFor(id) { return { dam: 'dam', crest: 'dam', towers: 'towers', penstocks: 'penstocks', powerhouse: 'powerhouse', spillways: 'spillways', tunnels: 'tunnels', bridge: 'bridge', lake: 'lake', tailrace: 'powerhouse' }[id]; }
}

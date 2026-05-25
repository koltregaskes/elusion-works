/* Solar System Field Lab — 3D Orbit Lab (Three.js)
   Modes: compressed | log | honest
   Camera modes: idle (auto-orbit when not dragging) | flyby (cinematic) | free (user fully drives) | follow:KEY
*/
/* eslint-disable */

const { useEffect, useRef, useState } = React;

const OrbitLab = ({
  mode = 'compressed',
  speed = 1,
  paused = false,
  cameraMode = 'idle',        // 'idle' | 'flyby' | 'free' | 'follow:KEY'
  flybyTarget = null,         // for HUD; set by flyby loop
  onFlybyChange = null,       // (key) => void — fires when flyby switches target
  onPlanetClick = null,       // (key) => void
  className = '',
  style = {},
  fullscreen = false,
  onLoaded = null,
}) => {
  const mountRef = useRef(null);
  const stateRef = useRef(null);
  const [hover, setHover] = useState(null);
  const propsRef = useRef({ mode, speed, paused, cameraMode, fullscreen });
  propsRef.current = { mode, speed, paused, cameraMode, fullscreen };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !window.THREE) return;
    const THREE = window.THREE;

    const W = () => mount.clientWidth;
    const H = () => mount.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, W()/H(), 0.005, 1000);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W(), H());
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    // ---- starfield (Points) ----
    const starGeom = makeStarsField(2200, 90);
    const stars = new THREE.Points(
      starGeom,
      new THREE.PointsMaterial({
        size: 0.14, vertexColors: true, opacity: 0.7,
        transparent: true, sizeAttenuation: true, depthWrite: false,
      })
    );
    scene.add(stars);

    // ---- sun ----
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xfac86a });
    const sun = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), sunMat);
    scene.add(sun);
    const sunGlowTex = makeGlowTexture(0xfac86a);
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunGlowTex, color: 0xffd07a, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    scene.add(sunGlow);
    const sunGlow2 = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(0xff8c2a), color: 0xff8c2a, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    scene.add(sunGlow2);

    // ---- lights ----
    scene.add(new THREE.AmbientLight(0x506488, 0.35));   // cool dark fill (space)
    const pointLight = new THREE.PointLight(0xfff0d0, 320, 0, 2);
    pointLight.position.set(0, 0, 0);
    scene.add(pointLight);

    // ---- planets + orbits ----
    const planetMeshes = [];
    const planetGlows  = [];
    const orbitLines = [];
    const angles = PLANETS.map(() => Math.random() * Math.PI * 2);

    PLANETS.forEach((p, i) => {
      const size = planetVisualSize(p);
      const tex = makePlanetTexture(p.palette, p.family);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.85,
        metalness: 0.0,
        emissive: 0x000000,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 48, 48), mat);
      mesh.userData = { planet: p, index: i, size };

      // axial tilt
      const tilt = (p.axialDeg || 0) * Math.PI / 180;
      mesh.rotation.z = tilt;

      // rings (Saturn / faint Uranus)
      if (p.rings || p.key === 'uranus') {
        const inner = p.key === 'uranus' ? size * 1.6 : size * 1.45;
        const outer = p.key === 'uranus' ? size * 2.1 : size * 2.5;
        const ringGeom = new THREE.RingGeometry(inner, outer, 96);
        const uv = ringGeom.attributes.uv;
        const pos2 = ringGeom.attributes.position;
        for (let j = 0; j < uv.count; j++) {
          const x = pos2.getX(j), y = pos2.getY(j);
          const r = Math.sqrt(x*x + y*y);
          const t = (r - inner) / (outer - inner);
          uv.setXY(j, t, 0.5);
        }
        const ringMat = new THREE.MeshBasicMaterial({
          map: makeSaturnRingTexture(),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: p.key === 'uranus' ? 0.35 : 0.9,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.rotation.y = -0.4;
        mesh.add(ring);
      }

      // glow halo
      if (p.glow) {
        const glowTex = makeGlowTexture(p.color);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTex, color: p.color, transparent: true, opacity: 0.35,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        glow.scale.setScalar(size * 4);
        mesh.add(glow);
        planetGlows.push(glow);
      }

      scene.add(mesh);
      planetMeshes.push(mesh);

      // orbit line
      const lineGeom = new THREE.BufferGeometry();
      const lineMat = new THREE.LineBasicMaterial({
        color: p.accent ? 0xf3a14a : 0x8a9bc4,
        transparent: true,
        opacity: p.accent ? 0.5 : 0.15,
      });
      const line = new THREE.LineLoop(lineGeom, lineMat);
      scene.add(line);
      orbitLines.push({ line, geom: lineGeom, planet: p });
    });

    // ---- state ----
    const initialMode = propsRef.current.mode;
    const s = {
      currentRadii: PLANETS.map((_, i) => MODES[initialMode].radiusFor(i)),
      currentSunSize: MODES[initialMode].sunSize,
      currentCamDist: MODES[initialMode].camDist,
      currentCamElev: MODES[initialMode].camElev,
      modeFromRadii: null,
      modeToRadii: null,
      modeFromSun: 0, modeToSun: 0,
      modeFromDist: 0, modeToDist: 0,
      modeFromElev: 0, modeToElev: 0,
      modeT: 1,
      activeMode: initialMode,
      camAzimuth: -0.3,
      lastInteract: 0,
      dragging: false,
      lastPointer: null,
      pointerDownAt: 0,
      pointerDownPos: null,
      camZoomTarget: MODES[initialMode].camDist,

      // cinematic flyby state
      flybyIdx: 0,
      flybyPhase: 'approach',   // approach | dwell | depart
      flybyT: 0,
      flybyStart: null,         // {pos, look}
      flybyTarget: null,        // {pos, look}
      flybyCurrent: { pos: new THREE.Vector3(), look: new THREE.Vector3() },
      flybyOrder: ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'],

      // smooth target position (lerped)
      camPos: new THREE.Vector3(),
      camLook: new THREE.Vector3(0,0,0),

      activeCameraMode: propsRef.current.cameraMode,
    };

    const updateOrbitLines = () => {
      orbitLines.forEach((o, i) => {
        const r = s.currentRadii[i];
        const pts = [];
        const SEGS = 128;
        for (let a = 0; a <= SEGS; a++) {
          const t = (a / SEGS) * Math.PI * 2;
          pts.push(new THREE.Vector3(r * Math.cos(t), 0, r * Math.sin(t)));
        }
        o.geom.setFromPoints(pts);
      });
    };
    updateOrbitLines();

    const placePlanets = () => {
      for (let i = 0; i < planetMeshes.length; i++) {
        const r = s.currentRadii[i];
        const a = angles[i];
        planetMeshes[i].position.set(r * Math.cos(a), 0, r * Math.sin(a));
      }
      sun.scale.setScalar(s.currentSunSize);
      sunGlow.scale.setScalar(s.currentSunSize * 4.5);
      sunGlow2.scale.setScalar(s.currentSunSize * 8);
    };
    placePlanets();

    // initial camera placement
    s.camPos.set(
      Math.sin(s.camAzimuth) * Math.cos(s.currentCamElev) * s.currentCamDist,
      Math.sin(s.currentCamElev) * s.currentCamDist,
      Math.cos(s.camAzimuth) * Math.cos(s.currentCamElev) * s.currentCamDist,
    );
    camera.position.copy(s.camPos);
    camera.lookAt(0, 0, 0);

    // ---- interaction ----
    const dom = renderer.domElement;
    dom.style.cursor = 'grab';
    dom.style.touchAction = 'none';

    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2();

    const onPointerDown = (e) => {
      s.dragging = true;
      s.lastPointer = { x: e.clientX, y: e.clientY };
      s.pointerDownAt = performance.now();
      s.pointerDownPos = { x: e.clientX, y: e.clientY };
      s.lastInteract = performance.now();
      dom.style.cursor = 'grabbing';
      try { dom.setPointerCapture(e.pointerId); } catch(_){}
    };
    const onPointerUp = (e) => {
      const wasDragging = s.dragging;
      s.dragging = false;
      dom.style.cursor = 'grab';
      try { dom.releasePointerCapture(e.pointerId); } catch(_){}
      // detect click (vs drag): minimal movement + quick release
      if (wasDragging && s.pointerDownPos) {
        const dx = e.clientX - s.pointerDownPos.x;
        const dy = e.clientY - s.pointerDownPos.y;
        const dt = performance.now() - s.pointerDownAt;
        if (Math.sqrt(dx*dx + dy*dy) < 5 && dt < 400) {
          // raycast for click
          const rect = dom.getBoundingClientRect();
          mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(mouseNDC, camera);
          const hits = raycaster.intersectObjects(planetMeshes, false);
          if (hits.length > 0) {
            const planet = hits[0].object.userData.planet;
            if (onPlanetClick) onPlanetClick(planet.key);
          }
        }
      }
    };
    const onPointerMove = (e) => {
      const rect = dom.getBoundingClientRect();
      if (s.dragging && s.lastPointer) {
        const dx = e.clientX - s.lastPointer.x;
        const dy = e.clientY - s.lastPointer.y;
        s.camAzimuth -= dx * 0.006;
        s.currentCamElev = Math.max(0.05, Math.min(1.4, s.currentCamElev - dy * 0.005));
        s.lastPointer = { x: e.clientX, y: e.clientY };
        s.lastInteract = performance.now();
      }
      // hover
      mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouseNDC, camera);
      const hits = raycaster.intersectObjects(planetMeshes, false);
      if (hits.length > 0) {
        const p = hits[0].object.userData.planet;
        setHover({
          name: p.name, au: p.realAU, diam: p.diamKm,
          x: e.clientX - rect.left, y: e.clientY - rect.top,
          color: p.cssColor,
        });
        dom.style.cursor = onPlanetClick ? 'pointer' : 'grab';
      } else {
        setHover(null);
        dom.style.cursor = s.dragging ? 'grabbing' : 'grab';
      }
    };
    const onPointerLeave = () => { setHover(null); s.dragging = false; dom.style.cursor = 'grab'; };
    const onWheel = (e) => {
      e.preventDefault();
      const minZ = propsRef.current.fullscreen ? 0.6 : 2.5;
      const maxZ = propsRef.current.fullscreen ? 90 : 60;
      s.camZoomTarget = Math.max(minZ, Math.min(maxZ, s.camZoomTarget * (1 + e.deltaY * 0.0012)));
      s.lastInteract = performance.now();
    };
    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('pointermove', onPointerMove);
    dom.addEventListener('pointerleave', onPointerLeave);
    dom.addEventListener('pointercancel', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    // ---- helpers ----
    const earthOmega = (2 * Math.PI) / 12; // 12s per orbit at speed=1

    const targetPositionFor = (key) => {
      if (key === 'sun') return new THREE.Vector3(0,0,0);
      const idx = PLANETS.findIndex(p => p.key === key);
      if (idx < 0) return new THREE.Vector3(0,0,0);
      return planetMeshes[idx].position.clone();
    };

    const planetSizeFor = (key) => {
      if (key === 'sun') return s.currentSunSize;
      const idx = PLANETS.findIndex(p => p.key === key);
      if (idx < 0) return 0.2;
      return planetMeshes[idx].userData.size;
    };

    // pick a nice camera POS for a flyby target
    // returns {pos, look}
    const flybyShotFor = (key, t) => {
      const targetPos = targetPositionFor(key);
      const size = planetSizeFor(key);
      // approach distance scaled to size
      const approachDist = Math.max(0.7, size * 6);
      // orbit around target by `t` (advances during dwell)
      const angle = t * 1.4 + (key.length * 0.7);
      const elev  = 0.18 + Math.sin(t * 0.6) * 0.12;
      const offset = new THREE.Vector3(
        Math.cos(angle) * approachDist * Math.cos(elev),
        approachDist * Math.sin(elev) + size * 0.2,
        Math.sin(angle) * approachDist * Math.cos(elev),
      );
      return {
        pos: targetPos.clone().add(offset),
        look: targetPos,
      };
    };

    const wideShot = () => {
      const angle = (performance.now() * 0.00007);
      const r = s.activeMode === 'honest' ? 20 : 9;
      return {
        pos: new THREE.Vector3(
          Math.cos(angle) * r,
          r * 0.5,
          Math.sin(angle) * r,
        ),
        look: new THREE.Vector3(0,0,0),
      };
    };

    const advanceFlyby = (dt) => {
      // sequence: approach (1.2s) -> dwell (3.2s) -> depart (1s) -> next
      const phaseDur = { approach: 1.6, dwell: 3.6, depart: 1.0 };
      s.flybyT += dt;
      const dur = phaseDur[s.flybyPhase];
      if (s.flybyT >= dur) {
        s.flybyT = 0;
        if (s.flybyPhase === 'approach') s.flybyPhase = 'dwell';
        else if (s.flybyPhase === 'dwell') s.flybyPhase = 'depart';
        else {
          s.flybyPhase = 'approach';
          s.flybyIdx = (s.flybyIdx + 1) % s.flybyOrder.length;
          if (onFlybyChange) onFlybyChange(s.flybyOrder[s.flybyIdx]);
        }
      }
      const key = s.flybyOrder[s.flybyIdx];
      const nextKey = s.flybyOrder[(s.flybyIdx + 1) % s.flybyOrder.length];

      let target, blend;
      if (s.flybyPhase === 'approach') {
        // glide from wide shot to close
        const wide = wideShot();
        const close = flybyShotFor(key, 0);
        const a = easeInOutCubic(s.flybyT / phaseDur.approach);
        target = {
          pos: wide.pos.clone().lerp(close.pos, a),
          look: wide.look.clone().lerp(close.look, a),
        };
      } else if (s.flybyPhase === 'dwell') {
        target = flybyShotFor(key, s.flybyT);
      } else {
        // depart toward next target's wide
        const close = flybyShotFor(key, phaseDur.dwell);
        const wide = wideShot();
        const a = easeInOutCubic(s.flybyT / phaseDur.depart);
        target = {
          pos: close.pos.clone().lerp(wide.pos, a),
          look: close.look.clone().lerp(wide.look, a),
        };
      }
      return target;
    };

    let raf, lastT = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      const { mode: pMode, speed: pSpeed, paused: pPaused, cameraMode: pCam } = propsRef.current;

      // mode change handling
      if (pMode !== s.activeMode) {
        s.activeMode = pMode;
        s.modeFromRadii = [...s.currentRadii];
        s.modeToRadii = PLANETS.map((_, i) => MODES[pMode].radiusFor(i));
        s.modeFromSun = s.currentSunSize; s.modeToSun = MODES[pMode].sunSize;
        s.modeFromDist = s.currentCamDist; s.modeToDist = MODES[pMode].camDist;
        s.modeFromElev = s.currentCamElev; s.modeToElev = MODES[pMode].camElev;
        s.modeT = 0;
        s.camZoomTarget = MODES[pMode].camDist;
      }
      if (s.modeT < 1) {
        s.modeT = Math.min(1, s.modeT + dt * 1.1);
        const e = easeOutCubic(s.modeT);
        for (let i = 0; i < PLANETS.length; i++) {
          s.currentRadii[i] = s.modeFromRadii[i] + (s.modeToRadii[i] - s.modeFromRadii[i]) * e;
        }
        s.currentSunSize = s.modeFromSun + (s.modeToSun - s.modeFromSun) * e;
        s.currentCamDist = s.modeFromDist + (s.modeToDist - s.modeFromDist) * e;
        s.currentCamElev = s.modeFromElev + (s.modeToElev - s.modeFromElev) * e;
        s.camZoomTarget = s.currentCamDist;
        updateOrbitLines();
      } else {
        const diff = s.camZoomTarget - s.currentCamDist;
        if (Math.abs(diff) > 0.001) s.currentCamDist += diff * 0.15;
      }

      // cam mode change handling — when leaving flyby, reset zoom
      if (pCam !== s.activeCameraMode) {
        if (s.activeCameraMode === 'flyby' && pCam !== 'flyby') {
          // reset to mode default
          s.currentCamDist = MODES[s.activeMode].camDist;
          s.currentCamElev = MODES[s.activeMode].camElev;
          s.camZoomTarget = s.currentCamDist;
          s.camAzimuth = -0.3;
        }
        if (pCam === 'flyby') {
          s.flybyIdx = 0; s.flybyPhase = 'approach'; s.flybyT = 0;
          if (onFlybyChange) onFlybyChange(s.flybyOrder[0]);
        }
        s.activeCameraMode = pCam;
      }

      // planet revolutions
      if (!pPaused) {
        for (let i = 0; i < PLANETS.length; i++) {
          const ratio = Math.pow(365 / PLANETS[i].periodDays, 0.35);
          angles[i] += earthOmega * ratio * pSpeed * dt;
          planetMeshes[i].rotation.y += dt * 0.6 * pSpeed * (PLANETS[i].key === 'venus' ? -1 : 1);
        }
      }
      placePlanets();

      // sun pulse
      const pulse = 1 + Math.sin(now * 0.0011) * 0.025;
      sunGlow.scale.setScalar(s.currentSunSize * 4.5 * pulse);

      // ---- camera ----
      const isDraggingMode = (pCam === 'free' || pCam === 'idle');
      let desiredPos, desiredLook;

      if (pCam === 'flyby' && !s.dragging) {
        const t = advanceFlyby(dt);
        desiredPos = t.pos;
        desiredLook = t.look;
      } else if (pCam.startsWith('follow:')) {
        const key = pCam.split(':')[1];
        const tp = targetPositionFor(key);
        const size = planetSizeFor(key);
        const followDist = Math.max(1, size * 8);
        // orbit camera around target
        const az = s.camAzimuth;
        const el = s.currentCamElev;
        desiredPos = new THREE.Vector3(
          tp.x + Math.sin(az) * Math.cos(el) * followDist,
          tp.y + Math.sin(el) * followDist,
          tp.z + Math.cos(az) * Math.cos(el) * followDist,
        );
        desiredLook = tp.clone();
        // auto-rotate around target when idle
        if (!s.dragging && now - s.lastInteract > 1200) s.camAzimuth += dt * 0.12;
      } else {
        // idle / free — orbit around origin
        const az = s.camAzimuth;
        const el = s.currentCamElev;
        const d  = s.currentCamDist;
        desiredPos = new THREE.Vector3(
          Math.sin(az) * Math.cos(el) * d,
          Math.sin(el) * d,
          Math.cos(az) * Math.cos(el) * d
        );
        desiredLook = new THREE.Vector3(0, 0, 0);

        // gentle auto-rotate when idle (not in free mode)
        const idleSince = now - s.lastInteract;
        if (pCam === 'idle' && idleSince > 1800 && !s.dragging) {
          s.camAzimuth += dt * 0.055;
        }
      }

      // smooth toward desired
      const lerpAmt = (pCam === 'flyby') ? Math.min(1, dt * 3.5) : Math.min(1, dt * 12);
      s.camPos.lerp(desiredPos, lerpAmt);
      s.camLook.lerp(desiredLook, lerpAmt);
      camera.position.copy(s.camPos);
      camera.lookAt(s.camLook);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    if (onLoaded) onLoaded();

    // ---- resize ----
    const onResize = () => {
      const w = W(), h = H();
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    stateRef.current = s;

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointermove', onPointerMove);
      dom.removeEventListener('pointerleave', onPointerLeave);
      dom.removeEventListener('pointercancel', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      renderer.dispose();
      if (dom.parentNode === mount) mount.removeChild(dom);
    };
  }, []); // setup once

  return (
    <div
      ref={mountRef}
      className={`orbit-mount ${className}`}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', ...style }}
    >
      {hover && (
        <div className="planet-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className="planet-tip__dot" style={{ background: hover.color }} />
          <div>
            <div className="planet-tip__name">{hover.name}</div>
            <div className="planet-tip__meta">{hover.au} AU&nbsp;·&nbsp;Ø {hover.diam.toLocaleString()} km</div>
          </div>
        </div>
      )}
    </div>
  );
};

Object.assign(window, { OrbitLab });

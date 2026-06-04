/* ==========================================================================
   Nebula Architect Core Script
   Rooms OS â€” Studio Room Reference OS
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

  // --- 1. DOM Elements ---
  const slideIon = document.getElementById('slideIon');
  const slideFreq = document.getElementById('slideFreq');
  const slideGrav = document.getElementById('slideGrav');

  const valIon = document.getElementById('valIon');
  const valFreq = document.getElementById('valFreq');
  const valGrav = document.getElementById('valGrav');

  const integrityVal = document.getElementById('integrityVal');
  const integrityBar = document.getElementById('integrityBar');
  const viabilityVal = document.getElementById('viabilityVal');
  const viabilityBar = document.getElementById('viabilityBar');

  const domeCore = document.getElementById('domeCore');
  const domeShields = document.getElementById('domeShields');
  const domeWrapper = document.getElementById('domeWrapper');
  const nebulaPink = document.getElementById('nebulaPink');
  const nebulaCyan = document.getElementById('nebulaCyan');

  const radarSvg = document.getElementById('radarSvg');
  const radarTarget = document.getElementById('radarTarget');
  const radarTargetAura = document.getElementById('radarTargetAura');
  const telemetryX = document.getElementById('telemetryX');
  const telemetryY = document.getElementById('telemetryY');
  const telemetryAngle = document.getElementById('telemetryAngle');
  const consoleBody = document.getElementById('consoleBody');
  const specDensity = document.getElementById('specDensity');

  const notifBanner = document.getElementById('notifBanner');
  const notifText = document.getElementById('notifText');

  const btnShields = document.getElementById('btnShields');
  const btnCalibrate = document.getElementById('btnCalibrate');
  const timelineBeats = document.querySelectorAll('.timeline-beat-card');
  const ringCursor = document.getElementById('ringCursor');
  const systemClock = document.getElementById('systemClock');

  // --- 2. State & Physics Formulas ---
  let isDraggingRadar = false;
  let currentBeat = 1;

  // Real-time Physics Recalculations
  function updatePhysics() {
    const ion = parseInt(slideIon.value);
    const freq = parseInt(slideFreq.value);
    const grav = parseFloat(slideGrav.value) / 100; // Sliders are 10-200 -> 0.1 to 2.0 G

    // Update Slider Display Texts
    valIon.textContent = `${ion} PPM`;
    valFreq.textContent = `${freq} HZ`;
    valGrav.textContent = `${grav.toFixed(2)} G`;

    // 1. Structural Integrity Formula (SSF Spec)
    // S% = 100 - |F_hz - 120|/3 - |I_ppm - 450|/10
    let integrity = 100 - Math.abs(freq - 120) / 3 - Math.abs(ion - 450) / 10;
    integrity = Math.max(10, Math.min(100, Math.round(integrity)));

    // 2. Habitat Biome Viability Formula (SSF Spec)
    // V% = 100 - |G_g - 1.0| * 40 - |I_ppm - 450|/15
    let viability = 100 - Math.abs(grav - 1.0) * 40 - Math.abs(ion - 450) / 15;
    viability = Math.max(5, Math.min(100, Math.round(viability)));

    // Update HUD Stats & Bars
    integrityVal.textContent = `${integrity}%`;
    integrityBar.style.width = `${integrity}%`;

    viabilityVal.textContent = `${viability}%`;
    viabilityBar.style.width = `${viability}%`;

    // Color Grading Shunts for Health UI
    if (integrity < 40) {
      integrityVal.className = "hud-stat-val text-alert";
      integrityBar.className = "hud-bar-fill bg-alert";
    } else {
      integrityVal.className = "hud-stat-val text-success";
      integrityBar.className = "hud-bar-fill bg-success";
    }

    if (viability < 40) {
      viabilityVal.className = "hud-stat-val text-alert";
      viabilityBar.className = "hud-bar-fill bg-alert";
    } else {
      viabilityVal.className = "hud-stat-val text-cyan";
      viabilityBar.className = "hud-bar-fill bg-cyan";
    }

    // Dynamic Visual adjustments on Physics values
    // Make core glow brighter on high ionization
    const coreGlowScale = 0.5 + (ion / 450) * 0.5;
    domeCore.style.transform = `scale(${coreGlowScale})`;

    // Decay the biological core gradient on low viability (shift from magenta/cyan to dry amber/gray)
    if (viability < 50) {
      const decayRatio = (viability - 5) / 45; // 0 to 1
      const greenRed = Math.round(187 + (1 - decayRatio) * 68);
      const blue = Math.round(246 * decayRatio);
      domeCore.style.background = `radial-gradient(circle, rgba(215, 161, 111, ${0.9 - decayRatio * 0.2}) 0%, rgba(${greenRed}, 92, ${blue}, ${0.5 + decayRatio * 0.2}) 60%, transparent 100%)`;
      domeCore.style.filter = `blur(${15 + (1 - decayRatio) * 10}px)`;
    } else {
      domeCore.style.background = `radial-gradient(circle, var(--color-cyan) 0%, var(--color-magenta) 60%, transparent 100%)`;
      domeCore.style.filter = `blur(15px)`;
    }

    // Shield aura density responds to shield frequency
    const freqSpeed = 10 - (freq / 25); // Faster animation on high Hz
    domeShields.style.animationDuration = `${Math.max(0.1, freqSpeed)}s`;

    const shieldOpacity = 0.2 + (freq / 250) * 0.6;
    domeShields.style.opacity = shieldOpacity;
  }

  // --- 3. Draggable Telemetry Radar ---
  function getMouseCoordsOnSvg(e) {
    const rect = radarSvg.getBoundingClientRect();
    let clientX = e.clientX;
    let clientY = e.clientY;

    if (e.touches && e.touches[0]) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }

    // Convert client coords to SVG viewBox coords (0 to 200)
    const x = ((clientX - rect.left) / rect.width) * 200;
    const y = ((clientY - rect.top) / rect.height) * 200;
    return { x, y };
  }

  function handleRadarMove(e) {
    if (!isDraggingRadar) return;

    const { x, y } = getMouseCoordsOnSvg(e);

    // Constrain vector within the boundary ring (radius 90 around center 100, 100)
    const dx = x - 100;
    const dy = y - 100;
    const distance = Math.sqrt(dx * dx + dy * dy);

    let targetX = x;
    let targetY = y;

    if (distance > 90) {
      targetX = 100 + (dx / distance) * 90;
      targetY = 100 + (dy / distance) * 90;
    }

    // Restrain to SVG box limits
    targetX = Math.max(10, Math.min(190, targetX));
    targetY = Math.max(10, Math.min(190, targetY));

    // Update SVG Target position
    radarTarget.setAttribute('cx', targetX);
    radarTarget.setAttribute('cy', targetY);

    radarTargetAura.setAttribute('cx', targetX);
    radarTargetAura.setAttribute('cy', targetY);
    radarTargetAura.style.transformOrigin = `${targetX}px ${targetY}px`;

    // Calculate details & update coordinate outputs
    telemetryX.textContent = targetX.toFixed(2);
    telemetryY.textContent = targetY.toFixed(2);

    // Calculate angle in degrees
    let angle = Math.atan2(targetY - 100, targetX - 100) * (180 / Math.PI);
    if (angle < 0) angle += 360;
    telemetryAngle.textContent = `${angle.toFixed(1)}Â°`;

    // Dynamic Stardust Density based on radar distance
    const densityVal = 0.5 + (Math.sqrt((targetX-100)*(targetX-100) + (targetY-100)*(targetY-100)) / 90) * 1.5;
    specDensity.textContent = `${densityVal.toFixed(2)} BAR`;

    // Append terminal logs with scrolling window
    if (Math.random() < 0.08) {
      appendTerminalLog(`[SHIELD AXIS ADJ] CO-ORDS RE-MAPPED TO: [X: ${targetX.toFixed(0)}, Y: ${targetY.toFixed(0)}] // ANGLE: ${angle.toFixed(0)}Â°`);
    }
  }

  function appendTerminalLog(message, isAlert = false) {
    const line = document.createElement('div');
    line.className = isAlert ? 'console-line alert' : 'console-line';
    line.textContent = `> ${message}`;
    consoleBody.appendChild(line);
    consoleBody.scrollTop = consoleBody.scrollHeight;

    // Keep only the last 20 log entries to save memory
    while (consoleBody.children.length > 20) {
      consoleBody.removeChild(consoleBody.firstChild);
    }
  }

  // --- 4. Interactive Narrative Timeline beats ---
  function loadBeat(beatNumber) {
    currentBeat = beatNumber;

    // Update active UI cards
    timelineBeats.forEach(card => {
      if (parseInt(card.dataset.beat) === beatNumber) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });

    // Custom System Notifications
    const beatLabel = String(beatNumber).padStart(2, '0');
    showNotification(`Beat ${beatLabel} Chronology loaded. Volumetric lighting shunts recalibrated.`);

    // Visual transitions on the Visual Stage on beat shifts
    // Dynamically warp space nebula glows based on visual context
    switch(beatNumber) {
      case 1:
        nebulaPink.style.background = 'radial-gradient(circle, var(--color-magenta) 0%, transparent 80%)';
        nebulaCyan.style.background = 'radial-gradient(circle, var(--color-cyan) 0%, transparent 80%)';
        domeWrapper.style.transform = 'scale(1) rotate(0deg)';
        appendTerminalLog('Chamber loaded: BEAT 01 [ARRIVALS] orbital telemetry grid locked.', false);
        break;
      case 2:
        nebulaPink.style.background = 'radial-gradient(circle, var(--color-violet) 0%, transparent 80%)';
        nebulaCyan.style.background = 'radial-gradient(circle, var(--color-cyan) 0%, transparent 80%)';
        domeWrapper.style.transform = 'scale(1.2) rotate(45deg)';
        appendTerminalLog('Chamber loaded: BEAT 02 [BIO-CORE] volumetric foliage reveals unlocked.', false);
        break;
      case 3:
        nebulaPink.style.background = 'radial-gradient(circle, var(--color-copper) 0%, transparent 80%)';
        nebulaCyan.style.background = 'radial-gradient(circle, rgba(139, 92, 246, 0.5) 0%, transparent 80%)';
        domeWrapper.style.transform = 'scale(1.6) rotate(-25deg)';
        appendTerminalLog('Chamber loaded: BEAT 03 [MACRO ORCHID] vascular leaf nodes aligned.', false);
        break;
      case 4:
        nebulaPink.style.background = 'radial-gradient(circle, var(--color-magenta) 0%, transparent 80%)';
        nebulaCyan.style.background = 'radial-gradient(circle, var(--color-copper) 0%, transparent 80%)';
        domeWrapper.style.transform = 'scale(1.1) rotate(180deg)';
        appendTerminalLog('Chamber loaded: BEAT 04 [SHIELD GRIDS] copper frequency shimmer active.', true);
        break;
      case 5:
        nebulaPink.style.background = 'radial-gradient(circle, rgba(139, 92, 246, 0.8) 0%, transparent 80%)';
        nebulaCyan.style.background = 'radial-gradient(circle, var(--color-cyan) 0%, transparent 80%)';
        domeWrapper.style.transform = 'scale(0.85) rotate(-90deg)';
        appendTerminalLog('Chamber loaded: BEAT 05 [CRADLE] massive stardust hurricane orbit sweep lock.', false);
        break;
    }
  }

  // Show Notification Banner
  function showNotification(text) {
    notifText.textContent = text;
    notifBanner.classList.add('active');

    // Auto hide after 4 seconds
    setTimeout(() => {
      notifBanner.classList.remove('active');
    }, 4000);
  }

  // --- 5. Manual Action Controls ---
  // Engage Shields trigger (Shimmer animation overlay)
  btnShields.addEventListener('click', () => {
    domeShields.classList.add('shimmering');
    appendTerminalLog('[SHIELD OVERRIDE ACTIVE] CYCLING FREQUENCY FIELDS AT 250 HZ...', true);
    showNotification('Geodesic shield grids engaged at maximum capacity.');

    // Cycle for 2.5 seconds
    setTimeout(() => {
      domeShields.classList.remove('shimmering');
      appendTerminalLog('[SHIELD OVERRIDE COMPLETE] Re-entering standby telemetry mode.', false);
    }, 2500);
  });

  // Calibrate Exposure (Reset sliders to absolute mathematical optimal)
  btnCalibrate.addEventListener('click', () => {
    // Reset inputs
    slideIon.value = 450;
    slideFreq.value = 120;
    slideGrav.value = 100;

    // Run recalculation
    updatePhysics();

    appendTerminalLog('[CALIBRATION PROCESS OK] Exposure reset. Biosphere locked at perfect structural balance.', false);
    showNotification('Simulator parameters calibrated to baseline optimal: 450 PPM / 120 Hz / 1.00 G.');
  });

  // --- 6. Interaction Listeners & Clock ---

  // Custom Ring Cursor tracking
  document.addEventListener('mousemove', (e) => {
    ringCursor.style.left = `${e.clientX}px`;
    ringCursor.style.top = `${e.clientY}px`;
  });

  // Scale ring cursor on hovering interactive elements
  const hoverables = document.querySelectorAll('input, button, .timeline-beat-card, a, .radar-target');
  hoverables.forEach(elem => {
    elem.addEventListener('mouseenter', () => {
      ringCursor.style.width = '36px';
      ringCursor.style.height = '36px';
      ringCursor.style.borderColor = 'var(--color-cyan)';
    });
    elem.addEventListener('mouseleave', () => {
      ringCursor.style.width = '24px';
      ringCursor.style.height = '24px';
      ringCursor.style.borderColor = 'var(--color-copper)';
    });
  });

  // Drag Radar Grid Handlers
  radarSvg.addEventListener('mousedown', (e) => {
    isDraggingRadar = true;
    handleRadarMove(e);
  });

  document.addEventListener('mousemove', (e) => {
    if (isDraggingRadar) handleRadarMove(e);
  });

  document.addEventListener('mouseup', () => {
    isDraggingRadar = false;
  });

  // Mobile Touch support for Radar
  radarSvg.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isDraggingRadar = true;
    handleRadarMove(e);
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (!isDraggingRadar) return;
    e.preventDefault();
    handleRadarMove(e);
  }, { passive: false });

  document.addEventListener('touchend', () => {
    isDraggingRadar = false;
  });

  document.addEventListener('touchcancel', () => {
    isDraggingRadar = false;
  });

  // Slider change triggers
  slideIon.addEventListener('input', updatePhysics);
  slideFreq.addEventListener('input', updatePhysics);
  slideGrav.addEventListener('input', updatePhysics);

  // Timeline click triggers
  timelineBeats.forEach(card => {
    card.addEventListener('click', () => {
      loadBeat(parseInt(card.dataset.beat));
    });
  });

  // Live telemetry clock
  function updateClock() {
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const timeStr = `${now.getFullYear()}.${pad(now.getMonth()+1)}.${pad(now.getDate())} [${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}]`;
    systemClock.textContent = `SYSTEM: ONLINE [${timeStr}]`;
  }

  setInterval(updateClock, 1000);
  updateClock();

  // Initial Physics / Beat Boot
  updatePhysics();
  loadBeat(1);

  appendTerminalLog('Rooms OS stardust diagnostics sync established.', false);
});

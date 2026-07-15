(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const header = document.querySelector("[data-header]");
  const video = document.querySelector("[data-hero-video]");
  const cursor = document.querySelector(".sonar-cursor");
  const descent = document.querySelector("[data-descent]");
  const descentCanvas = document.querySelector("[data-descent-canvas]");
  const particleCanvas = document.querySelector("[data-particle-canvas]");
  const depthOutput = document.querySelector("[data-depth]");
  const progressBar = document.querySelector("[data-progress]");
  const chapters = [...document.querySelectorAll("[data-chapters] article")];
  const frequencyControl = document.querySelector("[data-frequency-control]");
  const frequencyOutput = document.querySelector("[data-frequency]");
  const instrument = document.querySelector("[data-instrument]");
  const lockCopy = document.querySelector("[data-lock-copy]");
  const waveformCanvas = document.querySelector("[data-waveform]");
  const soundToggle = document.querySelector("[data-sound-toggle]");
  const soundLabel = document.querySelector("[data-sound-label]");
  const signalAudio = document.querySelector("[data-signal-audio]");
  const restart = document.querySelector("[data-restart]");

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const lerp = (a, b, amount) => a + (b - a) * amount;
  const formatDepth = (value) => Math.round(value).toString().padStart(5, "0");

  let descentProgress = 0;
  let currentFrequency = Number(frequencyControl.value);
  let audioEnabled = false;
  let animationFrame = 0;
  let lastFrame = performance.now();

  function resizeCanvas(canvas) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { width, height, ratio };
  }

  function updateScroll() {
    header.classList.toggle("is-scrolled", window.scrollY > 24);
    const rect = descent.getBoundingClientRect();
    const travel = Math.max(1, descent.offsetHeight - window.innerHeight);
    descentProgress = clamp(-rect.top / travel, 0, 1);

    const eased = descentProgress * descentProgress * (3 - 2 * descentProgress);
    const depth = lerp(42, 10943, eased);
    const subY = lerp(24, 78, eased);
    const subX = 62 + Math.sin(descentProgress * Math.PI * 3.3) * 7;
    const tilt = -5 + Math.sin(descentProgress * Math.PI * 5) * 4;

    depthOutput.textContent = formatDepth(depth);
    descent.style.setProperty("--descent-progress", `${(descentProgress * 100).toFixed(2)}%`);
    descent.style.setProperty("--sub-y", `${subY.toFixed(2)}%`);
    descent.style.setProperty("--sub-x", `${subX.toFixed(2)}%`);
    descent.style.setProperty("--sub-x-mobile", `${(subX - 4).toFixed(2)}%`);
    descent.style.setProperty("--sub-tilt", `${tilt.toFixed(2)}deg`);
    descent.style.setProperty("--beam-y", `${subY.toFixed(2)}%`);
    progressBar.style.width = `${(descentProgress * 100).toFixed(2)}%`;

    let activeIndex = 0;
    chapters.forEach((chapter, index) => {
      if (descentProgress >= Number(chapter.dataset.at)) activeIndex = index;
    });
    chapters.forEach((chapter, index) => chapter.classList.toggle("is-active", index === activeIndex));
  }

  function drawDescent(time) {
    const context = descentCanvas.getContext("2d");
    const { width, height } = resizeCanvas(descentCanvas);
    context.clearRect(0, 0, width, height);

    const phase = time * 0.00012;
    const horizon = height * lerp(0.58, 0.34, descentProgress);
    const lineCount = Math.round(lerp(17, 31, descentProgress));
    context.lineWidth = Math.max(1, width / 1600);

    for (let line = 0; line < lineCount; line += 1) {
      const ratio = line / Math.max(1, lineCount - 1);
      const baseY = horizon + ratio * height * 0.72;
      context.beginPath();
      for (let x = -20; x <= width + 20; x += 16) {
        const wave =
          Math.sin(x * 0.004 + phase * 2 + line * 0.65) * height * 0.012 +
          Math.sin(x * 0.011 - phase + line * 0.38) * height * 0.007;
        const perspective = (x - width * 0.55) * (ratio - 0.5) * 0.035;
        const y = baseY + wave + perspective;
        if (x === -20) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      const alpha = 0.035 + ratio * 0.12;
      context.strokeStyle = `rgba(88, 242, 228, ${alpha})`;
      context.stroke();
    }

    const pulseX = width * (0.72 + Math.sin(phase * 1.7) * 0.03);
    const pulseY = height * lerp(0.3, 0.73, descentProgress);
    const pulse = 18 + ((time * 0.04) % 140);
    context.beginPath();
    context.arc(pulseX, pulseY, pulse, 0, Math.PI * 2);
    context.strokeStyle = `rgba(88, 242, 228, ${clamp(1 - pulse / 150, 0, 0.45)})`;
    context.stroke();
  }

  const particles = Array.from({ length: 86 }, (_, index) => ({
    x: ((index * 73) % 101) / 101,
    y: ((index * 47) % 97) / 97,
    size: 0.4 + ((index * 19) % 13) / 9,
    speed: 0.000008 + ((index * 29) % 17) * 0.0000018,
    drift: ((index % 7) - 3) * 0.0000014,
  }));

  function drawParticles(time) {
    const context = particleCanvas.getContext("2d");
    const { width, height } = resizeCanvas(particleCanvas);
    context.clearRect(0, 0, width, height);

    particles.forEach((particle, index) => {
      const x = ((particle.x + time * particle.drift + 1) % 1) * width;
      const y = ((particle.y + time * particle.speed) % 1) * height;
      const shimmer = 0.18 + (Math.sin(time * 0.0015 + index) + 1) * 0.16;
      context.beginPath();
      context.arc(x, y, particle.size, 0, Math.PI * 2);
      context.fillStyle = `rgba(220, 242, 235, ${shimmer})`;
      context.fill();
    });
  }

  function drawWaveform(time) {
    const context = waveformCanvas.getContext("2d");
    const { width, height } = resizeCanvas(waveformCanvas);
    context.clearRect(0, 0, width, height);

    const target = 47.2;
    const distance = Math.abs(currentFrequency - target);
    const coherence = clamp(1 - distance / 4.8, 0, 1);
    const center = height / 2;
    const amplitude = height * (0.12 + coherence * 0.22);
    const step = Math.max(2, width / 420);

    context.strokeStyle = "rgba(237, 241, 233, 0.08)";
    context.lineWidth = 1;
    for (let row = 1; row < 6; row += 1) {
      context.beginPath();
      context.moveTo(0, (height / 6) * row);
      context.lineTo(width, (height / 6) * row);
      context.stroke();
    }

    context.beginPath();
    for (let x = 0; x <= width; x += step) {
      const normal = x / width;
      const clean = Math.sin(normal * Math.PI * 12 + time * 0.0032) * amplitude;
      const harmonic = Math.sin(normal * Math.PI * 31 - time * 0.0018) * amplitude * 0.22;
      const noise = Math.sin(x * 0.41 + time * 0.017) * amplitude * (1 - coherence) * 1.35;
      const envelope = 0.35 + Math.sin(normal * Math.PI) * 0.65;
      const y = center + (clean * coherence + harmonic + noise) * envelope;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.lineWidth = Math.max(1.2, width / 900);
    context.strokeStyle = coherence > 0.93 ? "#58f2e4" : `rgba(202, 123, 74, ${0.58 + coherence * 0.38})`;
    context.shadowColor = coherence > 0.93 ? "#58f2e4" : "#ca7b4a";
    context.shadowBlur = 18 * coherence;
    context.stroke();
    context.shadowBlur = 0;

    context.fillStyle = "rgba(237, 241, 233, 0.46)";
    context.font = `${Math.max(10, width / 82)}px IBM Plex Mono, monospace`;
    context.fillText("HYDROPHONE ARRAY / RAW", 18, 28);
  }

  function updateFrequency() {
    currentFrequency = Number(frequencyControl.value);
    const isLocked = Math.abs(currentFrequency - 47.2) <= 0.06;
    frequencyOutput.textContent = `${currentFrequency.toFixed(2)} kHz`;
    instrument.classList.toggle("is-locked", isLocked);
    lockCopy.textContent = isLocked ? "Signal locked" : "Searching spectrum";

    if (audioEnabled && signalAudio) {
      signalAudio.volume = isLocked ? 0.58 : 0.42;
    }
  }

  async function toggleAudio() {
    if (!signalAudio) return;

    if (audioEnabled) {
      signalAudio.pause();
      audioEnabled = false;
    } else {
      signalAudio.volume = instrument.classList.contains("is-locked") ? 0.58 : 0.42;
      try {
        await signalAudio.play();
        audioEnabled = true;
      } catch {
        audioEnabled = false;
      }
    }

    soundToggle.setAttribute("aria-pressed", String(audioEnabled));
    soundToggle.setAttribute("aria-label", audioEnabled ? "Mute sonar audio" : "Enable sonar audio");
    soundLabel.textContent = audioEnabled ? "Sonar audio on" : "Sonar audio off";
    updateFrequency();
  }

  function animate(time) {
    const delta = time - lastFrame;
    lastFrame = time;
    if (delta < 1000) {
      drawParticles(time);
      drawDescent(time);
      drawWaveform(time);
    }
    animationFrame = requestAnimationFrame(animate);
  }

  function setupCursor() {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let currentX = -100;
    let currentY = -100;
    let targetX = -100;
    let targetY = -100;

    document.addEventListener("pointermove", (event) => {
      targetX = event.clientX;
      targetY = event.clientY;
      cursor.classList.add("is-visible");
    });
    document.addEventListener("pointerleave", () => cursor.classList.remove("is-visible"));
    document.querySelectorAll("a, button, input").forEach((element) => {
      element.addEventListener("pointerenter", () => cursor.classList.add("is-active"));
      element.addEventListener("pointerleave", () => cursor.classList.remove("is-active"));
    });

    const moveCursor = () => {
      currentX = lerp(currentX, targetX, 0.2);
      currentY = lerp(currentY, targetY, 0.2);
      cursor.style.transform = `translate(${currentX}px, ${currentY}px) translate(-50%, -50%)`;
      requestAnimationFrame(moveCursor);
    };
    moveCursor();
  }

  frequencyControl.addEventListener("input", updateFrequency);
  soundToggle.addEventListener("click", toggleAudio);
  restart.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    if (video) {
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  });
  window.addEventListener("scroll", updateScroll, { passive: true });
  window.addEventListener("resize", updateScroll, { passive: true });
  window.addEventListener("pagehide", () => cancelAnimationFrame(animationFrame));

  if (video) video.play().catch(() => {});
  if (!reducedMotion) setupCursor();
  updateFrequency();
  updateScroll();
  animationFrame = requestAnimationFrame(animate);
})();

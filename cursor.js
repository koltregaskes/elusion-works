export function initCursor() {
  const cursorDot = document.getElementById("cursor-dot");
  if (!cursorDot) return;

  document.body.classList.add("has-custom-cursor");

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let dotX = mouseX;
  let dotY = mouseY;
  let isHovering = false;

  window.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    if (cursorDot.style.opacity === "") {
      cursorDot.style.opacity = "1";
    }
  });

  function animate() {
    const dx = mouseX - dotX;
    const dy = mouseY - dotY;
    const distance = Math.hypot(dx, dy);
    const speed = Math.min(0.48, 0.22 + distance * 0.003);

    dotX += (mouseX - dotX) * speed;
    dotY += (mouseY - dotY) * speed;

    const velX = mouseX - dotX;
    const velY = mouseY - dotY;
    const velocitySq = velX * velX + velY * velY;
    const scale = isHovering ? 1.08 : Math.min(1.16, 1 + velocitySq * 0.00002);

    cursorDot.style.transform = `translate(${dotX}px, ${dotY}px) translate(-14%, -10%) rotate(-10deg) scale(${scale})`;
    
    requestAnimationFrame(animate);
  }

  animate();

  function attachHovers() {
    const interactables = document.querySelectorAll("a, button");
    interactables.forEach((el) => {
      if (el.dataset.cursorBound === "true") return;
      el.dataset.cursorBound = "true";

      el.addEventListener("mouseenter", () => {
        isHovering = true;
        cursorDot.classList.add("cursor-hover");
      });
      el.addEventListener("mouseleave", () => {
        isHovering = false;
        cursorDot.classList.remove("cursor-hover");
      });
    });
  }

  attachHovers();
  window.attachCursorHovers = attachHovers;
}

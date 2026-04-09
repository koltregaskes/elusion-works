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
    const speed = 0.2;
    dotX += (mouseX - dotX) * speed;
    dotY += (mouseY - dotY) * speed;

    const velX = mouseX - dotX;
    const velY = mouseY - dotY;
    const velocitySq = velX * velX + velY * velY;
    const scale = isHovering ? 1 : Math.min(1.5, 1 + velocitySq * 0.0001);
    
    cursorDot.style.transform = `translate(calc(${dotX}px - 50%), calc(${dotY}px - 50%)) scale(${scale})`;
    
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

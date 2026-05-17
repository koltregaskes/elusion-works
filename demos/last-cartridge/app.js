const boot = document.querySelector("[data-boot]");
const bootDismiss = document.querySelector("[data-dismiss-boot]");
const header = document.querySelector("[data-header]");
const hotspotButtons = document.querySelectorAll("[data-hotspot]");
const hotspotCard = document.querySelector("[data-hotspot-card]");
const dialog = document.querySelector("[data-dialog]");
const dialogClose = document.querySelector("[data-dialog-close]");
const dialogTitle = document.querySelector("[data-dialog-title]");
const dialogCopy = document.querySelector("[data-dialog-copy]");
const dialogKicker = document.querySelector("[data-dialog-kicker]");
const motionToggle = document.querySelector("[data-motion-toggle]");
const dossierButton = document.querySelector("[data-dossier]");
const trackButtons = document.querySelectorAll(".track-list button");
const artefactButtons = document.querySelectorAll("[data-artefact]");

const hotspotNotes = {
  "Forest of Glass": "Crystalline trees survive in the first playable traversal fragment.",
  "Red Moon Citadel": "The citadel appears in screenshots, boss rooms and one torn map margin.",
  "Drowned Neon Port": "A floodlit trade hub visible only after corrupted save-state jumps.",
  "Cathedral of Save States": "A late-game system shrine where memory gates are rewritten.",
  "Salt Circuit Desert": "A broken overworld stretch built from repeated desert and circuit tiles."
};

function hideBoot() {
  if (!boot) return;
  boot.classList.add("is-hidden");
  sessionStorage.setItem("last-cartridge-boot-dismissed", "true");
}

if (sessionStorage.getItem("last-cartridge-boot-dismissed") === "true") {
  hideBoot();
}

bootDismiss?.addEventListener("click", hideBoot);
boot?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    hideBoot();
  }
});

document.addEventListener("keydown", (event) => {
  const bootVisible = boot && !boot.classList.contains("is-hidden");
  if (!bootVisible) return;
  if (event.key === "Enter" || event.key === " " || event.key === "Escape") {
    event.preventDefault();
    hideBoot();
  }
});

window.addEventListener("DOMContentLoaded", () => {
  if (boot && !boot.classList.contains("is-hidden")) {
    bootDismiss?.focus({ preventScroll: true });
  }
});

window.addEventListener("scroll", () => {
  header?.classList.toggle("is-tight", window.scrollY > 36);
}, { passive: true });

hotspotButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const label = button.dataset.hotspot || "Unknown signal";
    hotspotButtons.forEach((item) => item.setAttribute("aria-expanded", "false"));
    button.setAttribute("aria-expanded", "true");
    if (hotspotCard) {
      hotspotCard.innerHTML = `<strong>${label}</strong><span>${hotspotNotes[label] || "Recovered location note unavailable."}</span>`;
    }
  });
});

trackButtons.forEach((button) => {
  button.addEventListener("click", () => {
    trackButtons.forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
  });
});

function openDialog(title, copy, kicker = "Archive note") {
  if (!dialog || !dialogTitle || !dialogCopy || !dialogKicker) return;
  dialogKicker.textContent = kicker;
  dialogTitle.textContent = title;
  dialogCopy.textContent = copy;
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  }
}

artefactButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const title = button.dataset.artefact || "Archive artefact";
    openDialog(title, `${title} is represented as a fictional recovered object in this v1 exhibition build.`, "Recovered item");
  });
});

dossierButton?.addEventListener("click", () => {
  openDialog(
    "Dossier Notes",
    "The downloadable dossier is intentionally not shipped in this front-end-only v1. The demo keeps the interaction live without pretending a file exists.",
    "V1 boundary"
  );
});

dialogClose?.addEventListener("click", () => {
  dialog?.close();
});

motionToggle?.addEventListener("click", () => {
  const enabled = document.body.classList.toggle("reduce-motion");
  motionToggle.setAttribute("aria-pressed", String(enabled));
  motionToggle.textContent = enabled ? "Motion reduced" : "Reduce motion";
});

const revealItems = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.16 });

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

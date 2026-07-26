# Cyberpunk Messenger

Playable Three.js delivery-game demo for the Elusion Works cabinet.

## Release contract

- Public path: `/demos/cyberpunk-messenger/`
- Owning source: private `koltregaskes/cyberpunk-messenger` repository
- Source revision: `7b8bd7dbb60871fc5653a13bce7455c953e37c36`
- Build command: `npm run build:elusion`
- The hashed JavaScript, CSS, GLB and title artwork are generated release files. Do not hand-edit them in this repository.
- The title-screen Demos link resolves one level up to `/demos/`.

## Visual system

- Ink: `#071016`
- Paper: `#f1ead4`
- Cyan: `#39f5e5`
- Magenta: `#ff43ad`
- Signal yellow: `#ffd24a`
- Display: Arial Black / Bahnschrift
- UI: Barlow Condensed and IBM Plex Mono

The game stays full-bleed. Elusion Works navigation appears as a compact return
link on the title screen, not as a site header over gameplay.

## Performance

The default renderer selects a low profile for reduced-data mode, devices with
4 GB of reported memory or less, or devices with four reported logical
processors or fewer. `?quality=low` and `?quality=standard` provide deterministic
review overrides. The profile changes rendering cost only; movement, collision,
dialogue, timings and objectives remain shared.

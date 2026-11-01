# Lumen Ward

A small cyberpunk district (about 240 m across) that you can walk, fly or watch
as a looping flyover. Inspired by the "Opus built a city in Unreal, assets in
Blender" posts, but built to run in a browser on the Elusion Works site.

## How it is made

The work splits the same way as the Unreal + Blender MCP route:

| Step | Unreal route | Here |
| --- | --- | --- |
| Model the assets | Claude drives Blender through the Blender MCP add-on | Claude writes `tools/build_kit.py`, run in headless Blender (`bpy`) |
| Export | FBX or glTF into Unreal | one glTF binary: `assets/lumen-ward-kit.glb` |
| Assemble the level | Claude drives the Unreal editor through its MCP server | `src/city.js` lays the kit out from a seed at load time |
| Light and render | Lumen, Niagara rain, post-process | `src/world.js` + bloom, wet-street reflections, rain, steam, fog |
| Cameras | Sequencer shots | `src/flyover.js` (7 shots), `src/controls.js` (walk and fly) |

### The kit (Blender)

`tools/build_kit.py` models 37 objects, about 35k triangles in total:

- 14 tower variants in seven styles: stacked residential blocks, plain
  blocks, setback towers, balcony slabs, glass towers with neon crowns, a round
  tower and low night-market buildings. Each has a shopfront podium with
  awnings, rooftop clutter (water tanks, AC plant, masts with beacons, dishes)
  and wall AC units and pipes.
- Street props: lamps, vending machines, food kiosks, dumpsters, crates,
  barriers, benches, bollards, steam vents, glowing planter trees, parked cars.
- Signs and screens: blade signs, fascia signs, billboards.
- Transport: elevated rail beam and pylon, a train car, three hover vehicles.
- Plaza: hologram plinth and a stylised koi.

The script is deterministic: the same script always writes the same `.glb`.

Rebuild (no Blender install needed, `bpy` comes from PyPI):

```bash
uv venv --python 3.13 /tmp/blender-venv
uv pip install --python /tmp/blender-venv/bin/python bpy
/tmp/blender-venv/bin/python -I demos/lumen-ward/tools/build_kit.py demos/lumen-ward/assets/lumen-ward-kit.glb
```

Placeholder materials are swapped in the browser by name:
`Facade`/`FacadeGlass` become procedural lit windows (worked out from world
position, so every tower differs and scaling never stretches them),
`SignFace` uses a canvas text atlas, `Screen` is an animated advert shader and
`Hologram` is the additive koi shader.

Note: glTF stores the V texture coordinate flipped relative to Blender. The
sign and screen shaders undo that.

### The city (browser)

- 16 blocks on a grid of three streets each way, split into lots with 3 m
  alleys. The four lots round the centre are left open as the koi plaza.
- Towers are fitted to lots by footprint; a few landmarks are pinned so the
  flyover shots always have something to frame.
- Everything is instanced (one `InstancedMesh` per kit part), about 1,060
  placed objects plus 63 hover cars, a four-car train and three koi.
- A far skyline ring of scaled-up towers sits outside the walkable area, with
  gaps left for the traffic lanes.
- `?seed=N` changes the layout.

### Quality

- `high` (desktop default): half-resolution planar reflection on the streets,
  4x MSAA, bloom, 9,000 rain streaks.
- `low` (`?q=low`, and the default on touch devices): no reflection pass, fewer
  rain streaks.

## Controls

- **1 Walk**: WASD and mouse (pointer lock), Shift to run. Collides with buildings and props.
- **2 Fly**: as Walk, plus Space/E up and Q/C down, Shift for speed.
- **3 Flyover**: seven shots on a loop. N next, B previous.
- Touch: drag the left side to move, the right side to look.

URL options: `?mode=walk|fly|flyover`, `?shot=N`, `?q=low|high`, `?seed=N`.

## Checks

`tools/capture.mjs` serves the repo, opens the demo in headless Chromium
(software WebGL), reports console errors and saves frames of each shot:

```bash
node demos/lumen-ward/tools/capture.mjs --out /tmp/lw --shots 0:0.6,2:0.35 --walk
```

Software rendering takes about a minute a frame, so its fps figure is not a
real-GPU number. Real-GPU frame rate has not been measured yet.

## Doing it in Unreal instead

On a machine with Unreal Engine 5 and Blender:

1. Install the Blender MCP add-on and an Unreal MCP server, and connect both
   to Claude Code.
2. Import `assets/lumen-ward-kit.glb` into Unreal (File, Import, glTF). Every
   object comes in as a separate static mesh.
3. Ask Claude to rebuild the layout from `src/city.js` with the Unreal MCP,
   replacing the placeholder materials with Unreal ones, and to add Lumen
   lighting, a Niagara rain system and Sequencer flyover shots.

# Lumen Ward

A small cyberpunk district (about 240 m across) that you can walk, fly or watch
as a looping flyover. It runs in the browser on three.js r187 with the WebGPU
renderer, and falls back to WebGL2 where WebGPU is missing.

## How it is made

| Step | Unreal + Blender MCP route | Here |
| --- | --- | --- |
| Model the assets | Claude drives Blender through the Blender MCP add-on | Claude writes `tools/build_kit.py`, run in headless Blender (`bpy`) |
| Textures | Substance or Blender bakes | `tools/build_textures.py`: tileable PBR sets generated in Blender's Python |
| Assemble the level | Claude drives the Unreal editor through its MCP server | `src/city.js` lays the kit out from a seed and the facade JSON |
| Light and render | Lumen, Niagara, post-process | WebGPU renderer, TSL materials, AO + SSR + bloom + TRAA |
| Cameras | Sequencer | `src/flyover.js` (7 shots), `src/controls.js` (walk and fly) |

### Detail: modular facades

Buildings are assembled the way game engines build cities:

- **Facade cell modules** (`cell_*`, `shop_*` in the kit): one window bay
  each, with real depth. Piers and spandrels, recessed glass, frames,
  mullions, transoms, sills, wall AC units with grilles and drip pipes,
  balconies with railings, plants and washing, louvred blank panels,
  curtain-wall cells, and shopfronts (glass, roller shutter, neon).
- **Tower shells** (`tower_*`): podium fascia with a lit soffit, chamfered
  corner pillars, ledges, cores, parapets with coping, and detailed roofs
  (lift overruns, AC plant with fans and louvres, timber water tanks on braced
  stands with ladders, vent stacks, lattice masts with guy wires and beacons,
  dishes, cable trays). Some towers carry fire escapes and downpipes.
- `assets/lumen-ward-kit.json` lists every facade wall per tower: start
  corner, direction, columns, floors and which module family fills it. The
  browser places about 20,000 module instances from it.
- Windows are **interior-mapped**: each pane traces the view ray through a
  fake room (back wall, side walls, floor, ceiling lamp, furniture, blinds, TV
  flicker), so rooms have depth and parallax without real geometry.
- The far skyline ring uses the older low-detail kit (`tools/build_far.py`,
  `assets/lumen-ward-far.glb`) with procedural windows, since fog hides detail
  out there.

### Textures

`tools/build_textures.py` writes six tileable 1024² sets (colour, ORM,
normal): concrete panels with joints, pits and rain streaks; metal cladding
with seams and rivets; asphalt with cracks, patches and oil; pavement slabs;
rusting painted metal; roof membrane. They are converted to WebP in
`assets/tex/`. The kit's faces carry box-projected UVs in metres, so the
textures keep a real-world scale on any building.

### Rendering

- `src/materials.js`: TSL materials (interior windows, textured PBR, wet
  ground with puddles and animated rain ripples, signs with flicker, advert
  screens, hologram, far facades).
- Post-processing (`src/main.js`): GTAO ambient occlusion, screen-space
  reflections (puddles and glass write their own reflectivity into the
  metal/rough target), bloom, temporal anti-aliasing (TRAA), then a
  vignette and film-grain grade.
- **Light pool** (`src/world.js`): the city defines about 670 light sources
  (street lamps, shopfronts, signs, kiosks, lanterns, plaza). Each frame the
  nearest 40 (56 on ultra) become real point lights, faded by rank so nothing
  pops. Three.js's clustered lighting was tried, but it rendered black on the
  WebGL2 fallback, so it isn't used.
- Rain, steam and lamp light cones are positioned in the vertex shader.

### Quality

- `?q=ultra`: full-resolution SSR, more lights and rain, up to 2x pixel ratio.
- `?q=high` (desktop default): half-resolution SSR and AO.
- `?q=low` (touch default): no SSR or AO, FXAA instead of TRAA.

## Rebuild the assets

```bash
uv venv --python 3.13 /tmp/blender-venv
uv pip install --python /tmp/blender-venv/bin/python bpy
B=/tmp/blender-venv/bin/python
$B -I demos/lumen-ward/tools/build_kit.py demos/lumen-ward/assets/lumen-ward-kit.glb
$B -I demos/lumen-ward/tools/build_far.py demos/lumen-ward/assets/lumen-ward-far.glb
$B -I demos/lumen-ward/tools/build_textures.py /tmp/lwtex
for f in /tmp/lwtex/*.png; do ffmpeg -y -i $f -quality 90 demos/lumen-ward/assets/tex/$(basename $f .png).webp; done
```

All three scripts are deterministic.

## Controls

- **1 Walk**: WASD and mouse (pointer lock), Shift to run. Collides with buildings and props.
- **2 Fly**: as Walk, plus Space/E up and Q/C down, Shift for speed.
- **3 Flyover**: seven shots on a loop. N next, B previous.
- Touch: drag the left side to move, the right side to look.

URL options: `?mode=walk|fly|flyover`, `?shot=N`, `?q=low|high|ultra`, `?seed=N`, `?aa=fxaa`.

## Checks

`tools/capture.mjs` serves the repo, opens the demo in headless Chromium
(software rendering, WebGL2 fallback), reports console errors and saves frames
of each shot. Software rendering takes minutes a frame at this detail, so its
numbers say nothing about real-GPU speed.

## Doing it in Unreal instead

On a machine with Unreal Engine 5 and Blender:

1. Install the Blender MCP add-on and an Unreal MCP server, and connect both to Claude Code.
2. Import `assets/lumen-ward-kit.glb` (File, Import). Each module and shell comes in as a static mesh.
3. Ask Claude to rebuild the layout from `src/city.js` and `assets/lumen-ward-kit.json` with
   instanced static meshes, swap in Unreal materials using the texture sets, and add Lumen
   lighting, a Niagara rain system and Sequencer flyover shots.

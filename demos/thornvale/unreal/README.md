# Thornvale in Unreal Engine 5

The browser version of Thornvale runs on the Elusion Works site. This folder
takes the same town into Unreal Engine 5, where Lumen lighting, Nanite
geometry, volumetric clouds and the engine's foliage tools can push it to the
level of the reference videos.

Everything here starts from the Blender kit and the layout the browser
already uses, so the two versions stay the same town.

## What you need on the laptop

1. **Epic Games Launcher** with **Unreal Engine 5** (5.6 or newer; 5.8 has
   built-in MCP support for AI assistants).
2. **Blender** (4.2 or newer), for editing or re-exporting the kit.
3. **Claude Code**, connected to:
   - an **Unreal MCP server**: in UE 5.8, enable the built-in MCP plugin;
     on earlier versions, use a community Unreal MCP plugin;
   - the **Blender MCP add-on** (`blender-mcp`), installed in Blender and
     switched on from Blender's sidebar.
4. About 30 GB free for the engine and project.

## Step by step

1. **Create the project.** In Unreal, choose Games > **Third Person**,
   Blueprint, Desktop, Maximum quality, with **Starter Content** on. The
   template gives you a playable character, camera and animations.
2. **Enable plugins** (Edit > Plugins): *Python Editor Script Plugin*,
   *glTF Importer* and your MCP plugin. Restart the editor.
3. **Import the kit.** Make the folder `Content/Thornvale/Kit`, then drag
   `demos/thornvale/assets/thornvale-kit.glb` into it and choose *import as
   separate static meshes*. Tick **Build Nanite** for the houses, walls,
   towers, church and keep.
4. **Textures.** Run `demos/thornvale/tools/build_textures.py` (see the
   demo's ARCHITECTURE.md) to get the PNG texture sets, import them, and make
   one material per set: colour into Base Colour, `_orm` red into Ambient
   Occlusion, green into Roughness, `_normal` into Normal. Assign them to the
   kit materials with the same names (Ashlar, Plaster, Timber, RoofClay, and
   so on). Claude can do this step for you over MCP.
5. **Place the town.** Copy `layout.json` (in this folder) next to
   `build_level.py`, then run Tools > Execute Python Script > `build_level.py`.
   Every building, wall section, prop and tree appears as instances. Check
   that a front door faces its street; if not, change `YAW_OFFSET` or
   `MIRROR_Y` at the top of the script and run it again.
6. **Terrain.** Use Landscape mode to sculpt the hill, or import a heightmap.
   The town plateau sits at 22 m, the upper terrace at 30 m, and the outside
   foot of the wall at 18 m (26 m on the north side).
7. **Sky and weather.** Add *Sky Atmosphere*, *Volumetric Cloud*,
   *Exponential Height Fog* and a *Directional Light* set as the atmosphere
   sun. For day and night, rotate the sun from a Level Blueprint or use a sky
   system from Fab. For rain, use a Niagara rain emitter attached to the
   player camera.
8. **Foliage.** Use the Foliage tool or PCG with the kit's trees (or Fab or
   Megascans trees for photo-real canopies) for the forest, and grass on the
   meadows.
9. **Play.** Put the Player Start just inside the south gate and press Play.

## Prompt for Claude Code on the laptop

Once Claude Code can see both MCP servers, paste this:

> Open the Thornvale Unreal project. Import `thornvale-kit.glb` from the
> elusion-works repo into /Game/Thornvale/Kit with Nanite enabled. Build PBR
> materials from the texture sets and assign them by material name. Run
> `unreal/build_level.py` with `layout.json` to place the town, and check a
> house's door faces its street. Sculpt a landscape matching the heights in
> the README, add Sky Atmosphere, Volumetric Clouds, height fog and a sun
> with a day/night cycle on a key, a Niagara rain toggle, and foliage around
> the walls. Put the Third Person character inside the south gate. Then take
> screenshots from the market square, the grand stair and the air, and
> improve whatever looks weakest compared with the browser version.

## Status

- `build_level.py` and the instructions are untested: there is no Unreal on
  the machine that wrote them. Expect to adjust the axis settings on the
  first run.
- `layout.json` is generated from the browser build (seed 11). Regenerate it
  if the layout changes.

"""Rebuild Thornvale in Unreal Engine 5 from the browser layout.

Run inside the Unreal Editor (Python Editor Script Plugin enabled):
    Tools > Execute Python Script... > build_level.py
or from Claude Code through an Unreal MCP server.

Before running:
1. Import demos/thornvale/assets/thornvale-kit.glb into /Game/Thornvale/Kit
   (File > Import Into Level is not needed; drag the .glb into the Content
   Browser folder, choose "Import as separate static meshes").
2. Copy demos/thornvale/unreal/layout.json next to this script, or set
   LAYOUT_PATH below.

The script spawns one Instanced Static Mesh actor per kit mesh, with every
building, wall section, prop and tree placed as an instance. Units: the
layout is in metres, three.js axes (y up). Unreal uses centimetres, z up.

NOT YET VERIFIED on a real Unreal install: check YAW_OFFSET and MIRROR_Y on
the first run (a house's front door should face its street). Adjust and rerun;
the script deletes its previous actors first.
"""

import json
import math
import os

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUT_PATH = os.path.join(HERE, "layout.json")
KIT_FOLDER = "/Game/Thornvale/Kit"
TAG = "ThornvaleLayout"
YAW_OFFSET = 0.0  # degrees added to every instance yaw
MIRROR_Y = False  # flip if the town comes out mirrored

editor = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
assets = unreal.EditorAssetLibrary


def to_unreal(p):
    """three.js metres (x right, y up, z toward viewer) -> Unreal cm (x, y, z up)."""
    x, y, z = p
    return unreal.Vector(x * 100.0, (-z if MIRROR_Y else z) * 100.0, y * 100.0)


def find_mesh(name):
    for path in assets.list_assets(KIT_FOLDER, recursive=True):
        if path.split(".")[-1] == name or path.endswith("/" + name):
            a = assets.load_asset(path)
            if isinstance(a, unreal.StaticMesh):
                return a
    return None


def main():
    with open(LAYOUT_PATH) as fh:
        data = json.load(fh)
    # remove a previous run
    for actor in editor.get_all_level_actors():
        if TAG in [str(t) for t in actor.tags]:
            editor.destroy_actor(actor)
    groups = {}
    for inst in data["instances"]:
        groups.setdefault(inst["name"], []).append(inst)
    missing = []
    with unreal.ScopedSlowTask(len(groups), "Placing Thornvale") as task:
        task.make_dialog(True)
        for name, items in groups.items():
            task.enter_progress_frame(1, name)
            mesh = find_mesh(name)
            if mesh is None:
                missing.append(name)
                continue
            actor = editor.spawn_actor_from_class(unreal.Actor, unreal.Vector(0, 0, 0))
            actor.set_actor_label("TV_" + name)
            actor.tags = [unreal.Name(TAG)]
            ism = unreal.InstancedStaticMeshComponent(actor, "Instances")
            actor.set_editor_property("root_component", ism)
            ism.set_static_mesh(mesh)
            for it in items:
                yaw = -math.degrees(it["yaw"]) + YAW_OFFSET
                t = unreal.Transform(
                    location=to_unreal(it["p"]),
                    rotation=unreal.Rotator(0.0, 0.0, yaw),
                    scale=unreal.Vector(it["s"][0], it["s"][2], it["s"][1]),
                )
                ism.add_instance(t)
    unreal.log("Thornvale: placed %d instance groups" % (len(groups) - len(missing)))
    if missing:
        unreal.log_warning("Thornvale: no mesh found for: " + ", ".join(missing))


main()

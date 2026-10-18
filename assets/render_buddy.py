import bpy, os, math, sys
from mathutils import Vector

OUT = os.path.abspath(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else os.path.abspath("assets")
os.makedirs(OUT, exist_ok=True)

# ---------- 清空场景 ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------- 状态配色 ----------
STATES = {
    "idle":      ("#C9CFD6", "#2FA8BF", 0.9, 3.5),
    "working":   ("#8FE6F4", "#4FD8EE", 0.70, 7.0),
    "attention": ("#F5C070", "#F0A93A", 0.72, 7.5),
    "stalled":   ("#F58A9A", "#F2455C", 0.80, 8.0),
    "completed": ("#7FE0AE", "#3FD68A", 0.70, 7.0),
    "offline":   ("#8C949B", "#5F686F", 0.6, 1.2),
}

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))

# ---------- 球体（珍珠质感） ----------
bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=96, ring_count=64, location=(0, 0, 0))
orb = bpy.context.object
bpy.ops.object.shade_smooth()

mat = bpy.data.materials.new("Pearl")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (*hex_rgb("#EEF1F4"), 1)
bsdf.inputs["Roughness"].default_value = 0.13
if "Coat Weight" in bsdf.inputs:
    bsdf.inputs["Coat Weight"].default_value = 0.85
    bsdf.inputs["Coat Roughness"].default_value = 0.03
if "Specular IOR Level" in bsdf.inputs:
    bsdf.inputs["Specular IOR Level"].default_value = 0.65
orb.data.materials.append(mat)

# ---------- 环 ----------
bpy.ops.mesh.primitive_torus_add(
    major_radius=1.50, minor_radius=0.048,
    major_segments=224, minor_segments=24,
    location=(0, 0, -0.42),
)
ring = bpy.context.object
bpy.ops.object.shade_smooth()
ring.rotation_euler = (math.radians(0), math.radians(-12), 0)

ring_mat = bpy.data.materials.new("Ring")
ring_mat.use_nodes = True
rb = ring_mat.node_tree.nodes["Principled BSDF"]
rb.inputs["Base Color"].default_value = (*hex_rgb("#DDE3E8"), 1)
rb.inputs["Roughness"].default_value = 0.34
rb.inputs["Metallic"].default_value = 0.15
if "Coat Weight" in rb.inputs:
    rb.inputs["Coat Weight"].default_value = 0.7
ring.data.materials.append(ring_mat)

# ---------- 镜头座（凹槽） ----------
bpy.ops.mesh.primitive_torus_add(
    major_radius=0.32, minor_radius=0.05,
    major_segments=96, minor_segments=24,
    location=(0, -0.985, 0.10),
)
socket = bpy.context.object
socket.rotation_euler = (math.radians(90), 0, 0)
bpy.ops.object.shade_smooth()

sock_mat = bpy.data.materials.new("Socket")
sock_mat.use_nodes = True
sb = sock_mat.node_tree.nodes["Principled BSDF"]
sb.inputs["Base Color"].default_value = (0.035, 0.04, 0.045, 1)
sb.inputs["Metallic"].default_value = 0.9
sb.inputs["Roughness"].default_value = 0.28
socket.data.materials.append(sock_mat)

# ---------- 核心灯（发光镜头） ----------
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.27, segments=64, ring_count=48, location=(0, -0.90, 0.10))
core = bpy.context.object
bpy.ops.object.shade_smooth()

core_mat = bpy.data.materials.new("Core")
core_mat.use_nodes = True
cb = core_mat.node_tree.nodes["Principled BSDF"]
cb.inputs["Base Color"].default_value = (*hex_rgb("#2FA8BF"), 1)
cb.inputs["Roughness"].default_value = 0.35
core.data.materials.append(core_mat)

# ---------- 灯光 ----------
def area(name, loc, rot, energy, size, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, type="AREA")
    d.energy = energy
    d.size = size
    d.color = color
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = rot
    scene.collection.objects.link(o)
    return o

area("Key",  (-3.2, -3.6, 3.6), (math.radians(52), 0, math.radians(-38)), 860, 4.4)
area("Bounce", (0.4, -3.0, -2.8), (math.radians(118), 0, math.radians(8)), 140, 5.0, (0.9, 0.94, 1.0))
area("Fill", (3.4, -2.6, 0.9),  (math.radians(80), 0, math.radians(56)), 330, 5.0, (0.82, 0.90, 1.0))
area("Rim",  (0.6, 4.2, 2.6),   (math.radians(-58), 0, math.radians(188)), 420, 3.0, (0.85, 0.93, 1.0))

# ---------- 相机 ----------
cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 76
cam = bpy.data.objects.new("Cam", cam_data)
cam.location = (0, -7.6, 1.5)
scene.collection.objects.link(cam)
scene.camera = cam
tgt = bpy.data.objects.new("Target", None)
tgt.location = (0, 0, 0.05)
scene.collection.objects.link(tgt)
c = cam.constraints.new("TRACK_TO")
c.target = tgt
c.track_axis = "TRACK_NEGATIVE_Z"
c.up_axis = "UP_Y"

# ---------- 渲染设置 ----------
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 8
scene.cycles.transmission_bounces = 4
scene.render.film_transparent = True
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "Filmic" if "Filmic" in [v.name for v in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Standard"

# 环境（只影响反射，不出现背景）
world = bpy.data.worlds.new("W")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.025, 0.03, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
scene.world = world


# ---------- 导出环的投影轨迹（供前端放光点） ----------
import json
from bpy_extras.object_utils import world_to_camera_view

bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
RES = scene.render.resolution_x
samples = []
N = 72
cx, cy, cz = ring.location
R = 1.50
for i in range(N):
    t = 2 * math.pi * i / N
    local = Vector((math.cos(t) * R, math.sin(t) * R, 0))
    world = ring.matrix_world @ local
    co = world_to_camera_view(scene, cam, world)
    samples.append({
        "x": round(co.x * RES, 1),
        "y": round((1 - co.y) * RES, 1),
        "d": round(co.z, 4),
    })
med = sorted(s["d"] for s in samples)[N // 2]
for s2 in samples:
    s2["near"] = s2["d"] < med
with open(os.path.join(OUT, "ring-path.json"), "w", encoding="utf-8") as f:
    json.dump({"size": RES, "points": samples}, f, ensure_ascii=False)
print("RING PATH WRITTEN", len(samples))

only = None
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
for i, a in enumerate(argv):
    if a == "--only":
        only = argv[i + 1]

for name, (ring_hex, core_hex, ring_es, core_es) in STATES.items():
    if only and name != only:
        continue
    rb.inputs["Base Color"].default_value = (*hex_rgb(ring_hex), 1)
    rb.inputs["Emission Color"].default_value = (*hex_rgb(ring_hex), 1)
    rb.inputs["Emission Strength"].default_value = ring_es
    cb.inputs["Base Color"].default_value = (*hex_rgb(core_hex), 1)
    cb.inputs["Emission Color"].default_value = (*hex_rgb(core_hex), 1)
    cb.inputs["Emission Strength"].default_value = core_es
    scene.render.filepath = os.path.join(OUT, f"buddy-{name}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", scene.render.filepath)

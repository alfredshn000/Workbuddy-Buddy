import bpy, os, math, sys

OUT = os.path.abspath(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else os.path.abspath("assets")
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))

# ---------- 材质定义 ----------
# kind: solid（纯参数）/ marble（程序化纹路）/ brushed（拉丝凹凸）/ stone（颗粒凹凸）
MATS = {
    "pearl":   dict(kind="solid", base="#EEF1F4", rough=0.13, metal=0.0,  trans=0.0,  coat=0.85, ior=1.45),
    "chrome":  dict(kind="solid", base="#F7FAFC", rough=0.09, metal=1.0,  trans=0.0,  coat=0.0,  ior=1.45),
    "frosted": dict(kind="solid", base="#DCE8EE", rough=0.30, metal=0.0,  trans=0.85, coat=0.2,  ior=1.46),
    "ceramic": dict(kind="solid", base="#F4F0E8", rough=0.78, metal=0.0,  trans=0.0,  coat=0.12, ior=1.45),
    "carbon":  dict(kind="solid", base="#14181C", rough=0.42, metal=0.35, trans=0.0,  coat=0.3,  ior=1.45),
    "amber":   dict(kind="solid", base="#E8A348", rough=0.16, metal=0.0,  trans=0.80, coat=0.5,  ior=1.52),
    "copper":  dict(kind="solid", base="#C97B4A", rough=0.24, metal=1.0,  trans=0.0,  coat=0.0,  ior=1.45),
    "water":   dict(kind="solid", base="#EAF6FB", rough=0.03, metal=0.0,  trans=1.0,  coat=0.0,  ior=1.333),
    "brushed": dict(kind="brushed", base="#D9E0E6", rough=0.34, metal=1.0, trans=0.0,  coat=0.0,  ior=1.45),
    "marble":  dict(kind="marble",  base="#F2F1EC", rough=0.18, metal=0.0,  trans=0.0,  coat=0.5,  ior=1.45),
    "stone":   dict(kind="stone",   base="#B8B1A4", rough=0.88, metal=0.0,  trans=0.0,  coat=0.05, ior=1.45),
}

bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=96, ring_count=64, location=(0, 0, 0))
orb = bpy.context.object
bpy.ops.object.shade_smooth()
mat = bpy.data.materials.new("Sat")
mat.use_nodes = True
orb.data.materials.append(mat)

# 细环（中性色，状态靠前端光点表达）
bpy.ops.mesh.primitive_torus_add(
    major_radius=1.52, minor_radius=0.038,
    major_segments=192, minor_segments=20,
    location=(0, 0, -0.30),
)
ring = bpy.context.object
bpy.ops.object.shade_smooth()
ring.rotation_euler = (0, math.radians(-14), 0)
ring_mat = bpy.data.materials.new("SatRing")
ring_mat.use_nodes = True
rb = ring_mat.node_tree.nodes["Principled BSDF"]
rb.inputs["Base Color"].default_value = (*hex_rgb("#C6CDD4"), 1)
rb.inputs["Roughness"].default_value = 0.28
rb.inputs["Metallic"].default_value = 0.2
ring.data.materials.append(ring_mat)

def area(name, loc, rot, energy, size, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, type="AREA")
    d.energy = energy; d.size = size; d.color = color
    o = bpy.data.objects.new(name, d)
    o.location = loc; o.rotation_euler = rot
    scene.collection.objects.link(o)

area("Key",  (-3.2, -3.6, 3.6), (math.radians(52), 0, math.radians(-38)), 780, 4.4)
area("Fill", (3.4, -2.6, 0.9),  (math.radians(80), 0, math.radians(56)), 300, 5.0, (0.82, 0.90, 1.0))
area("Rim",  (0.6, 4.2, 2.6),   (math.radians(-58), 0, math.radians(188)), 420, 3.0, (0.85, 0.93, 1.0))
area("Bounce", (0.4, -3.0, -2.8), (math.radians(118), 0, math.radians(8)), 120, 5.0, (0.9, 0.94, 1.0))

cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 80
cam = bpy.data.objects.new("Cam", cam_data)
cam.location = (0, -7.6, 1.4)
scene.collection.objects.link(cam)
scene.camera = cam
tgt = bpy.data.objects.new("T", None); tgt.location = (0, 0, 0.02)
scene.collection.objects.link(tgt)
c = cam.constraints.new("TRACK_TO")
c.target = tgt; c.track_axis = "TRACK_NEGATIVE_Z"; c.up_axis = "UP_Y"

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 12
scene.cycles.transmission_bounces = 10
scene.render.film_transparent = True
scene.render.resolution_x = 192
scene.render.resolution_y = 192
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"

world = bpy.data.worlds.new("W")
world.use_nodes = True
wnt = world.node_tree
bg = wnt.nodes["Background"]
sky = wnt.nodes.new("ShaderNodeTexSky")
sky.sky_type = "MULTIPLE_SCATTERING"
for attr, val in (("sun_elevation", math.radians(38)), ("sun_rotation", math.radians(-40)),
                  ("sun_intensity", 0.35), ("altitude", 200.0), ("sun_size", math.radians(6))):
    if hasattr(sky, attr):
        setattr(sky, attr, val)
wnt.links.new(sky.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = 0.35
scene.world = world


def build(name, p):
    """按 kind 组装节点，返回 Principled BSDF"""
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"][0]
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    bsdf.inputs["Base Color"].default_value = (*hex_rgb(p["base"]), 1)
    bsdf.inputs["Roughness"].default_value = p["rough"]
    bsdf.inputs["Metallic"].default_value = p["metal"]
    if "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = p["trans"]
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = p["ior"]
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = p["coat"]

    kind = p["kind"]

    if kind == "marble":
        tex = nt.nodes.new("ShaderNodeTexCoord")
        wave = nt.nodes.new("ShaderNodeTexWave")
        wave.wave_type = "BANDS"
        wave.bands_direction = "DIAGONAL"
        wave.inputs["Scale"].default_value = 2.2
        wave.inputs["Distortion"].default_value = 13.0
        wave.inputs["Detail"].default_value = 6.0
        wave.inputs["Detail Scale"].default_value = 2.4
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.interpolation = "EASE"
        ramp.color_ramp.elements[0].position = 0.30
        ramp.color_ramp.elements[0].color = (*hex_rgb("#FBFAF7"), 1)
        ramp.color_ramp.elements[1].position = 0.62
        ramp.color_ramp.elements[1].color = (*hex_rgb("#9A9992"), 1)
        nt.links.new(tex.outputs["Object"], wave.inputs["Vector"])
        nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])

    elif kind == "brushed":
        tex = nt.nodes.new("ShaderNodeTexCoord")
        mapping = nt.nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (1.0, 90.0, 1.0)   # 拉长 → 丝纹
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 6.0
        noise.inputs["Detail"].default_value = 6.0
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.22
        bump.inputs["Distance"].default_value = 0.004
        nt.links.new(tex.outputs["Object"], mapping.inputs["Vector"])
        nt.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
        nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    elif kind == "stone":
        tex = nt.nodes.new("ShaderNodeTexCoord")
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 22.0
        noise.inputs["Detail"].default_value = 10.0
        noise.inputs["Roughness"].default_value = 0.75
        bump = nt.nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.45
        bump.inputs["Distance"].default_value = 0.006
        nt.links.new(tex.outputs["Object"], noise.inputs["Vector"])
        nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    return bsdf


only = None
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
for i, a in enumerate(argv):
    if a == "--only":
        only = argv[i + 1]

for name, p in MATS.items():
    if only and name != only:
        continue
    build(name, p)
    scene.render.filepath = os.path.join(OUT, f"sat-{name}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", scene.render.filepath)

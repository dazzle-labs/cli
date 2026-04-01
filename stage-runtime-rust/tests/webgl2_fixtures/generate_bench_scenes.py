#!/usr/bin/env python3
"""Generate heavyweight 3D benchmark scenes for Chrome vs stage-runtime comparison.

Outputs JSON that can be merged into scenes.json.
"""

import json
import math
import random

random.seed(42)  # deterministic

# GL constants
GL_VERTEX_SHADER = 35633
GL_FRAGMENT_SHADER = 35632
GL_ARRAY_BUFFER = 34962
GL_ELEMENT_ARRAY_BUFFER = 34963
GL_STATIC_DRAW = 35044
GL_FLOAT = 5126
GL_UNSIGNED_SHORT = 5123
GL_TRIANGLES = 4
GL_COLOR_BUFFER_BIT = 16384
GL_DEPTH_BUFFER_BIT = 256
GL_DEPTH_TEST = 2929
GL_BLEND = 3042
GL_LESS = 513
GL_SRC_ALPHA = 770
GL_ONE_MINUS_SRC_ALPHA = 771
GL_ONE = 1
GL_CULL_FACE = 2884
GL_BACK = 1029


def round_floats(data, decimals=5):
    """Round all floats in nested structure."""
    if isinstance(data, float):
        return round(data, decimals)
    if isinstance(data, list):
        return [round_floats(x, decimals) for x in data]
    return data


def mat4_perspective(fov_deg, aspect, near, far):
    f = 1.0 / math.tan(math.radians(fov_deg) / 2.0)
    nf = 1.0 / (near - far)
    return [
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) * nf, -1,
        0, 0, 2 * far * near * nf, 0
    ]


def mat4_lookat(eye, center, up):
    fx, fy, fz = center[0]-eye[0], center[1]-eye[1], center[2]-eye[2]
    fl = math.sqrt(fx*fx + fy*fy + fz*fz)
    fx, fy, fz = fx/fl, fy/fl, fz/fl
    sx = fy*up[2] - fz*up[1]
    sy = fz*up[0] - fx*up[2]
    sz = fx*up[1] - fy*up[0]
    sl = math.sqrt(sx*sx + sy*sy + sz*sz)
    sx, sy, sz = sx/sl, sy/sl, sz/sl
    ux = sy*fz - sz*fy
    uy = sz*fx - sx*fz
    uz = sx*fy - sy*fx
    return [
        sx, ux, -fx, 0,
        sy, uy, -fy, 0,
        sz, uz, -fz, 0,
        -(sx*eye[0]+sy*eye[1]+sz*eye[2]),
        -(ux*eye[0]+uy*eye[1]+uz*eye[2]),
        -(-fx*eye[0]-fy*eye[1]-fz*eye[2]),
        1
    ]


def mat4_multiply(a, b):
    result = [0]*16
    for i in range(4):
        for j in range(4):
            s = 0
            for k in range(4):
                s += a[i + k*4] * b[k + j*4]
            result[i + j*4] = s
    return result


def mat4_translate(tx, ty, tz):
    return [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        tx, ty, tz, 1
    ]


def mat4_identity():
    return [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]


# ==========================================================================
# Scene 1: bench_terrain_lit — 32x32 terrain grid with Phong lighting
# ==========================================================================

def generate_terrain():
    grid = 32
    positions = []
    normals = []
    colors = []
    indices = []

    # Generate height field
    def height(x, z):
        return (math.sin(x * 0.8) * math.cos(z * 0.6) * 0.4 +
                math.sin(x * 1.5 + 1.0) * math.cos(z * 1.2 + 0.5) * 0.2 +
                math.cos(x * 0.3 - z * 0.5) * 0.3)

    for iz in range(grid + 1):
        for ix in range(grid + 1):
            x = (ix / grid) * 4.0 - 2.0
            z = (iz / grid) * 4.0 - 2.0
            y = height(x * 3, z * 3)
            positions.extend([x, y, z])

            # Approximate normal via finite differences
            e = 0.01
            hL = height((x - e) * 3, z * 3)
            hR = height((x + e) * 3, z * 3)
            hD = height(x * 3, (z - e) * 3)
            hU = height(x * 3, (z + e) * 3)
            nx, ny, nz = -(hR - hL) / (2*e), 1.0, -(hU - hD) / (2*e)
            nl = math.sqrt(nx*nx + ny*ny + nz*nz)
            normals.extend([nx/nl, ny/nl, nz/nl])

            # Height-based color
            t = (y + 0.5) / 1.0
            t = max(0, min(1, t))
            r = 0.2 + 0.3 * t
            g = 0.4 + 0.4 * t
            b = 0.15 + 0.1 * (1 - t)
            colors.extend([r, g, b])

    for iz in range(grid):
        for ix in range(grid):
            i00 = iz * (grid + 1) + ix
            i10 = i00 + 1
            i01 = i00 + (grid + 1)
            i11 = i01 + 1
            indices.extend([i00, i01, i10, i10, i01, i11])

    proj = mat4_perspective(45, 1.0, 0.1, 50.0)
    view = mat4_lookat([2.5, 2.0, 3.0], [0, 0, 0], [0, 1, 0])
    mvp = mat4_multiply(proj, view)
    model = mat4_identity()

    num_verts = (grid + 1) * (grid + 1)
    num_idx = grid * grid * 6

    commands = [
        ["createShader", GL_VERTEX_SHADER, "__ret_vs"],
        ["shaderSource", "$vs", "@shaders/vs_terrain.glsl"],
        ["compileShader", "$vs"],
        ["createShader", GL_FRAGMENT_SHADER, "__ret_fs"],
        ["shaderSource", "$fs", "@shaders/fs_terrain_lit.glsl"],
        ["compileShader", "$fs"],
        ["createProgram", "__ret_prog"],
        ["attachShader", "$prog", "$vs"],
        ["attachShader", "$prog", "$fs"],
        ["linkProgram", "$prog"],
        ["useProgram", "$prog"],

        ["getUniformLocation", "$prog", "u_mvp", "__ret_loc_mvp"],
        ["getUniformLocation", "$prog", "u_model", "__ret_loc_model"],
        ["getUniformLocation", "$prog", "u_lightDir", "__ret_loc_light"],
        ["getUniformLocation", "$prog", "u_viewPos", "__ret_loc_view"],

        ["uniformMatrix4fv", "$loc_mvp", False, round_floats(mvp)],
        ["uniformMatrix4fv", "$loc_model", False, round_floats(model)],
        ["uniform3f", "$loc_light", 0.6, 0.8, 0.5],
        ["uniform3f", "$loc_view", 2.5, 2.0, 3.0],

        # Position buffer (attrib 0)
        ["createBuffer", "__ret_posbuf"],
        ["bindBuffer", GL_ARRAY_BUFFER, "$posbuf"],
        ["bufferData", GL_ARRAY_BUFFER, round_floats(positions), GL_STATIC_DRAW],
        ["vertexAttribPointer", 0, 3, GL_FLOAT, False, 0, 0],
        ["enableVertexAttribArray", 0],

        # Normal buffer (attrib 1)
        ["createBuffer", "__ret_normbuf"],
        ["bindBuffer", GL_ARRAY_BUFFER, "$normbuf"],
        ["bufferData", GL_ARRAY_BUFFER, round_floats(normals), GL_STATIC_DRAW],
        ["vertexAttribPointer", 1, 3, GL_FLOAT, False, 0, 0],
        ["enableVertexAttribArray", 1],

        # Color buffer (attrib 2)
        ["createBuffer", "__ret_colbuf"],
        ["bindBuffer", GL_ARRAY_BUFFER, "$colbuf"],
        ["bufferData", GL_ARRAY_BUFFER, round_floats(colors), GL_STATIC_DRAW],
        ["vertexAttribPointer", 2, 3, GL_FLOAT, False, 0, 0],
        ["enableVertexAttribArray", 2],

        # Index buffer
        ["createBuffer", "__ret_idxbuf"],
        ["bindBuffer", GL_ELEMENT_ARRAY_BUFFER, "$idxbuf"],
        ["bufferData", GL_ELEMENT_ARRAY_BUFFER, indices, GL_STATIC_DRAW],

        ["enable", GL_DEPTH_TEST],
        ["depthFunc", GL_LESS],
        ["clearColor", 0.05, 0.05, 0.1, 1.0],
        ["clear", GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT],
        ["viewport", 0, 0, 200, 200],
        ["drawElements", GL_TRIANGLES, num_idx, GL_UNSIGNED_SHORT, 0],
    ]

    return {
        "description": f"32x32 terrain grid ({num_verts} verts, {num_idx // 3} tris) with Phong lighting — vertex throughput benchmark",
        "threshold": 0.02,
        "commands": commands,
    }


# ==========================================================================
# Scene 2: bench_cubes_lit_25 — 25 individually-lit cubes, 25 draw calls
# ==========================================================================

def generate_cubes_lit():
    # Cube vertices: pos(3) + normal(3)
    cube_verts = []
    # Front face (z=+0.5)
    for v in [(-0.5,-0.5,0.5), (0.5,-0.5,0.5), (0.5,0.5,0.5), (-0.5,-0.5,0.5), (0.5,0.5,0.5), (-0.5,0.5,0.5)]:
        cube_verts.extend(list(v) + [0,0,1])
    # Back face (z=-0.5)
    for v in [(0.5,-0.5,-0.5), (-0.5,-0.5,-0.5), (-0.5,0.5,-0.5), (0.5,-0.5,-0.5), (-0.5,0.5,-0.5), (0.5,0.5,-0.5)]:
        cube_verts.extend(list(v) + [0,0,-1])
    # Top face (y=+0.5)
    for v in [(-0.5,0.5,0.5), (0.5,0.5,0.5), (0.5,0.5,-0.5), (-0.5,0.5,0.5), (0.5,0.5,-0.5), (-0.5,0.5,-0.5)]:
        cube_verts.extend(list(v) + [0,1,0])
    # Bottom face (y=-0.5)
    for v in [(-0.5,-0.5,-0.5), (0.5,-0.5,-0.5), (0.5,-0.5,0.5), (-0.5,-0.5,-0.5), (0.5,-0.5,0.5), (-0.5,-0.5,0.5)]:
        cube_verts.extend(list(v) + [0,-1,0])
    # Right face (x=+0.5)
    for v in [(0.5,-0.5,0.5), (0.5,-0.5,-0.5), (0.5,0.5,-0.5), (0.5,-0.5,0.5), (0.5,0.5,-0.5), (0.5,0.5,0.5)]:
        cube_verts.extend(list(v) + [1,0,0])
    # Left face (x=-0.5)
    for v in [(-0.5,-0.5,-0.5), (-0.5,-0.5,0.5), (-0.5,0.5,0.5), (-0.5,-0.5,-0.5), (-0.5,0.5,0.5), (-0.5,0.5,-0.5)]:
        cube_verts.extend(list(v) + [-1,0,0])

    proj = mat4_perspective(45, 1.0, 0.1, 50.0)
    view = mat4_lookat([4.0, 3.5, 5.0], [0, 0, 0], [0, 1, 0])

    commands = [
        ["createShader", GL_VERTEX_SHADER, "__ret_vs"],
        ["shaderSource", "$vs", "@shaders/vs_pos3d_normal_mvp.glsl"],
        ["compileShader", "$vs"],
        ["createShader", GL_FRAGMENT_SHADER, "__ret_fs"],
        ["shaderSource", "$fs", "@shaders/fs_phong.glsl"],
        ["compileShader", "$fs"],
        ["createProgram", "__ret_prog"],
        ["attachShader", "$prog", "$vs"],
        ["attachShader", "$prog", "$fs"],
        ["linkProgram", "$prog"],
        ["useProgram", "$prog"],

        ["getUniformLocation", "$prog", "u_mvp", "__ret_loc_mvp"],
        ["getUniformLocation", "$prog", "u_model", "__ret_loc_model"],
        ["getUniformLocation", "$prog", "u_lightDir", "__ret_loc_lightDir"],
        ["getUniformLocation", "$prog", "u_lightColor", "__ret_loc_lightColor"],
        ["getUniformLocation", "$prog", "u_ambient", "__ret_loc_ambient"],
        ["getUniformLocation", "$prog", "u_diffuseColor", "__ret_loc_diffuse"],
        ["getUniformLocation", "$prog", "u_specularColor", "__ret_loc_specular"],
        ["getUniformLocation", "$prog", "u_shininess", "__ret_loc_shininess"],
        ["getUniformLocation", "$prog", "u_viewPos", "__ret_loc_viewPos"],

        # Shared uniforms
        ["uniform3f", "$loc_lightDir", 0.5, 0.8, 0.6],
        ["uniform3f", "$loc_lightColor", 1.0, 0.95, 0.9],
        ["uniform3f", "$loc_ambient", 0.12, 0.12, 0.15],
        ["uniform3f", "$loc_specular", 0.5, 0.5, 0.5],
        ["uniform1f", "$loc_shininess", 32.0],
        ["uniform3f", "$loc_viewPos", 4.0, 3.5, 5.0],

        # Vertex buffer: pos(3) + normal(3) interleaved
        ["createBuffer", "__ret_vbuf"],
        ["bindBuffer", GL_ARRAY_BUFFER, "$vbuf"],
        ["bufferData", GL_ARRAY_BUFFER, round_floats(cube_verts), GL_STATIC_DRAW],
        # pos = attrib 0, stride=24 bytes (6 floats * 4), offset=0
        ["vertexAttribPointer", 0, 3, GL_FLOAT, False, 24, 0],
        ["enableVertexAttribArray", 0],
        # normal = attrib 1, stride=24, offset=12
        ["vertexAttribPointer", 1, 3, GL_FLOAT, False, 24, 12],
        ["enableVertexAttribArray", 1],

        ["enable", GL_DEPTH_TEST],
        ["enable", GL_CULL_FACE],
        ["cullFace", GL_BACK],
        ["clearColor", 0.08, 0.08, 0.12, 1.0],
        ["clear", GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT],
        ["viewport", 0, 0, 200, 200],
    ]

    # 5x5 grid of cubes
    cube_colors = [
        (0.9, 0.2, 0.2), (0.2, 0.7, 0.3), (0.2, 0.4, 0.9),
        (0.9, 0.7, 0.1), (0.7, 0.2, 0.8), (0.1, 0.8, 0.8),
        (0.9, 0.5, 0.2), (0.5, 0.9, 0.3), (0.3, 0.3, 0.9),
    ]
    idx = 0
    for iz in range(5):
        for ix in range(5):
            x = (ix - 2) * 1.3
            z = (iz - 2) * 1.3
            y = 0.0
            model = mat4_translate(x, y, z)
            mvp = mat4_multiply(proj, mat4_multiply(view, model))
            r, g, b = cube_colors[idx % len(cube_colors)]
            idx += 1
            commands.extend([
                ["uniformMatrix4fv", "$loc_mvp", False, round_floats(mvp)],
                ["uniformMatrix4fv", "$loc_model", False, round_floats(model)],
                ["uniform3f", "$loc_diffuse", round(r, 3), round(g, 3), round(b, 3)],
                ["drawArrays", GL_TRIANGLES, 0, 36],
            ])

    return {
        "description": "5x5 grid of Phong-lit cubes (25 draw calls, 900 tris) — draw call + uniform update benchmark",
        "threshold": 0.02,
        "commands": commands,
    }


# ==========================================================================
# Scene 3: bench_raymarched_spheres — fullscreen raymarching
# ==========================================================================

def generate_raymarched():
    # Fullscreen quad
    quad_verts = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]
    quad_uvs = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]

    commands = [
        ["createShader", GL_VERTEX_SHADER, "__ret_vs"],
        ["shaderSource", "$vs", "@shaders/vs_pos2d_uv.glsl"],
        ["compileShader", "$vs"],
        ["createShader", GL_FRAGMENT_SHADER, "__ret_fs"],
        ["shaderSource", "$fs", "@shaders/fs_raymarch.glsl"],
        ["compileShader", "$fs"],
        ["createProgram", "__ret_prog"],
        ["attachShader", "$prog", "$vs"],
        ["attachShader", "$prog", "$fs"],
        ["linkProgram", "$prog"],
        ["useProgram", "$prog"],

        ["getUniformLocation", "$prog", "u_time", "__ret_loc_time"],
        ["uniform1f", "$loc_time", 0.0],

        ["createBuffer", "__ret_posbuf"],
        ["bindBuffer", GL_ARRAY_BUFFER, "$posbuf"],
        ["bufferData", GL_ARRAY_BUFFER, quad_verts, GL_STATIC_DRAW],
        ["vertexAttribPointer", 0, 2, GL_FLOAT, False, 0, 0],
        ["enableVertexAttribArray", 0],

        ["createBuffer", "__ret_uvbuf"],
        ["bindBuffer", GL_ARRAY_BUFFER, "$uvbuf"],
        ["bufferData", GL_ARRAY_BUFFER, quad_uvs, GL_STATIC_DRAW],
        ["vertexAttribPointer", 1, 2, GL_FLOAT, False, 0, 0],
        ["enableVertexAttribArray", 1],

        ["viewport", 0, 0, 200, 200],
        ["drawArrays", GL_TRIANGLES, 0, 6],
    ]

    return {
        "description": "Fullscreen raymarching with 8 SDF objects, soft shadows, Phong shading — fragment shader throughput benchmark",
        "threshold": 0.03,
        "commands": commands,
    }


# ==========================================================================
# Scene 4: bench_particles_256 — 256 alpha-blended soft-circle particles
# ==========================================================================

def generate_particles():
    # Each particle is a quad (2 triangles, 6 vertices)
    # Attributes: pos(2) + uv(2) + color(4) = 8 floats per vertex
    # We'll use a single VBO with all 256 particles baked in

    all_pos = []
    all_uv = []
    all_color = []

    random.seed(42)
    for _ in range(256):
        cx = random.uniform(-0.9, 0.9)
        cy = random.uniform(-0.9, 0.9)
        sz = random.uniform(0.03, 0.12)
        r = random.uniform(0.1, 1.0)
        g = random.uniform(0.1, 1.0)
        b = random.uniform(0.1, 1.0)
        a = random.uniform(0.15, 0.6)

        # Quad corners
        x0, y0 = cx - sz, cy - sz
        x1, y1 = cx + sz, cy + sz

        # 2 triangles
        for (px, py, u, v) in [
            (x0, y0, 0, 0), (x1, y0, 1, 0), (x1, y1, 1, 1),
            (x0, y0, 0, 0), (x1, y1, 1, 1), (x0, y1, 0, 1),
        ]:
            all_pos.extend([px, py])
            all_uv.extend([u, v])
            all_color.extend([r, g, b, a])

    num_verts = 256 * 6

    commands = [
        ["createShader", GL_VERTEX_SHADER, "__ret_vs"],
        ["shaderSource", "$vs", "@shaders/vs_pos2d_uv_color4.glsl"],
        ["compileShader", "$vs"],
        ["createShader", GL_FRAGMENT_SHADER, "__ret_fs"],
        ["shaderSource", "$fs", "@shaders/fs_particle.glsl"],
        ["compileShader", "$fs"],
        ["createProgram", "__ret_prog"],
        ["attachShader", "$prog", "$vs"],
        ["attachShader", "$prog", "$fs"],
        ["linkProgram", "$prog"],
        ["useProgram", "$prog"],

        # Position buffer (attrib 0)
        ["createBuffer", "__ret_posbuf"],
        ["bindBuffer", GL_ARRAY_BUFFER, "$posbuf"],
        ["bufferData", GL_ARRAY_BUFFER, round_floats(all_pos), GL_STATIC_DRAW],
        ["vertexAttribPointer", 0, 2, GL_FLOAT, False, 0, 0],
        ["enableVertexAttribArray", 0],

        # UV buffer (attrib 1)
        ["createBuffer", "__ret_uvbuf"],
        ["bindBuffer", GL_ARRAY_BUFFER, "$uvbuf"],
        ["bufferData", GL_ARRAY_BUFFER, round_floats(all_uv), GL_STATIC_DRAW],
        ["vertexAttribPointer", 1, 2, GL_FLOAT, False, 0, 0],
        ["enableVertexAttribArray", 1],

        # Color buffer (attrib 2)
        ["createBuffer", "__ret_colbuf"],
        ["bindBuffer", GL_ARRAY_BUFFER, "$colbuf"],
        ["bufferData", GL_ARRAY_BUFFER, round_floats(all_color), GL_STATIC_DRAW],
        ["vertexAttribPointer", 2, 4, GL_FLOAT, False, 0, 0],
        ["enableVertexAttribArray", 2],

        ["enable", GL_BLEND],
        ["blendFunc", GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA],
        ["clearColor", 0.02, 0.02, 0.05, 1.0],
        ["clear", GL_COLOR_BUFFER_BIT],
        ["viewport", 0, 0, 200, 200],
        ["drawArrays", GL_TRIANGLES, 0, num_verts],
    ]

    return {
        "description": f"256 alpha-blended soft-circle particles ({num_verts} verts) in single draw — blending + fill rate benchmark",
        "threshold": 0.02,
        "commands": commands,
    }


# ==========================================================================
# Scene 5: bench_normal_perturb — fullscreen per-pixel normal perturbation
# ==========================================================================

def generate_normal_perturb():
    quad_verts = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]
    quad_uvs = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]

    commands = [
        ["createShader", GL_VERTEX_SHADER, "__ret_vs"],
        ["shaderSource", "$vs", "@shaders/vs_pos2d_uv.glsl"],
        ["compileShader", "$vs"],
        ["createShader", GL_FRAGMENT_SHADER, "__ret_fs"],
        ["shaderSource", "$fs", "@shaders/fs_normal_perturb.glsl"],
        ["compileShader", "$fs"],
        ["createProgram", "__ret_prog"],
        ["attachShader", "$prog", "$vs"],
        ["attachShader", "$prog", "$fs"],
        ["linkProgram", "$prog"],
        ["useProgram", "$prog"],

        ["getUniformLocation", "$prog", "u_lightDir", "__ret_loc_light"],
        ["uniform3f", "$loc_light", 0.5, 0.7, 0.5],

        ["createBuffer", "__ret_posbuf"],
        ["bindBuffer", GL_ARRAY_BUFFER, "$posbuf"],
        ["bufferData", GL_ARRAY_BUFFER, quad_verts, GL_STATIC_DRAW],
        ["vertexAttribPointer", 0, 2, GL_FLOAT, False, 0, 0],
        ["enableVertexAttribArray", 0],

        ["createBuffer", "__ret_uvbuf"],
        ["bindBuffer", GL_ARRAY_BUFFER, "$uvbuf"],
        ["bufferData", GL_ARRAY_BUFFER, quad_uvs, GL_STATIC_DRAW],
        ["vertexAttribPointer", 1, 2, GL_FLOAT, False, 0, 0],
        ["enableVertexAttribArray", 1],

        ["viewport", 0, 0, 200, 200],
        ["drawArrays", GL_TRIANGLES, 0, 6],
    ]

    return {
        "description": "Fullscreen per-pixel normal perturbation with multi-octave height field — fragment math throughput benchmark",
        "threshold": 0.03,
        "commands": commands,
    }


# ==========================================================================
# Main: generate and output
# ==========================================================================

def main():
    scenes = {
        "bench_terrain_lit": generate_terrain(),
        "bench_cubes_lit_25": generate_cubes_lit(),
        "bench_raymarched_spheres": generate_raymarched(),
        "bench_particles_256": generate_particles(),
        "bench_normal_perturb": generate_normal_perturb(),
    }

    # Print stats
    for name, scene in scenes.items():
        cmds = len(scene["commands"])
        print(f"  {name}: {cmds} commands")

    # Write to file
    out_path = "tests/webgl2_fixtures/bench_scenes.json"
    with open(out_path, "w") as f:
        json.dump(scenes, f, indent=2)
    print(f"\nWrote {out_path}")


if __name__ == "__main__":
    main()

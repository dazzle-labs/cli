#version 300 es
precision mediump float;
uniform vec2 u_offset;
in vec2 v_texcoord;
out vec4 fragColor;
void main() {
    // Use offset to shift UV, then colorize based on shifted UV
    vec2 uv = v_texcoord + u_offset;
    fragColor = vec4(uv.x, uv.y, 0.0, 1.0);
}

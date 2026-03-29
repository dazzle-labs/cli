#version 300 es
precision mediump float;
in vec2 v_texcoord;
in vec3 v_tint;
uniform sampler2D u_texture;
out vec4 fragColor;
void main() {
    vec4 tex = texture(u_texture, v_texcoord);
    fragColor = vec4(tex.rgb * v_tint, tex.a);
}
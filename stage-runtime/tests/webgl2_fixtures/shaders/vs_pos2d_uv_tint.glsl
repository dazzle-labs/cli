#version 300 es
in vec2 a_position;
in vec2 a_texcoord;
in vec3 a_tint;
out vec2 v_texcoord;
out vec3 v_tint;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texcoord = a_texcoord;
    v_tint = a_tint;
}
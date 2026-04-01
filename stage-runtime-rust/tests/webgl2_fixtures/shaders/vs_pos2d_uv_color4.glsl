#version 300 es
in vec2 a_position;
in vec2 a_texcoord;
in vec4 a_color;
out vec2 v_uv;
out vec4 v_color;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_uv = a_texcoord;
    v_color = a_color;
}

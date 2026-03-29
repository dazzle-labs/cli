#version 300 es
in vec2 a_position;
in float a_alpha;
out float v_alpha;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_alpha = a_alpha;
}
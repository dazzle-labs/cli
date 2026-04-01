#version 300 es
precision mediump float;
in float v_alpha;
out vec4 fragColor;
void main() {
    if (v_alpha < 0.5) discard;
    fragColor = vec4(1.0, 0.0, 0.0, 1.0);
}
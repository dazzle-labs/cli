#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_color;
out vec4 fragColor;
void main() {
    float dist = distance(v_uv, vec2(0.5));
    float alpha = v_color.a * smoothstep(0.5, 0.3, dist);
    fragColor = vec4(v_color.rgb, alpha);
}

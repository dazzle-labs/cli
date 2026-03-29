#version 300 es
precision mediump float;
in vec2 v_uv;
uniform vec2 u_size;
uniform float u_radius;
uniform vec4 u_fillColor;
uniform vec4 u_bgColor;
out vec4 fragColor;
void main() {
    vec2 p = (v_uv - 0.5) * u_size;
    vec2 d = abs(p) - (u_size * 0.5 - u_radius);
    float dist = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - u_radius;
    float aa = fwidth(dist);
    float alpha = 1.0 - smoothstep(-aa, aa, dist);
    fragColor = mix(u_bgColor, u_fillColor, alpha);
}

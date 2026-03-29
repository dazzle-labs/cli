#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 fragColor;
void main() {
    vec3 color1 = vec3(0.9, 0.2, 0.3);
    vec3 color2 = vec3(0.2, 0.3, 0.9);
    float stripe = smoothstep(0.45, 0.55, sin((v_uv.x + v_uv.y) * 25.0) * 0.5 + 0.5);
    vec3 color = mix(color1, color2, stripe);
    // Add a perpendicular stripe for plaid effect
    float stripe2 = smoothstep(0.45, 0.55, sin((v_uv.x - v_uv.y) * 15.0) * 0.5 + 0.5);
    color = mix(color, color * 1.3, stripe2 * 0.3);
    fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}

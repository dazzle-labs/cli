#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 fragColor;
void main() {
    vec3 skyTop = vec3(0.1, 0.3, 0.8);
    vec3 skyBottom = vec3(0.6, 0.8, 1.0);
    vec3 groundTop = vec3(0.3, 0.5, 0.2);
    vec3 groundBottom = vec3(0.15, 0.25, 0.1);
    float horizon = 0.45;
    float t = v_uv.y;
    vec3 sky = mix(skyBottom, skyTop, smoothstep(horizon, 1.0, t));
    vec3 ground = mix(groundBottom, groundTop, smoothstep(0.0, horizon, t));
    float blend = smoothstep(horizon - 0.02, horizon + 0.02, t);
    vec3 color = mix(ground, sky, blend);
    // Sun glow
    float sun = distance(v_uv, vec2(0.7, 0.75));
    color += vec3(1.0, 0.9, 0.5) * 0.3 * smoothstep(0.15, 0.0, sun);
    fragColor = vec4(color, 1.0);
}

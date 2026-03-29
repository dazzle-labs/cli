#version 300 es
precision mediump float;
in vec2 v_texcoord;
out vec4 fragColor;
uniform vec3 u_lightDir;

// Procedural bumpy surface with per-pixel normal computation
float heightMap(vec2 uv) {
    float h = 0.0;
    h += sin(uv.x * 20.0) * cos(uv.y * 20.0) * 0.3;
    h += sin(uv.x * 40.0 + 1.0) * cos(uv.y * 30.0 + 2.0) * 0.15;
    h += sin(uv.x * 80.0 + 3.0) * sin(uv.y * 60.0 + 1.5) * 0.08;
    h += cos(uv.x * 15.0 - uv.y * 25.0) * 0.2;
    return h;
}

vec3 calcNormal(vec2 uv) {
    float e = 0.002;
    float hL = heightMap(uv - vec2(e, 0.0));
    float hR = heightMap(uv + vec2(e, 0.0));
    float hD = heightMap(uv - vec2(0.0, e));
    float hU = heightMap(uv + vec2(0.0, e));
    return normalize(vec3(hL - hR, hD - hU, 2.0 * e));
}

void main() {
    vec3 N = calcNormal(v_texcoord);
    vec3 L = normalize(u_lightDir);
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);

    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, H), 0.0), 48.0);

    vec3 baseColor = mix(
        vec3(0.2, 0.5, 0.8),
        vec3(0.8, 0.3, 0.2),
        v_texcoord.x * 0.5 + 0.5
    );

    vec3 col = baseColor * (0.1 + diff * 0.9) + vec3(0.6) * spec;
    fragColor = vec4(col, 1.0);
}

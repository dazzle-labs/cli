#version 300 es
precision mediump float;
in vec2 v_texcoord;
uniform float u_time;
out vec4 fragColor;

float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sceneSDF(vec3 p) {
    float d = sdSphere(p - vec3(0.0, 0.0, 0.0), 0.5);
    d = min(d, sdSphere(p - vec3(1.2, 0.0, 0.0), 0.4));
    d = min(d, sdSphere(p - vec3(-1.2, 0.0, 0.0), 0.4));
    d = min(d, sdSphere(p - vec3(0.0, 1.0, 0.0), 0.35));
    d = min(d, sdSphere(p - vec3(0.6, -0.8, 0.5), 0.3));
    d = min(d, sdBox(p - vec3(0.0, -1.0, 0.0), vec3(2.0, 0.1, 2.0)));
    d = min(d, sdSphere(p - vec3(-0.6, 0.5, -0.8), 0.35));
    d = min(d, sdSphere(p - vec3(0.8, 0.6, 0.7), 0.25));
    return d;
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
        sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
        sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)
    ));
}

float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
    float res = 1.0;
    float t = mint;
    for (int i = 0; i < 32; i++) {
        float h = sceneSDF(ro + rd * t);
        if (h < 0.001) return 0.0;
        res = min(res, k * h / t);
        t += h;
        if (t > maxt) break;
    }
    return res;
}

void main() {
    vec2 uv = v_texcoord * 2.0 - 1.0;
    uv.x *= 1.0; // aspect ratio handled by viewport

    vec3 ro = vec3(0.0, 1.5, 4.0);
    vec3 rd = normalize(vec3(uv, -1.5));

    // Raymarch
    float t = 0.0;
    float d;
    for (int i = 0; i < 80; i++) {
        vec3 p = ro + rd * t;
        d = sceneSDF(p);
        if (d < 0.001 || t > 20.0) break;
        t += d;
    }

    vec3 col = vec3(0.1, 0.1, 0.15); // background

    if (d < 0.001) {
        vec3 p = ro + rd * t;
        vec3 N = calcNormal(p);
        vec3 L = normalize(vec3(0.6, 0.8, 0.5));

        // Diffuse + specular
        float diff = max(dot(N, L), 0.0);
        vec3 H = normalize(L - rd);
        float spec = pow(max(dot(N, H), 0.0), 64.0);

        // Soft shadow
        float shadow = softShadow(p + N * 0.01, L, 0.01, 10.0, 16.0);

        // Material color based on position
        vec3 matCol = vec3(0.6, 0.5, 0.4);
        if (p.y < -0.85) matCol = vec3(0.3, 0.3, 0.35); // floor

        col = matCol * (0.15 + diff * shadow * 0.85) + vec3(0.5) * spec * shadow;

        // Fog
        float fog = exp(-0.05 * t * t);
        col = mix(vec3(0.1, 0.1, 0.15), col, fog);
    }

    col = pow(col, vec3(1.0 / 2.2)); // gamma
    fragColor = vec4(col, 1.0);
}

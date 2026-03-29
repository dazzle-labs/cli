#version 300 es
precision mediump float;
in vec3 v_normal;
in vec3 v_pos;
in vec3 v_color;
uniform vec3 u_lightDir;
uniform vec3 u_viewPos;
out vec4 fragColor;
void main() {
    vec3 N = normalize(v_normal);
    vec3 L = normalize(u_lightDir);
    vec3 V = normalize(u_viewPos - v_pos);
    vec3 H = normalize(L + V);
    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, H), 0.0), 32.0);
    vec3 ambient = 0.15 * v_color;
    vec3 color = ambient + v_color * diff + vec3(0.3) * spec;
    fragColor = vec4(color, 1.0);
}

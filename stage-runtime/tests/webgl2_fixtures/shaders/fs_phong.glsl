#version 300 es
precision mediump float;
in vec3 v_normal;
in vec3 v_pos;
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform vec3 u_ambient;
uniform vec3 u_diffuseColor;
uniform vec3 u_specularColor;
uniform float u_shininess;
uniform vec3 u_viewPos;
out vec4 fragColor;
void main() {
    vec3 N = normalize(v_normal);
    vec3 L = normalize(u_lightDir);
    vec3 V = normalize(u_viewPos - v_pos);
    vec3 H = normalize(L + V);
    float diff = max(dot(N, L), 0.0);
    float spec = pow(max(dot(N, H), 0.0), u_shininess);
    vec3 color = u_ambient * u_diffuseColor
               + u_lightColor * u_diffuseColor * diff
               + u_lightColor * u_specularColor * spec;
    fragColor = vec4(color, 1.0);
}

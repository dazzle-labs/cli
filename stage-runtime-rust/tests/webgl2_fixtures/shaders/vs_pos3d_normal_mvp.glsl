#version 300 es
in vec3 a_position;
in vec3 a_normal;
uniform mat4 u_mvp;
uniform mat4 u_model;
out vec3 v_normal;
out vec3 v_pos;
void main() {
    gl_Position = u_mvp * vec4(a_position, 1.0);
    v_normal = mat3(u_model) * a_normal;
    v_pos = (u_model * vec4(a_position, 1.0)).xyz;
}

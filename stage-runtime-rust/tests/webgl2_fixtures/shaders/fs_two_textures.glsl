#version 300 es
precision mediump float;
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
in vec2 v_texcoord;
out vec4 fragColor;
void main() {
    vec4 c0 = texture(u_tex0, v_texcoord);
    vec4 c1 = texture(u_tex1, v_texcoord);
    fragColor = mix(c0, c1, 0.5);
}

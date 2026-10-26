[BASE_FRAGMENT_HEADER]
[LIGHT_DEFS]

in vec3 v_uvw;
uniform samplerCube u_skybox;

void main() {
  vec4 sky = texture(u_skybox, v_uvw) * u_color;
  fragColor = vec4(displayToTarget(sky.rgb), sky.a);
}
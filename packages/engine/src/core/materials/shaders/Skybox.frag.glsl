[BASE_FRAGMENT_HEADER]
[LIGHT_DEFS]

in vec3 v_uvw;
uniform samplerCube u_skybox;

void main() {
  vec4 sky = texture(u_skybox, v_uvw) * u_color;
  // G05: apply scene exposure so the skybox brightness tracks the rest of the scene, exactly like
  // the WebGPU skybox (Skybox.frag.wgsl). Every PBR material on this tier scales its output tail by
  // u_exposure (forced to 1.0 while post owns the tail, so this is never double-applied); the
  // skybox is part of the same frame and must not stay pinned at exposure 1.0. glsl100 stays
  // unexposed: WebGL1 has no u_exposure uniform anywhere (documented tier limitation, see S5).
  fragColor = vec4(displayToTarget(sky.rgb) * u_exposure, sky.a);
}
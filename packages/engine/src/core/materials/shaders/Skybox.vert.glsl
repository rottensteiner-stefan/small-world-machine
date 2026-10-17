[BASE_VERTEX_HEADER]
out vec3 v_uvw;

void main() {
  v_uvw = a_position;
  // Center the sky on the camera (the cube follows the viewer, never a fixed scene position).
  // The view transform maps the camera position to the origin, so the model translation is
  // neutralized and only the orientation survives.
  vec4 clip = u_vp * (u_model * vec4(a_position, 1.0) + vec4(u_viewPos, 0.0));
  // Pin the sky to the far plane (like `.xyww` in skybox.vert.wgsl) so a camera far plane closer than
  // the cube never clips it. Just below w: depth testing stays LESS against the cleared 1.0.
  gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
}
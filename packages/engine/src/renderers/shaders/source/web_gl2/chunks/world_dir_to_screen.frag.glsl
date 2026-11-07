// WebGL2: u_vp comes from the GlobalUniforms UBO -- include after the LIGHT_DEFS chunk.
// World-space direction -> screen-plane offset (texture-UV units; GL: y up). Projects the direction
// through the view-projection (w = 0), i.e. its view-space x/y scaled by the projection, and divides by
// the vertical focal term so the result is FOV-independent with x already aspect-compensated (h/w).
// Replaces raw world `.xy`/`.xz` screen offsets, which rotated with the camera yaw.
vec2 worldDirToScreen(vec3 dir) {
    vec2 clipDir = (u_vp * vec4(dir, 0.0)).xy;
    float focalY = length(vec3(u_vp[0][1], u_vp[1][1], u_vp[2][1]));
    return clipDir / max(focalY, 1e-6);
}

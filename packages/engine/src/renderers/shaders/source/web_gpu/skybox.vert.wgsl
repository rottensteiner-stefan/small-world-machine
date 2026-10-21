struct Out {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec3f
}

@vertex fn vs(@location(0) pos: vec3f) -> Out {
    var o: Out;
    o.uv = pos;
    // Center the sky on the camera: only the model's linear part (scale/rotation) is applied
    // (w = 0 drops its translation), then the camera world position is added so the cube
    // follows the viewer. The view transform maps that position to the origin, so a skybox
    // object placed away from the origin is not shifted relative to the camera.
    let wp = obj.model * vec4f(pos, 0.0) + vec4f(global.viewPos.xyz, 1.0);
    o.pos = (global.vp * wp).xyww;
    return o;
}

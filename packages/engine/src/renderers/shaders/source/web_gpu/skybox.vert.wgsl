struct Out {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec3f
}

@vertex fn vs(@location(0) pos: vec3f) -> Out {
    var o: Out;
    o.uv = pos;
    // Center the sky on the camera: add the camera world position so the cube follows the
    // viewer instead of a fixed scene position. The view transform maps the camera position to
    // the origin, so the model translation is neutralized and only the orientation survives.
    let wp = obj.model * vec4f(pos, 1.0) + vec4f(global.viewPos.xyz, 0.0);
    o.pos = (global.vp * wp).xyww;
    return o;
}

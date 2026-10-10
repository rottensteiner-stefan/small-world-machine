struct Out {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec3f
}

@vertex fn vs(@location(0) pos: vec3f) -> Out {
    var o: Out;
    o.uv = pos;
    let wp = obj.model * vec4f(pos, 1.0);
    o.pos = (global.vp * wp).xyww;
    return o;
}

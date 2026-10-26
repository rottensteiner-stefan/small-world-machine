@fragment fn fs(i: Out) -> @location(0) vec4f {
    let texCol = textureSample(u_diffuseMap, s, i.uv);
    if (texCol.a < 0.1) { discard; }
    // Scene fog (same math/space as the lit shaders' fog-wgsl chunk): mix toward the fog color
    // by distance so camera-facing sprites (imposters, decals) recede like every other surface.
    var color = displayToTarget(texCol.rgb * obj.color.rgb);
    [WGSL_FOG_CALC]
    return vec4f(color, texCol.a * obj.color.a);
}
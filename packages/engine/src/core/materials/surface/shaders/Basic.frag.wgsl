@fragment fn fs(i: Out) -> @location(0) vec4f {
    let texCol = textureSample(u_diffuseMap, s, i.uv);
    var color = displayToTarget(texCol.rgb * obj.color.rgb);
    [WGSL_FOG_CALC]
    let tint = select(vec4f(1.0, 1.0, 1.0, 1.0), i.instColor, USE_INSTANCE_COLOR);
    return vec4f(color * tint.rgb, (texCol.a * obj.color.a) * tint.a);
}
@fragment fn fs(i: Out) -> @location(0) vec4f {
    let texCol = textureSample(u_diffuseMap, s, i.uv);
    var color = texCol.rgb * obj.color.rgb;
    [WGSL_FOG_CALC]
    return vec4f(color, texCol.a * obj.color.a);
}
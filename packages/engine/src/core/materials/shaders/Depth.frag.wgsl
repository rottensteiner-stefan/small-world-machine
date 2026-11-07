@fragment fn fs(i: Out) -> @location(0) vec4f {
    let alpha = textureSample(u_diffuseMap, s, i.uv).a;
    if (alpha < obj.extraParams.y) {
        discard;
    }
    return vec4f(1.0);
}

@fragment fn fs(i: Out) -> @location(0) vec4f {
#ifdef USE_UV_TRANSFORMS
#ifdef USE_UV1
    let swmUv1 = i.uv1;
#else
    let swmUv1 = i.uv0;
#endif
    let p0 = u_uvTransforms[0];
    let p1 = u_uvTransforms[1];
    let baseUv = select(i.uv0, swmUv1, p1.z > 0.5);
    let uvScaled = baseUv * p0.zw;
    let diffuseUv = vec2f(p1.x * uvScaled.x - p1.y * uvScaled.y, p1.y * uvScaled.x + p1.x * uvScaled.y) + p0.xy;
#else
    let diffuseUv = i.uv;
#endif
    let alpha = textureSample(u_diffuseMap, s, diffuseUv).a;
    if (alpha < obj.extraParams.y) {
        discard;
    }
    return vec4f(1.0);
}

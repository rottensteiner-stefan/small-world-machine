// EVSM moment writer (ADR 0043). Depth source: `i.pos.z`. The shared vertex chunk writes the
// clip-space position into `Out.pos` (@builtin(position)); reading it in the fragment yields the
// rasterized [0,1] fragment depth -- the exact value the depth pass just stored for this very
// fragment, since the moment pass renders the same geometry with the same cascade VP into the same
// depth array layer. This is established engine precedent: StylizedWater/OpenWater already read
// `i.pos.z` as the fragment depth (`ndcFrag = i.pos.z * 2.0 - 1.0`) and lighting chunks read
// `i.pos.xy` for cluster cells. Using the builtin member avoids declaring a second
// `@builtin(position)` parameter (which would clash with `Out.pos`) and keeps the single-`Out`
// signature the normal-output wrapper can rewrite.
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

    // Warp the [0,1] viewport depth onto [-1,1] and emit two exponential variance shadow maps as
    // 4 channels: (e^{c·d}, e^{2c·d}, -e^{-c·d}, e^{-2c·d}). c = 40 (the Filament vsm-exponent,
    // see surface_shadowing.fs evaluateEVSM): every stored value stays representable in fp32 --
    // e^{2c·1} = e^{80} ≈ 5.5e34 < fp32 max ≈ 3.4e38, and the negative side e^{-2c·1} = e^{-80}
    // ≈ 1.4e-35 remains a normal (> 1.2e-38). No exponent clamp is needed (naive c = 80's square
    // would overflow). Must match getEVSM() in pbr_math.wgsl byte for byte (same remap + warp).
    let depth = clamp(i.pos.z, 0.0, 1.0);
    let d = clamp(depth * 2.0 - 1.0, -1.0, 1.0);
    let c = 40.0;
    let e = exp(c * d);
    let e2 = e * e;
    let n = -1.0 / e;
    let n2 = n * n;
    return vec4f(e, e2, n, n2);
}

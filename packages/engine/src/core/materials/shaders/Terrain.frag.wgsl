@fragment fn fs(i: Out) -> @location(0) vec4f {
    let sand = textureSample(u_sandMap, s, i.uv);
    let grass = textureSample(u_grassMap, s, i.uv);
    let rock = textureSample(u_rockMap, s, i.uv);
    let snow = textureSample(u_snowMap, s, i.uv);

    let h = i.wp.y;
    let t_sand_grass = smoothstep(obj.thresholds.x - obj.thresholds.w, obj.thresholds.x + obj.thresholds.w, h);
    let t_grass_rock = smoothstep(obj.thresholds.y - obj.thresholds.w, obj.thresholds.y + obj.thresholds.w, h);
    let t_rock_snow  = smoothstep(obj.thresholds.z - obj.thresholds.w, obj.thresholds.z + obj.thresholds.w, h);

    let c1 = mix(sand, grass, t_sand_grass);
    let c2 = mix(c1, rock, t_grass_rock);
    var texCol = mix(c2, snow, t_rock_snow);

    // Note: N is now defined inside WGSL_LIGHTING via normalize(i.n)
    [WGSL_LIGHTING]

    let slope = 1.0 - N.y;
    let slopeBlend = smoothstep(0.25, 0.45, slope);
    texCol = mix(texCol, rock, slopeBlend);

    let albedo = sRGBToLinear(texCol.rgb) * sRGBToLinear(obj.color.rgb);
    var color = fL * albedo + spec * sRGBToLinear(obj.specColor.rgb);

    // Exposure
    color *= global.exposure;

    // Tonemapping guard
    if (global.gamma != 1.0) {
        color = color / (color + vec3f(1.0)); // Reinhard
    }

    // Gamma correction
    color = linearToSRGB(color);

    [WGSL_FOG_CALC]

    return vec4f(color, obj.color.a);
}
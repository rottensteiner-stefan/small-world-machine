// smoothstep() is undefined for edge0 >= edge1 (a blur of 0); fall back to a hard step.
fn lavaSmoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    if (edge0 < edge1) { return smoothstep(edge0, edge1, x); }
    return step(edge0, x);
}

@fragment fn fs(i: LavaOut) -> @location(0) vec4<f32> {
    // u_matParam0: [scaleMain, scaleDistort, distortion, vertexDistortion]
    // u_matParam1: [speedMainX, speedMainY, speedDistortX, speedDistortY]
    // u_matParam2: [cutoffTop, topBlur, tintOffset, brightnessUnderLava]
    // u_matParam3: [edgeThickness, edgeBlur, brightnessTopLava, unused]
    // u_matParam6..9: Main Tint Start / Main Tint End / Top Layer Tint / Edge Color

    // Unity's _Time.x is t / 20.
    let timeX = obj.time * 0.05;
    let r = i.color.r;

    // Distortion: the noise texture projected over world XZ at two scales, scrolling.
    let uvDistort = i.wp.xz * obj.matParam0.y;
    let speedDistort = timeX * obj.matParam1.zw;
    let d = textureSample(u_distortMap, s, uvDistort + speedDistort).r;
    let d2 = textureSample(u_distortMap, s, (i.wp.xz * (obj.matParam0.y * 0.5)) + speedDistort).r;
    let layeredDist = saturate((d + d2) * 0.5);

    // Main texture over world XZ + distortion, scrolling, plus extra distortion from the red
    // vertex color (a scalar added to both UV components, as in the original).
    var uvMain = i.wp.xz * obj.matParam0.x;
    uvMain += layeredDist * obj.matParam0.z;
    uvMain += timeX * obj.matParam1.xy + (r * obj.matParam0.w);

    // Main texture fading with vertex color, plus the layered distortion.
    var col = textureSample(u_diffuseMap, s, uvMain).r * r;
    col += layeredDist;

    // Top layer: the brightest part of the texture, dimmed by the vertex color.
    let top = lavaSmoothstep(obj.matParam2.x, obj.matParam2.x + obj.matParam2.y, col) * r;

    // Depth edge detection. Coordinates are clamped to the texture so a 1x1 fallback depth
    // stays valid; a missing capture (0) is treated as "nothing behind".
    let depthDims = vec2<i32>(textureDimensions(u_opaqueDepthMap));
    let depthCoord = clamp(vec2<i32>(i.pos.xy), vec2<i32>(0), depthDims - vec2<i32>(1));
    var bgDepth = textureLoad(u_opaqueDepthMap, depthCoord, 0);
    if (bgDepth <= 0.0) { bgDepth = 1.0; }
    let near = global.cameraNearFar.x;
    let far = global.cameraNearFar.y;
    let linBgDepth = (2.0 * near * far) / (far + near - (bgDepth * 2.0 - 1.0) * (far - near));
    let linFragDepth = (2.0 * near * far) / (far + near - (i.pos.z * 2.0 - 1.0) * (far - near));
    let edgeLine = 1.0 - saturate(obj.matParam3.x * (linBgDepth - linFragDepth));

    // Cutoff edge based on the main texture.
    let edge = lavaSmoothstep(1.0 - col, 1.0 - col + obj.matParam3.y, edgeLine);

    // Lerp start and end color over the main texture (unclamped, like Unity's lerp), multiply
    // for brightness.
    var baseColor: vec3<f32>;
    if (USE_RAMP_LUT) {
        // ADR 0026 extension: a 256-color thermal ramp replaces the two-color lerp.
        let heat = saturate(col * obj.matParam2.z);
        let rampUv = vec2<f32>((heat * 255.0 + 0.5) / 256.0, 0.5);
        baseColor = sRGBToLinear(textureSampleLevel(u_rampMap, s, rampUv, 0.0).rgb);
    } else {
        baseColor = mix(sRGBToLinear(obj.matParam6.rgb), sRGBToLinear(obj.matParam7.rgb), col * obj.matParam2.z);
    }
    var color = baseColor * obj.matParam2.w;

    // Take the edge and the top out of the main color, fade by the vertex color, add them back.
    color *= (1.0 - edge);
    color *= (1.0 - top);
    color *= r;
    color += (edge * sRGBToLinear(obj.matParam9.rgb)) * obj.matParam3.z;
    color += top * sRGBToLinear(obj.matParam8.rgb) * obj.matParam3.z;

    // Negative light is meaningless in an HDR target (the unclamped lerp can undershoot).
    color = max(color, vec3<f32>(0.0));
    color *= global.exposure;
    return vec4<f32>(linearToSRGB(color), 1.0);
}

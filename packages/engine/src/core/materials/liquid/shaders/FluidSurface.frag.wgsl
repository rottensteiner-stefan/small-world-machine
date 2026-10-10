@fragment fn fs(i: Out) -> @location(0) vec4<f32> {
    let time = obj.extraParams.y;
    let flowSpeed = obj.extraParams.z;
    let noiseScale = obj.extraParams.w;

    // Use world position XZ for seamless tiling
    let worldUV = i.wp.xz * 0.5; 
    let uv = worldUV * noiseScale;
    let uv1 = uv + vec2<f32>(time * 0.05, time * 0.02) * flowSpeed;
    let uv2 = uv + vec2<f32>(-time * 0.03, time * 0.04) * flowSpeed;

    let tex1 = textureSample(u_diffuseMap, s, uv1).rgb;
    let tex2 = textureSample(u_diffuseMap, s, uv2).rgb;
    let n1 = dot(tex1, vec3<f32>(0.299, 0.587, 0.114));
    let n2 = dot(tex2, vec3<f32>(0.299, 0.587, 0.114));
    let noise = (n1 + n2) * 0.5;

    // Surface normal: mesh normal (displaced analytically in the vertex stage) tilted by the
    // flowing normal map. normalStrength 0 (default) leaves it untouched.
    let nm = textureSample(u_normalMap, s, uv1).rgb * 2.0 - 1.0;
    let N = normalize(i.n + vec3<f32>(nm.x, 0.0, nm.y) * obj.thresholds.z);
    let V = normalize(global.viewPos.xyz - i.wp);
    let softness = max(obj.reflectivity, 0.01);

    let baseColor = sRGBToLinear(obj.color.rgb) * (1.0 - smoothstep(0.0, 0.6, noise)) * 1.5;
    let edgeCol = sRGBToLinear(obj.specColor.rgb); 

    // Depth Fade
    let fragPosCoords = vec2<i32>(i.pos.xy);
    let bgDepth = textureLoad(u_opaqueDepthMap, fragPosCoords, 0);
    
    let near = global.cameraNearFar.x;
    let far = global.cameraNearFar.y;
    
    let ndcBg = bgDepth * 2.0 - 1.0;
    let linBgDepth = (2.0 * near * far) / (far + near - ndcBg * (far - near));
    
    let ndcFrag = i.pos.z * 2.0 - 1.0;
    let linFragDepth = (2.0 * near * far) / (far + near - ndcFrag * (far - near));
    
    let depthDiff = linBgDepth - linFragDepth;
    
    let edgeBlend = 1.0 - saturate(depthDiff / 1.0); // Softness of 1.0 units
    let noiseBlend = smoothstep(0.7 - softness * 0.5, 0.7 + softness * 0.5, noise);
    let finalBlend = saturate(noiseBlend + edgeBlend);

    var color = mix(baseColor, edgeCol, finalBlend);

    // Emissive glow (lava/molten presets) -- obj.extraParams.x and obj.liquidParams.zw are
    // otherwise unused by this shader, repurposed to carry emissiveColor.rgb pre-multiplied by
    // emissiveStrength (see FluidSurfaceMaterial.ts). Zero by default, a no-op for plain fluids.
    let emissive = vec3<f32>(obj.extraParams.x, obj.liquidParams.z, obj.liquidParams.w);
    // Noise-driven mask: hot where the noise is low (cracks), dark crust where it is high, with a
    // soft falloff. emissiveMask (obj.isTerrain) 0 keeps the legacy constant glow; the pulse
    // (obj.metallic amplitude, obj.roughness speed) rolls along the noise.
    let hot = 1.0 - smoothstep(0.5 - softness, 0.5 + softness, noise);
    let pulse = 1.0 + obj.metallic * 0.5 * sin(time * obj.roughness + noise * 6.2831853);
    color += sRGBToLinear(emissive) * mix(1.0, hot, obj.isTerrain) * pulse;

    // Optional lighting: wrapped diffuse shade (obj.pad1), Fresnel rim, specular (obj.thresholds).
    let L = normalize(global.dirLightDir.xyz);
    let dirShadow = sampleDirShadow(i.wp, N);
    let ndl = dot(N, L) * 0.5 + 0.5;
    color *= mix(1.0, ndl * ndl * 1.6 * mix(0.35, 1.0, dirShadow), obj.pad1);
    let ndv = clamp(dot(N, V), 0.0, 1.0);
    let rim = pow(1.0 - ndv, 3.0) * obj.thresholds.x;
    color += edgeCol * rim;
    let ndh = clamp(dot(N, normalize(L + V)), 0.0, 1.0);
    color += global.dirLightColor.rgb * pow(ndh, max(obj.shininess, 1.0)) * obj.thresholds.y * dirShadow;

    // Beer-Lambert thickness from the opaque depth capture (see the GLSL version).
    let thickness = 1.0 - exp(-obj.thresholds.w * max(depthDiff, 0.0));
    let alpha = mix(1.0, clamp(thickness + rim, 0.25, 1.0), step(0.0001, obj.thresholds.w));

    // Exposure
    color *= global.exposure;

    // Tonemapping guard
    if (global.gamma != 1.0) {
        color = color / (color + vec3f(1.0)); // Reinhard
    }

    // Gamma correction
    color = linearToSRGB(color);

    [WGSL_FOG_CALC]

    return vec4<f32>(color, alpha);
}
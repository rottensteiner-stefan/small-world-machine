fn hash2(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

@fragment fn fs(i: Out) -> @location(0) vec4f {
    // E9-A / R6 (ADR 0027/0039): typed lanes -- u_matParam0 is the control lane.
    let intensity = obj.matParam0.x;
    let time = obj.matParam0.y;
    let mode = obj.matParam0.w; // 0.0 = tv50s, 1.0 = film19th
    
    var uv = i.uv;
    
    // Mode 0.0: TV rolling & tear
    if (mode < 0.5) {
        let rollSpeed = obj.matParam1.w;
        uv.y = fract(uv.y + time * rollSpeed);
        
        let tear = hash2(vec2f(floor(uv.y * 15.0), floor(time * 6.0)));
        if (tear > 0.92) {
            uv.x += sin(uv.y * 30.0 + time * 10.0) * 0.025 * intensity;
        }
    }
    
    let texCol = textureSample(u_diffuseMap, s, uv);
    var color = texCol.rgb;
    
    if (mode < 0.5) {
        // TV Grayscale
        let gray = dot(color, vec3f(0.299, 0.587, 0.114));
        color = vec3f(gray);
        
        // Scanlines.
        // E9-A anti-alias guard: the fixed line count (default 800) is a texture-space sine that
        // shimmers when the surface is foreshortened far away and several lines land on one pixel
        // (the audit's "flickers in the distance" warning). Clamp the line count to the local
        // Nyquist bound 0.5/fwidth so a pixel never carries more than one full line period. This
        // is a strict identity whenever fwidth(uv.y) * scanlineCount <= 0.5 (lines >= 2px apart),
        // i.e. for every normal on-screen TV density -- so the lane migration shifts no default
        // frame. WebGL1 (glsl100) keeps the plain sine: no guaranteed fwidth there (tier note).
        let scanlineCount = obj.matParam1.y;
        let nyquistLines = 0.5 / max(fwidth(uv.y), 1.0e-6);
        let effScanlines = min(scanlineCount, nyquistLines);
        let scanline = sin(uv.y * effScanlines) * 0.5 + 0.5;
        color = mix(color, color * (0.4 + 0.6 * scanline), intensity);
        
        // Snow
        let snowAmount = obj.matParam1.x;
        let noise = hash2(uv * (1.0 + time));
        color = mix(color, vec3f(noise), snowAmount * intensity);
    } else {
        // Film Grayscale + Sepia
        let gray = dot(color, vec3f(0.299, 0.587, 0.114));
        let sepia = vec3f(gray * 1.2, gray * 0.9, gray * 0.6);
        color = mix(color, sepia, intensity);
        
        // Exposure Flicker
        let flickerSpeed = obj.matParam1.y;
        let flicker = 1.0 + (hash2(vec2f(floor(time * flickerSpeed), 0.0)) - 0.5) * 0.15;
        color *= mix(1.0, flicker, intensity);
        
        // Vignette
        let dist = uv - vec2f(0.5);
        let vignette = 1.0 - dot(dist, dist) * 1.5;
        color *= mix(1.0, clamp(vignette, 0.0, 1.0), intensity * 0.8);
        
        // Dust
        let dirtDensity = obj.matParam1.z;
        let dust = hash2(vec2f(floor(uv.x * 120.0), floor(uv.y * 120.0)) + floor(time * 15.0));
        if (dust > (1.0 - 0.003 * dirtDensity)) {
            color *= mix(1.0, 0.2, intensity);
        }
        
        // Scratches (emulating 2 scratches in loop)
        let scratchCount = obj.matParam1.x;
        for (var idx: i32 = 0; idx < 2; idx = idx + 1) {
            let scratchIdx = f32(idx);
            let scratchX = hash2(vec2f(floor(time * (5.0 + scratchIdx)), 7.0 + scratchIdx));
            let distToScratch = abs(uv.x - scratchX);
            if (distToScratch < 0.0015 * scratchCount) {
                let scratchActive = step(0.65, hash2(vec2f(scratchX, floor(time * 12.0))));
                color *= mix(1.0, 0.3, scratchActive * intensity);
            }
        }
    }
    
    var finalColor = color * obj.color.rgb;
    [WGSL_FOG_CALC]
    return vec4f(displayToTarget(finalColor), texCol.a * obj.color.a);
}

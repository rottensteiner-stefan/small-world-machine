[BASE_FRAGMENT_HEADER]

// E9-A / R6 (ADR 0027/0039): typed lanes -- u_matParam0 control, u_matParam1 mode params.
uniform vec4 u_matParam0;
uniform vec4 u_matParam1;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
    float intensity = u_matParam0.x;
    float time = u_matParam0.y;
    float mode = u_matParam0.w; // 0.0 = tv50s, 1.0 = film19th
    
    vec2 uv = v_uv;
    
    // --- MODE 0.0: TV 50s distortions ---
    if (mode < 0.5) {
        // Vertical rolling
        float rollSpeed = u_matParam1.w;
        uv.y = fract(uv.y + time * rollSpeed);
        
        // Horizontal tearing / wave distortion
        float tear = hash(vec2(floor(uv.y * 15.0), floor(time * 6.0)));
        if (tear > 0.92) {
            uv.x += sin(uv.y * 30.0 + time * 10.0) * 0.025 * intensity;
        }
    }
    
    vec4 texColor = texture(u_diffuseMap, uv);
    vec3 color = texColor.rgb;
    
    if (mode < 0.5) {
        // Grayscale conversion
        float gray = dot(color, vec3(0.299, 0.587, 0.114));
        color = vec3(gray);
        
        // Scanlines.
        // E9-A anti-alias guard: clamp the fixed line count to the local Nyquist bound so the sine
        // cannot flicker/alias when the surface is foreshortened far away. Identity whenever
        // fwidth(uv.y) * scanlineCount <= 0.5 (lines >= 2px apart, every normal on-screen density),
        // so the lane migration shifts no default frame. WebGL1 keeps the plain sine (tier note:
        // no guaranteed fwidth / OES_standard_derivatives).
        float scanlineCount = u_matParam1.y;
        float nyquistLines = 0.5 / max(fwidth(uv.y), 1.0e-6);
        float effScanlines = min(scanlineCount, nyquistLines);
        float scanline = sin(uv.y * effScanlines) * 0.5 + 0.5;
        color = mix(color, color * (0.4 + 0.6 * scanline), intensity);
        
        // Snow / Static Noise
        float snowAmount = u_matParam1.x;
        float noise = hash(uv * (1.0 + time));
        color = mix(color, vec3(noise), snowAmount * intensity);
    } else {
        // --- MODE 1.0: 19th Century Film ---
        // Grayscale + Sepia tint
        float gray = dot(color, vec3(0.299, 0.587, 0.114));
        vec3 sepia = vec3(
            gray * 1.2,
            gray * 0.9,
            gray * 0.6
        );
        color = mix(color, sepia, intensity);
        
        // Exposure Flicker
        float flickerSpeed = u_matParam1.y;
        float flicker = 1.0 + (hash(vec2(floor(time * flickerSpeed), 0.0)) - 0.5) * 0.15;
        color *= mix(1.0, flicker, intensity);
        
        // Vignette
        vec2 dist = uv - 0.5;
        float vignette = 1.0 - dot(dist, dist) * 1.5;
        color *= mix(1.0, clamp(vignette, 0.0, 1.0), intensity * 0.8);
        
        // Dust / Dirt particles
        float dirtDensity = u_matParam1.z;
        float dust = hash(vec2(floor(uv.x * 120.0), floor(uv.y * 120.0)) + floor(time * 15.0));
        if (dust > (1.0 - 0.003 * dirtDensity)) {
            color *= mix(1.0, hash(uv) > 0.5 ? 0.0 : 0.8, intensity);
        }
        
        // Vertical scratches
        float scratchCount = u_matParam1.x;
        for (int i = 0; i < 2; i++) {
            float scratchIdx = float(i);
            float scratchX = hash(vec2(floor(time * (5.0 + scratchIdx)), 7.0 + scratchIdx));
            float distToScratch = abs(uv.x - scratchX);
            if (distToScratch < 0.0015 * scratchCount) {
                float scratchActive = step(0.65, hash(vec2(scratchX, floor(time * 12.0))));
                color *= mix(1.0, 0.3, scratchActive * intensity);
            }
        }
    }
    
    fragColor = vec4(color, texColor.a) * u_color;
}

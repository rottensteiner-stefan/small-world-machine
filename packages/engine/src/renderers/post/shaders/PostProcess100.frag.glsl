precision mediump float;

varying vec2 v_uv;
uniform sampler2D u_hdrTexture;
uniform sampler2D u_bloomTexture;
uniform int u_bloomEnabled;
uniform float u_bloomIntensity;
uniform vec3 u_bloomColor;
uniform float u_exposure;
uniform float u_inverseGamma;
uniform int u_toneMappingMode;
uniform int u_colorGradingEnabled;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_temperature;
uniform float u_tint;
uniform vec3 u_liftColor;
uniform vec3 u_gammaColor;
uniform vec3 u_gainColor;
uniform int u_vignetteEnabled;
uniform float u_vignetteOffset;
uniform float u_vignetteDarkness;
uniform int u_grainEnabled;
uniform float u_grainIntensity;
uniform float u_time;

uniform int u_quantizeEnabled;
uniform float u_quantizeSteps;

uniform int u_flashEnabled;
uniform vec3 u_flashColor;
uniform float u_flashIntensity;

// Random noise
float random(vec2 st) {
    vec3 p3 = fract(vec3(st.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec3 toneMapReinhard(vec3 hdr, float exposure) {
    vec3 mapped = hdr * exposure;
    return mapped / (mapped + vec3(1.0));
}

vec3 toneMapCineon(vec3 hdr, float exposure) {
    vec3 mapped = max(vec3(0.0), hdr * exposure - vec3(0.004));
    return (mapped * (6.2 * mapped + vec3(0.5))) / (mapped * (6.2 * mapped + vec3(1.7)) + vec3(0.06));
}

vec3 toneMapACESFilmic(vec3 hdr, float exposure) {
    vec3 mapped = hdr * exposure;
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((mapped * (a * mapped + b)) / (mapped * (c * mapped + d) + e), 0.0, 1.0);
}

vec3 linearToSRGB(vec3 linear, float invGamma) {
    return pow(clamp(linear, 0.0, 1.0), vec3(invGamma));
}

void main() {
    // No flip needed here: the HDR FBO was rendered with the same fullscreen-triangle vertex
    // shader that produces this v_uv, so its clip-space-to-UV mapping already matches WebGL's
    // render-target storage convention (v=1 at the top, same as gl_Position.y=+1). A flip here
    // would undo that and invert the whole final image -- unlike WebGPU (see PostProcess.vert.wgsl),
    // which flips once at the vertex stage because its texture-coordinate origin is top-left.
    vec2 uv = v_uv;
    vec3 hdr = texture2D(u_hdrTexture, uv).rgb;

    // Bloom mixing
    if (u_bloomEnabled == 1) {
        vec3 bloom = texture2D(u_bloomTexture, uv).rgb;
        hdr += bloom * u_bloomIntensity * u_bloomColor;
    }

    vec3 tonemapped = hdr * u_exposure;
    if (u_toneMappingMode == 1) {
        tonemapped = toneMapReinhard(hdr, u_exposure);
    } else if (u_toneMappingMode == 2) {
        tonemapped = toneMapCineon(hdr, u_exposure);
    } else if (u_toneMappingMode == 3) {
        tonemapped = toneMapACESFilmic(hdr, u_exposure);
    }

    vec3 srgb = linearToSRGB(tonemapped, u_inverseGamma);

    // Color Grading (Kontrast/Sättigung/Temperatur-Tint/Lift-Gamma-Gain) -- eigenständiger, immer
    // verfügbarer Grading-Layer, kein Bezug zu den FILTER_COLOR_GRADING-Presets anderer Renderer.
    if (u_colorGradingEnabled == 1) {
        srgb = (srgb - 0.5) * u_contrast + 0.5;

        float luma = dot(srgb, vec3(0.2126, 0.7152, 0.0722));
        srgb = mix(vec3(luma), srgb, u_saturation);

        // Leichte multiplikative Näherung des Weißabgleichs, kein physikalisches CCT/LMS-Modell.
        srgb *= vec3(1.0 + u_temperature * 0.4 - u_tint * 0.4,
                     1.0 + u_tint * 0.2,
                     1.0 - u_temperature * 0.4 - u_tint * 0.4);

        // Lift/Gamma/Gain (ASC-CDL-Stil)
        srgb = srgb * u_gainColor + u_liftColor * (1.0 - srgb);
        srgb = pow(clamp(srgb, 0.0, 1.0), 1.0 / max(u_gammaColor, vec3(0.01)));
    }

    // Apply Vignette
    if (u_vignetteEnabled == 1) {
        float d = distance(uv, vec2(0.5));
        float innerRadius = u_vignetteOffset * 0.5;
        float vignette = 1.0 - smoothstep(innerRadius, u_vignetteOffset, d);
        srgb *= mix(1.0, vignette, clamp(u_vignetteDarkness, 0.0, 1.0));
    }

    // Apply Film Grain
    if (u_grainEnabled == 1) {
        float noise = random(gl_FragCoord.xy + vec2(u_time, -u_time));
        float grain = (noise - 0.5) * u_grainIntensity;
        srgb += vec3(grain);
    }

    // Quantize Colors (Posterization / Color Banding)
    if (u_quantizeEnabled == 1) {
        srgb = floor(srgb * u_quantizeSteps) / u_quantizeSteps;
    }

    // Full-screen flash overlay (e.g. hit/explosion feedback), driven per-frame by the active
    // camera's flash effects -- applied last so it reads as a true screen flash over everything.
    if (u_flashEnabled == 1) {
        srgb = mix(srgb, u_flashColor, clamp(u_flashIntensity, 0.0, 1.0));
    }

    gl_FragColor = vec4(srgb, 1.0);
}

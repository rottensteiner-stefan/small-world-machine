#version 300 es
precision mediump float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_hdrTexture;
uniform sampler2D u_bloomTexture;
uniform int u_bloomEnabled;
uniform sampler2D u_hbaoTexture;
uniform int u_hbaoEnabled;
uniform float u_bloomIntensity;
uniform vec3 u_bloomColor;
uniform float u_exposure;
uniform float u_gamma;
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
uniform float u_vignetteRoundness;
uniform int u_grainEnabled;
uniform float u_grainIntensity;
uniform int u_quantizeEnabled;
uniform float u_quantizeSteps;
uniform int u_outlineEnabled;
uniform float u_outlineThickness;
uniform float u_outlineSensitivity;
uniform vec3 u_outlineColor;
uniform float u_time;
uniform vec3 u_singularityScreenPos;
uniform float u_lensingEventHorizon;
uniform float u_lensingStrength;
uniform float u_lensingSpaghetti;
uniform float u_lensingBeaming;
uniform float u_lensingRingGlow;
uniform int u_flashEnabled;
uniform vec3 u_flashColor;
uniform float u_flashIntensity;

uniform int u_filterMode;

// Random noise
float random(vec2 st) {
    vec3 p3  = fract(vec3(st.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Reinhard tone mapping
vec3 toneMapReinhard(vec3 hdr, float exposure) {
    vec3 mapped = hdr * exposure;
    return mapped / (mapped + vec3(1.0));
}

// Cineon tone mapping
vec3 toneMapCineon(vec3 hdr, float exposure) {
    vec3 mapped = max(vec3(0.0), hdr * exposure - vec3(0.004));
    return (mapped * (6.2 * mapped + vec3(0.5))) / (mapped * (6.2 * mapped + vec3(1.7)) + vec3(0.06));
}

// ACES Filmic tone mapping
vec3 toneMapACESFilmic(vec3 hdr, float exposure) {
    vec3 mapped = hdr * exposure;
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((mapped * (a * mapped + b)) / (mapped * (c * mapped + d) + e), 0.0, 1.0);
}

// Linear -> sRGB gamma correction
vec3 linearToSRGB(vec3 linear, float gamma) {
    return pow(clamp(linear, 0.0, 1.0), vec3(1.0 / gamma));
}

void main() {
    // No flip needed here: the HDR FBO was rendered with the same fullscreen-triangle vertex
    // shader that produces this v_uv, so its clip-space-to-UV mapping already matches WebGL's
    // render-target storage convention (v=1 at the top, same as gl_Position.y=+1). A flip here
    // would undo that and invert the whole final image -- unlike WebGPU (see PostProcess.vert.wgsl),
    // which flips once at the vertex stage because its texture-coordinate origin is top-left.
    vec2 uv = v_uv;
    
    vec2 distortUv = uv;
    
    // Cyber Glitch (mode 3) - horizontal block glitch offset
    if (u_filterMode == 3) {
[FILTER_GLITCH_DISTORT]
    }
    // VHS Tape (mode 4) - tape tracking distortion & horizontal jitter
    else if (u_filterMode == 4) {
[FILTER_VHS_DISTORT]
    }
    // Night Vision (mode 1) - scanline jitter
    else if (u_filterMode == 1) {
        float jitter = (random(vec2(u_time * 10.0, uv.y)) - 0.5) * 0.001;
        distortUv.x += jitter;
    }
    // Old Projector (mode 6) - frame shake and bounce
    else if (u_filterMode == 6) {
        float shakeX = (random(vec2(u_time * 6.0, 1.0)) - 0.5) * 0.002;
        float shakeY = (random(vec2(u_time * 10.0, 2.0)) - 0.5) * 0.004;
        if (random(vec2(floor(u_time * 4.0), 3.0)) > 0.88) {
            shakeY += (random(vec2(u_time, 4.0)) - 0.5) * 0.012;
        }
        distortUv += vec2(shakeX, shakeY);
    }

    // Gravitational Lensing (mode 8)
    float ringGlow = 0.0;
    float beaming = 1.0;
    vec3 colorShift = vec3(1.0);
    if (u_filterMode == 8) {
        if (u_singularityScreenPos.z >= -1.0) {
            ivec2 dims = textureSize(u_hdrTexture, 0);
            float aspect = float(dims.x) / float(dims.y);
            vec2 center = u_singularityScreenPos.xy * 0.5 + vec2(0.5);
            vec2 dir = uv - center;
            dir.x *= aspect;
            float dist = length(dir);
            float eh = u_lensingEventHorizon > 0.0 ? u_lensingEventHorizon : 0.03;
            float strength = u_lensingStrength > 0.0 ? u_lensingStrength : 0.25;
            float spaghettiFactor = u_lensingSpaghetti >= 0.0 ? u_lensingSpaghetti : 0.15;
            float beamingFactor = u_lensingBeaming > 0.0 ? u_lensingBeaming : 1.2;
            float ringGlowMult = u_lensingRingGlow >= 0.0 ? u_lensingRingGlow : 2.5;

            if (dist > eh) {
                float bending = (eh * eh) / (dist * dist);
                vec2 disp = dir / dist;
                disp.x /= aspect;

                // Spaghettisation: geometric radial stretching along the gravitational gradient near horizon
                float spaghetti = pow(eh / dist, 3.0) * spaghettiFactor;
                distortUv = uv - (disp * (bending * strength + spaghetti));

                // Relativistic Beaming / Doppler effect (approaching left side boosted, receding right side dimmed)
                float dopplerFactor = -disp.x * aspect * beamingFactor;
                beaming = clamp(1.0 + dopplerFactor, 0.2, 3.0);

                // Relativistic Doppler Color Shift (Blueshift on approaching side, redshift on receding side)
                if (dopplerFactor > 0.0) {
                    colorShift = mix(vec3(1.0), vec3(0.8, 1.0, 1.4), clamp(dopplerFactor * 0.5, 0.0, 1.0));
                } else {
                    colorShift = mix(vec3(1.0), vec3(1.2, 0.6, 0.4), clamp(-dopplerFactor * 0.5, 0.0, 1.0));
                }

                // Einstein-Ring Glow directly along the photon sphere boundary
                if (dist < eh + 0.015) {
                    float glowFactor = smoothstep(eh + 0.015, eh, dist);
                    ringGlow = pow(glowFactor, 3.0) * ringGlowMult * beaming;
                }
            } else {
                distortUv = vec2(-1.0); // Sample nowhere
            }
        }
    }


    // Chromatic Aberration (sampling R, G, B at slightly different coordinates)
    vec3 hdr;
    if (u_filterMode == 3) { // Cyber Glitch (High CA)
        vec2 dir = distortUv - vec2(0.5);
        float shift = 0.025 + 0.015 * sin(u_time * 4.0);
        hdr.r = texture(u_hdrTexture, distortUv - dir * shift).r;
        hdr.g = texture(u_hdrTexture, distortUv).g;
        hdr.b = texture(u_hdrTexture, distortUv + dir * shift).b;
    } else if (u_filterMode == 4) { // VHS Tape (Linear CA)
        hdr.r = texture(u_hdrTexture, distortUv - vec2(0.008, 0.0)).r;
        hdr.g = texture(u_hdrTexture, distortUv).g;
        hdr.b = texture(u_hdrTexture, distortUv + vec2(0.008, 0.0)).b;
    } else if (u_filterMode == 2) { // Noir Detective (Edge CA)
        vec2 dDir = distortUv - vec2(0.5);
        float shift = 0.006 * length(dDir);
        hdr.r = texture(u_hdrTexture, distortUv - dDir * shift).r;
        hdr.g = texture(u_hdrTexture, distortUv).g;
        hdr.b = texture(u_hdrTexture, distortUv + dDir * shift).b;
    } else {
        hdr = texture(u_hdrTexture, distortUv).rgb;
    }

    if (u_filterMode == 8) {
        if (u_singularityScreenPos.z >= -1.0) {
            ivec2 dims = textureSize(u_hdrTexture, 0);
            float aspect = float(dims.x) / float(dims.y);
            vec2 center = u_singularityScreenPos.xy * 0.5 + vec2(0.5);
            vec2 dir = uv - center;
            dir.x *= aspect;
            float dist = length(dir);
            if (dist < 0.03) {
                hdr = vec3(0.0); // Absolute pitch black Event Horizon
            } else {
                if (dist < 0.35) {
                    float diskMask = smoothstep(0.35, 0.03, dist);
                    hdr *= mix(vec3(1.0), beaming * colorShift, diskMask);
                }
                if (ringGlow > 0.0) {
                    hdr += vec3(1.0, 0.4, 0.08) * ringGlow; // Fiery Einstein-Ring photon sphere glow
                }
            }
        }
    }

    // Bloom mixing
    if (u_bloomEnabled == 1) {
        vec3 bloom;
        if (u_filterMode == 3) {
            vec2 dir = distortUv - 0.5;
            float shift = 0.025 + 0.015 * sin(u_time * 4.0);
            bloom.r = texture(u_bloomTexture, distortUv - dir * shift).r;
            bloom.g = texture(u_bloomTexture, distortUv).g;
            bloom.b = texture(u_bloomTexture, distortUv + dir * shift).b;
        } else if (u_filterMode == 4) {
            bloom.r = texture(u_bloomTexture, distortUv - vec2(0.008, 0.0)).r;
            bloom.g = texture(u_bloomTexture, distortUv).g;
            bloom.b = texture(u_bloomTexture, distortUv + vec2(0.008, 0.0)).b;
        } else {
            bloom = texture(u_bloomTexture, distortUv).rgb;
        }
        if (u_filterMode == 8) {
            if (u_singularityScreenPos.z >= -1.0) {
                ivec2 dims = textureSize(u_hdrTexture, 0);
                float aspect = float(dims.x) / float(dims.y);
                vec2 center = u_singularityScreenPos.xy * 0.5 + vec2(0.5);
                vec2 dir = uv - center;
                dir.x *= aspect;
                if (length(dir) < 0.03) {
                    bloom = vec3(0.0);
                }
            }
        }
        hdr += bloom * u_bloomIntensity * u_bloomColor;
    }

    // Ambient Occlusion (HBAO) -- darkens the linear scene color before tonemapping, since it
    // approximates occluded incoming light rather than a display-referred image adjustment.
    if (u_hbaoEnabled == 1) {
        float hbaoVal = texture(u_hbaoTexture, distortUv).r;
        if (!isnan(hbaoVal) && !isinf(hbaoVal)) {
            hdr *= clamp(hbaoVal, 0.0, 1.0);
        }
    }

    // Tone Mapping
    vec3 tonemapped = hdr * u_exposure;
    if (u_toneMappingMode == 1) {
        tonemapped = toneMapReinhard(hdr, u_exposure);
    } else if (u_toneMappingMode == 2) {
        tonemapped = toneMapCineon(hdr, u_exposure);
    } else if (u_toneMappingMode == 3) {
        tonemapped = toneMapACESFilmic(hdr, u_exposure);
    }

    // Gamma correction
    vec3 srgb = linearToSRGB(tonemapped, u_gamma);

    // Color Grading (Kontrast/Sättigung/Temperatur-Tint/Lift-Gamma-Gain) -- eigenständiger, immer
    // verfügbarer Grading-Layer, NICHT zu verwechseln mit den FILTER_COLOR_GRADING-Kamera-Look-
    // Presets weiter unten (filterMode-Umschalter).
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
        vec2 d_uv = abs(distortUv - vec2(0.5)) * 2.0;
        float d = 0.0;
        if (u_vignetteRoundness == 2.0) {
            d = length(d_uv);
        } else {
            d = pow(pow(d_uv.x, u_vignetteRoundness) + pow(d_uv.y, u_vignetteRoundness), 1.0 / u_vignetteRoundness);
        }
        float d_old_scale = d * 0.5;
        float innerRadius = u_vignetteOffset * 0.5;
        float vignette = 1.0 - smoothstep(innerRadius, u_vignetteOffset, d_old_scale);
        srgb *= mix(1.0, vignette, clamp(u_vignetteDarkness, 0.0, 1.0));
    }

    // Apply Film Grain
    if (u_grainEnabled == 1) {
        float noise = random(gl_FragCoord.xy + vec2(u_time, -u_time));
        float grain = (noise - 0.5) * u_grainIntensity;
        srgb += vec3(grain);
    }

    // Apply Filter Color Grading
[FILTER_COLOR_GRADING]

    // Quantize Colors (Posterization / Color Banding)
    if (u_quantizeEnabled == 1) {
        srgb = floor(srgb * u_quantizeSteps) / u_quantizeSteps;
    }

    // Apply Toon / Graphic Novel Outline (Sobel Edge Detection on scene luminance)
    if (u_outlineEnabled == 1) {
        vec2 texel = vec2(u_outlineThickness) / vec2(textureSize(u_hdrTexture, 0));
        vec3 cTL = texture(u_hdrTexture, distortUv + vec2(-texel.x,  texel.y)).rgb;
        vec3 cTC = texture(u_hdrTexture, distortUv + vec2( 0.0,      texel.y)).rgb;
        vec3 cTR = texture(u_hdrTexture, distortUv + vec2( texel.x,  texel.y)).rgb;
        vec3 cML = texture(u_hdrTexture, distortUv + vec2(-texel.x,  0.0)).rgb;
        vec3 cMR = texture(u_hdrTexture, distortUv + vec2( texel.x,  0.0)).rgb;
        vec3 cBL = texture(u_hdrTexture, distortUv + vec2(-texel.x, -texel.y)).rgb;
        vec3 cBC = texture(u_hdrTexture, distortUv + vec2( 0.0,     -texel.y)).rgb;
        vec3 cBR = texture(u_hdrTexture, distortUv + vec2( texel.x, -texel.y)).rgb;

        float lTL = dot(cTL, vec3(0.299, 0.587, 0.114));
        float lTC = dot(cTC, vec3(0.299, 0.587, 0.114));
        float lTR = dot(cTR, vec3(0.299, 0.587, 0.114));
        float lML = dot(cML, vec3(0.299, 0.587, 0.114));
        float lMR = dot(cMR, vec3(0.299, 0.587, 0.114));
        float lBL = dot(cBL, vec3(0.299, 0.587, 0.114));
        float lBC = dot(cBC, vec3(0.299, 0.587, 0.114));
        float lBR = dot(cBR, vec3(0.299, 0.587, 0.114));

        float gx = (lTR + 2.0 * lMR + lBR) - (lTL + 2.0 * lML + lBL);
        float gy = (lBL + 2.0 * lBC + lBR) - (lTL + 2.0 * lTC + lTR);
        float edge = clamp(sqrt(gx * gx + gy * gy) * u_outlineSensitivity * 3.0, 0.0, 1.0);

        srgb = mix(srgb, u_outlineColor, edge);
    }

    // Full-screen flash overlay (e.g. hit/explosion feedback), driven per-frame by the active
    // camera's flash effects -- applied last so it reads as a true screen flash over everything.
    if (u_flashEnabled == 1) {
        srgb = mix(srgb, u_flashColor, clamp(u_flashIntensity, 0.0, 1.0));
    }

    fragColor = vec4(srgb, 1.0);
}

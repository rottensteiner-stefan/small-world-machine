@group(0) @binding(0) var hdrSampler: sampler;
@group(0) @binding(1) var hdrTexture: texture_2d<f32>;
@group(0) @binding(3) var bloomTexture: texture_2d<f32>;
@group(0) @binding(4) var hbaoTexture: texture_2d<f32>;

// Structural constants (overwritten at compilation time) -- these gate real code paths (branch
// taken / sample count), unlike the continuous tuning values below, which live in `dyn` instead
// so tuning them doesn't recompile the shader.
const u_toneMappingMode: u32 = 0u;
const u_colorGradingEnabled: u32 = 0u;
const u_vignetteEnabled: u32 = 0u;
const u_grainEnabled: u32 = 0u;
const u_bloomEnabled: u32 = 0u;
const u_hbaoEnabled: u32 = 0u;
const u_quantizeEnabled: u32 = 0u;
const u_outlineEnabled: u32 = 0u;
const u_flashEnabled: u32 = 0u;
const u_filterMode: u32 = 0u;

// Continuous post-process tuning values, written every frame via queue.writeBuffer -- unlike the
// structural consts above, changing these never triggers a shader recompile.
struct DynUniforms {
    a: vec4f, // [time, exposure, inverseGamma, vignetteOffset]
    b: vec4f, // [vignetteDarkness, vignetteRoundness, grainIntensity, bloomIntensity]
    c: vec4f, // [quantizeSteps, outlineThickness, outlineSensitivity, gainB]
    bloomColor: vec4f,
    outlineColor: vec4f,
    // Parametric color grading -- see ColorGradingElement.ts. Distinct from the filterMode
    // camera-look presets (FILTER_COLOR_GRADING below).
    grading0: vec4f, // [contrast, saturation, temperature, tint]
    grading1: vec4f, // [liftR, liftG, liftB, gammaR]
    grading2: vec4f, // [gammaG, gammaB, gainR, gainG]
    singularityPos: vec4f, // [screenPosX, screenPosY, screenPosZ, eventHorizonRadius]
    lensingParams: vec4f, // [strength, spaghettification, relativisticBeaming, ringGlowIntensity]
    flashParams: vec4f, // [color.r, color.g, color.b, intensity]
}
@group(0) @binding(2) var<uniform> dyn: DynUniforms;

fn random(st: vec2f) -> f32 {
    var p3  = fract(vec3f(st.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Reinhard tone mapping (simple, proven, industry-standard fallback)
fn toneMapReinhard(hdr: vec3f, exposure: f32) -> vec3f {
    let mapped = hdr * exposure;
    return mapped / (mapped + vec3f(1.0));
}

// Cineon tone mapping (Optimized filmic operator by Jim Hejl and Richard Burgess-Dawson)
fn toneMapCineon(hdr: vec3f, exposure: f32) -> vec3f {
    let mapped = max(vec3f(0.0), hdr * exposure - vec3f(0.004));
    return (mapped * (6.2 * mapped + vec3f(0.5))) / (mapped * (6.2 * mapped + vec3f(1.7)) + vec3f(0.06));
}

// ACES Filmic tone mapping (Narkowicz fit)
fn toneMapACESFilmic(hdr: vec3f, exposure: f32) -> vec3f {
    let mapped = hdr * exposure;
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((mapped * (a * mapped + b)) / (mapped * (c * mapped + d) + e), vec3f(0.0), vec3f(1.0));
}

// Linear -> sRGB gamma correction
fn linearToSRGB(linear: vec3f, invGamma: f32) -> vec3f {
    return pow(clamp(linear, vec3f(0.0), vec3f(1.0)), vec3f(invGamma));
}

@fragment
fn fs_main(@location(0) uv: vec2f, @builtin(position) coord: vec4f) -> @location(0) vec4f {
    let u_time = dyn.a.x;
    let u_exposure = dyn.a.y;
    let u_inverseGamma = dyn.a.z;
    let u_vignetteOffset = dyn.a.w;
    let u_vignetteDarkness = dyn.b.x;
    let u_vignetteRoundness = dyn.b.y;
    let u_grainIntensity = dyn.b.z;
    let u_bloomIntensity = dyn.b.w;
    let u_quantizeSteps = dyn.c.x;
    let u_outlineThickness = dyn.c.y;
    let u_outlineSensitivity = dyn.c.z;
    let u_bloomColor = dyn.bloomColor.rgb;
    let u_outlineColor = dyn.outlineColor.rgb;
    let u_contrast = dyn.grading0.x;
    let u_saturation = dyn.grading0.y;
    let u_temperature = dyn.grading0.z;
    let u_tint = dyn.grading0.w;
    let u_liftColor = dyn.grading1.xyz;
    let u_gammaColor = vec3f(dyn.grading1.w, dyn.grading2.x, dyn.grading2.y);
    let u_gainColor = vec3f(dyn.grading2.z, dyn.grading2.w, dyn.c.w);
    let u_flashColor = dyn.flashParams.rgb;
    let u_flashIntensity = dyn.flashParams.w;

    let dims = vec2f(textureDimensions(hdrTexture, 0));

    var distortUv = uv;

    // Cyber Glitch (mode 3)
    if (3u == u_filterMode) {
[FILTER_GLITCH_DISTORT]
    }
    // VHS Tape (mode 4)
    else if (4u == u_filterMode) {
[FILTER_VHS_DISTORT]
    }
    // Night Vision (mode 1)
    else if (1u == u_filterMode) {
        let jitter = (random(vec2f(u_time * 10.0, uv.y)) - 0.5) * 0.001;
        distortUv.x += jitter;
    }
    // Old Projector (mode 6)
    else if (6u == u_filterMode) {
        let shakeX = (random(vec2f(u_time * 6.0, 1.0)) - 0.5) * 0.002;
        let shakeY = (random(vec2f(u_time * 10.0, 2.0)) - 0.5) * 0.004;
        var jump = 0.0;
        if (random(vec2f(floor(u_time * 4.0), 3.0)) > 0.88) {
            jump = (random(vec2f(u_time, 4.0)) - 0.5) * 0.012;
        }
        distortUv.x += shakeX;
        distortUv.y += shakeY + jump;
    }

    // Gravitational Lensing (mode 8)
    var ringGlow: f32 = 0.0;
    var beaming: f32 = 1.0;
    var colorShift: vec3f = vec3f(1.0);
    if (8u == u_filterMode) {
        if (dyn.singularityPos.z >= -1.0) {
            let aspect = dims.x / dims.y;
            let center = dyn.singularityPos.xy * 0.5 + vec2f(0.5);
            var dir = uv - center;
            dir.x *= aspect; // Make circle instead of ellipse
            let dist = length(dir);
            let eh = select(0.03, dyn.singularityPos.w, dyn.singularityPos.w > 0.0);
            let strength = select(0.25, dyn.lensingParams.x, dyn.lensingParams.x > 0.0);
            let spaghettiFactor = select(0.15, dyn.lensingParams.y, dyn.lensingParams.y >= 0.0);
            let beamingFactor = select(1.2, dyn.lensingParams.z, dyn.lensingParams.z > 0.0);
            let ringGlowMult = select(2.5, dyn.lensingParams.w, dyn.lensingParams.w >= 0.0);

            if (dist > eh) {
                let bending = (eh * eh) / (dist * dist);
                var disp = dir / dist; // normalized
                disp.x /= aspect; // back to uv space

                // Spaghettisation: geometric radial stretching along the gravitational gradient near horizon
                let spaghetti = pow(eh / dist, 3.0) * spaghettiFactor;
                distortUv = uv - (disp * (bending * strength + spaghetti));

                // Relativistic Beaming / Doppler effect (approaching left side boosted, receding right side dimmed)
                let dopplerFactor = -disp.x * aspect * beamingFactor;
                beaming = clamp(1.0 + dopplerFactor, 0.2, 3.0);

                // Relativistic Doppler Color Shift (Blueshift on approaching side, redshift on receding side)
                if (dopplerFactor > 0.0) {
                    colorShift = mix(vec3f(1.0), vec3f(0.8, 1.0, 1.4), clamp(dopplerFactor * 0.5, 0.0, 1.0));
                } else {
                    colorShift = mix(vec3f(1.0), vec3f(1.2, 0.6, 0.4), clamp(-dopplerFactor * 0.5, 0.0, 1.0));
                }

                // Einstein-Ring Glow directly along the photon sphere boundary
                if (dist < eh + 0.015) {
                    let glowFactor = smoothstep(eh + 0.015, eh, dist);
                    ringGlow = pow(glowFactor, 3.0) * ringGlowMult * beaming;
                }
            } else {
                distortUv = vec2f(-1.0);
            }
        }
    }

    var hdr: vec3f;
    if (3u == u_filterMode) { // Cyber Glitch (High CA)
        let dir = distortUv - 0.5;
        let shift = 0.025 + 0.015 * sin(u_time * 4.0);
        hdr = vec3f(
            textureSample(hdrTexture, hdrSampler, distortUv - dir * shift).r,
            textureSample(hdrTexture, hdrSampler, distortUv).g,
            textureSample(hdrTexture, hdrSampler, distortUv + dir * shift).b
        );
    } else if (4u == u_filterMode) { // VHS Tape (Linear CA)
        hdr = vec3f(
            textureSample(hdrTexture, hdrSampler, distortUv - vec2f(0.008, 0.0)).r,
            textureSample(hdrTexture, hdrSampler, distortUv).g,
            textureSample(hdrTexture, hdrSampler, distortUv + vec2f(0.008, 0.0)).b
        );
    } else if (2u == u_filterMode) { // Noir Detective (Edge CA)
        let dir = distortUv - 0.5;
        let shift = 0.006 * length(dir);
        hdr = vec3f(
            textureSample(hdrTexture, hdrSampler, distortUv - dir * shift).r,
            textureSample(hdrTexture, hdrSampler, distortUv).g,
            textureSample(hdrTexture, hdrSampler, distortUv + dir * shift).b
        );
    } else {
        hdr = textureSample(hdrTexture, hdrSampler, distortUv).rgb;
    }

    if (8u == u_filterMode) {
        if (dyn.singularityPos.z >= -1.0) {
            let aspect = dims.x / dims.y;
            let center = dyn.singularityPos.xy * 0.5 + vec2f(0.5);
            var dir = uv - center;
            dir.x *= aspect;
            let dist = length(dir);
            if (dist < 0.03) {
                hdr = vec3f(0.0);
            } else {
                if (dist < 0.35) {
                    let diskMask = smoothstep(0.35, 0.03, dist);
                    hdr = hdr * mix(vec3f(1.0), beaming * colorShift, diskMask);
                }
                if (ringGlow > 0.0) {
                    hdr += vec3f(1.0, 0.4, 0.08) * ringGlow;
                }
            }
        }
    }

    // Bloom
    if (1u == u_bloomEnabled) {
        var bloom: vec3f;
        if (3u == u_filterMode) {
            let dir = distortUv - 0.5;
            let shift = 0.025 + 0.015 * sin(u_time * 4.0);
            bloom = vec3f(
                textureSample(bloomTexture, hdrSampler, distortUv - dir * shift).r,
                textureSample(bloomTexture, hdrSampler, distortUv).g,
                textureSample(bloomTexture, hdrSampler, distortUv + dir * shift).b
            );
        } else if (4u == u_filterMode) {
            bloom = vec3f(
                textureSample(bloomTexture, hdrSampler, distortUv - vec2f(0.008, 0.0)).r,
                textureSample(bloomTexture, hdrSampler, distortUv).g,
                textureSample(bloomTexture, hdrSampler, distortUv + vec2f(0.008, 0.0)).b
            );
        } else {
            bloom = textureSample(bloomTexture, hdrSampler, distortUv).rgb;
        }

        if (8u == u_filterMode) {
            if (dyn.singularityPos.z >= -1.0) {
                let aspect = dims.x / dims.y;
                let center = dyn.singularityPos.xy * 0.5 + vec2f(0.5);
                var dir = uv - center;
                dir.x *= aspect;
                if (length(dir) < 0.03) {
                    bloom = vec3f(0.0);
                }
            }
        }

        hdr += bloom * u_bloomIntensity * u_bloomColor;
    }

    // Ambient Occlusion (HBAO) -- darkens the linear scene color before tonemapping, since it
    // approximates occluded incoming light rather than a display-referred image adjustment.
    if (1u == u_hbaoEnabled) {
        let hbaoVal = textureSample(hbaoTexture, hdrSampler, distortUv).r;
        // `hbaoVal == hbaoVal` is the portable WGSL NaN check (no isNan() builtin, see
        // AO.frag.wgsl) -- clamp() has an unspecified result for a NaN input, so skip the
        // multiply entirely on NaN instead of trusting clamp() to sanitize it, mirroring
        // PostProcess.frag.glsl's isnan()/isinf() guard. Inf doesn't need the same treatment,
        // IEEE754 ordering for Inf is well-defined so clamp() already handles it correctly.
        if (hbaoVal == hbaoVal) {
            hdr *= clamp(hbaoVal, 0.0, 1.0);
        }
    }

    var tonemapped = hdr * u_exposure;
    if (1u == u_toneMappingMode) {
        tonemapped = toneMapReinhard(hdr, u_exposure);
    } else if (2u == u_toneMappingMode) {
        tonemapped = toneMapCineon(hdr, u_exposure);
    } else if (3u == u_toneMappingMode) {
        tonemapped = toneMapACESFilmic(hdr, u_exposure);
    }

    var srgb = linearToSRGB(tonemapped, u_inverseGamma);

    // Color Grading (Kontrast/Sättigung/Temperatur-Tint/Lift-Gamma-Gain) -- eigenständiger, immer
    // verfügbarer Grading-Layer, NICHT zu verwechseln mit den FILTER_COLOR_GRADING-Kamera-Look-
    // Presets weiter unten (filterMode-Umschalter).
    if (1u == u_colorGradingEnabled) {
        srgb = (srgb - 0.5) * u_contrast + 0.5;

        let luma = dot(srgb, vec3f(0.2126, 0.7152, 0.0722));
        srgb = mix(vec3f(luma), srgb, u_saturation);

        // Leichte multiplikative Näherung des Weißabgleichs, kein physikalisches CCT/LMS-Modell.
        srgb *= vec3f(1.0 + u_temperature * 0.4 - u_tint * 0.4,
                      1.0 + u_tint * 0.2,
                      1.0 - u_temperature * 0.4 - u_tint * 0.4);

        // Lift/Gamma/Gain (ASC-CDL-Stil)
        srgb = srgb * u_gainColor + u_liftColor * (1.0 - srgb);
        srgb = pow(clamp(srgb, vec3f(0.0), vec3f(1.0)), 1.0 / max(u_gammaColor, vec3f(0.01)));
    }

    // Apply Vignette if enabled
    if (1u == u_vignetteEnabled) {
        let d_uv = abs(distortUv - vec2f(0.5)) * 2.0;
        var d = 0.0;
        if (u_vignetteRoundness == 2.0) {
            d = length(d_uv);
        } else {
            d = pow(pow(d_uv.x, u_vignetteRoundness) + pow(d_uv.y, u_vignetteRoundness), 1.0 / u_vignetteRoundness);
        }
        let d_old_scale = d * 0.5;
        let innerRadius = u_vignetteOffset * 0.5;
        let vignette = 1.0 - smoothstep(innerRadius, u_vignetteOffset, d_old_scale);
        srgb *= mix(1.0, vignette, clamp(u_vignetteDarkness, 0.0, 1.0));
    }

    // Apply Film Grain
    if (1u == u_grainEnabled) {
        let noise = random(uv * dims + vec2f(u_time, -u_time));
        let grain = (noise - 0.5) * u_grainIntensity;
        srgb += vec3f(grain);
    }

    // Filter modes
[FILTER_COLOR_GRADING]

    // Quantize Colors (Posterization / Color Banding)
    if (1u == u_quantizeEnabled) {
        srgb = floor(srgb * u_quantizeSteps) / u_quantizeSteps;
    }

    // Apply Toon / Graphic Novel Outline (Sobel Edge Detection on scene luminance)
    if (1u == u_outlineEnabled) {
        let texel = vec2f(u_outlineThickness) / dims;
        let cTL = textureSample(hdrTexture, hdrSampler, distortUv + vec2f(-texel.x,  texel.y)).rgb;
        let cTC = textureSample(hdrTexture, hdrSampler, distortUv + vec2f( 0.0,      texel.y)).rgb;
        let cTR = textureSample(hdrTexture, hdrSampler, distortUv + vec2f( texel.x,  texel.y)).rgb;
        let cML = textureSample(hdrTexture, hdrSampler, distortUv + vec2f(-texel.x,  0.0)).rgb;
        let cMR = textureSample(hdrTexture, hdrSampler, distortUv + vec2f( texel.x,  0.0)).rgb;
        let cBL = textureSample(hdrTexture, hdrSampler, distortUv + vec2f(-texel.x, -texel.y)).rgb;
        let cBC = textureSample(hdrTexture, hdrSampler, distortUv + vec2f( 0.0,     -texel.y)).rgb;
        let cBR = textureSample(hdrTexture, hdrSampler, distortUv + vec2f( texel.x, -texel.y)).rgb;

        let lTL = dot(cTL, vec3f(0.299, 0.587, 0.114));
        let lTC = dot(cTC, vec3f(0.299, 0.587, 0.114));
        let lTR = dot(cTR, vec3f(0.299, 0.587, 0.114));
        let lML = dot(cML, vec3f(0.299, 0.587, 0.114));
        let lMR = dot(cMR, vec3f(0.299, 0.587, 0.114));
        let lBL = dot(cBL, vec3f(0.299, 0.587, 0.114));
        let lBC = dot(cBC, vec3f(0.299, 0.587, 0.114));
        let lBR = dot(cBR, vec3f(0.299, 0.587, 0.114));

        let gx = (lTR + 2.0 * lMR + lBR) - (lTL + 2.0 * lML + lBL);
        let gy = (lBL + 2.0 * lBC + lBR) - (lTL + 2.0 * lTC + lTR);
        let edge = clamp(sqrt(gx * gx + gy * gy) * u_outlineSensitivity * 3.0, 0.0, 1.0);

        srgb = mix(srgb, u_outlineColor, edge);
    }

    // Full-screen flash overlay (e.g. hit/explosion feedback), driven per-frame by the active
    // camera's flash effects -- applied last so it reads as a true screen flash over everything.
    if (1u == u_flashEnabled) {
        srgb = mix(srgb, u_flashColor, clamp(u_flashIntensity, 0.0, 1.0));
    }

    return vec4f(srgb, 1.0);
}



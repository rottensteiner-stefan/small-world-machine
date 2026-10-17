#version 300 es
precision highp float;
precision highp sampler2D;
precision highp sampler2DShadow;

in vec2 v_uv;

uniform sampler2D u_opaqueDepthMap;
uniform sampler2DShadow u_dirShadowMap;

uniform mat4 u_invViewProj;
uniform vec3 u_camPos;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform vec3 u_fogColor;
uniform vec3 u_ambientLight; // scene ambient colour * intensity
uniform float u_ambientInject;
uniform float u_fogHeight;        // baseline of the exponential height layer
uniform float u_fogHeightFalloff; // falloff above the baseline (0 = uniform)
uniform samplerCube u_irradianceMap; // IBL diffuse irradiance (black cube when the scene has none)
uniform float u_envIntensity;
uniform float u_intensity;
uniform float u_density;
uniform float u_asymmetry;
uniform float u_maxDistance;
uniform int u_samples;

uniform mat4 u_cascadeMatrices[4];
uniform vec4 u_cascadeSplits;
uniform vec4 u_dirShadowInfo; // x=bias, y=unused, z=castShadow, w=numCascades

struct FogVolumeData {
    mat4 invTransform;
    vec4 params;   // [shape, density, edgeFade, emissionIntensity]
    vec4 albedo;   // [r, g, b, pad]
    vec4 emission; // [r, g, b, pad]
    vec4 size;     // [size.x, size.y, size.z, pad]
};

uniform int u_numFogVolumes;
uniform FogVolumeData u_fogVolumes[16];
uniform float u_time;

out vec4 fragColor;

float boxSDF(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, vec3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sphereSDF(vec3 p, float r) {
    return length(p) - r;
}

float cylinderSDF(vec3 p, float r, float h) {
    vec2 d = vec2(length(p.xz), abs(p.y)) - vec2(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2(0.0)));
}

// Analytical procedural 3D noise for animated rolling mist and billowy cloud pockets.
float hash13(vec3 p) {
    vec3 q = fract(p * 0.1031);
    float d = dot(q, q.zyx + vec3(31.32));
    return fract((q.x + q.y) * q.z * d);
}

float valueNoise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);

    float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

    float nx0 = mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y);
    float nx1 = mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y);
    return mix(nx0, nx1, u.z);
}

float fbm3D(vec3 p) {
    return 0.65 * valueNoise3D(p) + 0.35 * valueNoise3D(p * 2.05 + vec3(1.7, 3.2, 5.1));
}

float getIGN(vec2 screenPos) {
    vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(screenPos, magic.xy)));
}

float sampleShadow(vec3 pos) {
    if (u_dirShadowInfo.z < 0.5 || u_dirShadowInfo.w < 1.0) {
        return 1.0;
    }

    int numCascades = int(u_dirShadowInfo.w);
    int cascadeIndex = numCascades - 1;
    float viewDist = length(u_camPos - pos);

    for (int c = 0; c < 4; c++) {
        if (c >= numCascades) break;
        if (viewDist < u_cascadeSplits[c]) {
            cascadeIndex = c;
            break;
        }
    }

    vec4 lightSpacePos = u_cascadeMatrices[cascadeIndex] * vec4(pos, 1.0);
    vec3 proj = lightSpacePos.xyz / lightSpacePos.w * 0.5 + 0.5;
    if (proj.z > 1.0 || proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0) {
        return 1.0;
    }

    float cols = ceil(sqrt(u_dirShadowInfo.w));
    vec2 cell = vec2(mod(float(cascadeIndex), cols), floor(float(cascadeIndex) / cols));
    vec2 cellMin = cell / cols;
    vec2 cellMax = cellMin + vec2(1.0 / cols);
    vec2 atlasUV = clamp((proj.xy + cell) / cols, cellMin, cellMax);

    return texture(u_dirShadowMap, vec3(atlasUV, proj.z - u_dirShadowInfo.x));
}

void main() {
    float rawDepth = texture(u_opaqueDepthMap, v_uv).r;

    // Reconstruct world position from depth buffer
    vec4 ndc = vec4(v_uv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
    vec4 worldH = u_invViewProj * ndc;
    vec3 worldPos = worldH.xyz / worldH.w;

    vec3 toPos = worldPos - u_camPos;
    float distToSurface = length(toPos);
    vec3 rayDir = toPos / max(distToSurface, 0.0001);

    // If depth is at far plane (sky / unhit), march out to u_maxDistance
    float marchDist = (rawDepth >= 0.99999) ? u_maxDistance : min(distToSurface, u_maxDistance);
    if (marchDist <= 0.001) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    int steps = clamp(u_samples, 4, 32);
    float dt = marchDist / float(steps);

    // Schlick (1993) phase function approximation of Henyey-Greenstein
    float g = clamp(u_asymmetry, -0.95, 0.95);
    float k = 1.55 * g - 0.55 * (g * g * g);
    float cosTheta = dot(rayDir, normalize(u_sunDir));
    float denom = 1.0 - k * cosTheta;
    float phase = (1.0 - k * k) / (12.566370614359172 * max(denom * denom, 0.0001));

    // Ambient inject: scene ambient colour plus the IBL irradiance from above (same as WebGPU).
    vec3 skyAmbient = u_ambientLight;
    if (u_ambientInject > 0.0) {
        skyAmbient += texture(u_irradianceMap, vec3(0.0, 1.0, 0.0)).rgb * u_envIntensity;
    }

    float jitter = getIGN(gl_FragCoord.xy);
    vec3 accumulatedLight = vec3(0.0);
    float transmittance = 1.0;

    for (int i = 0; i < 32; i++) {
        if (i >= steps) break;
        float t = (float(i) + jitter) * dt;
        if (t > marchDist) break;

        vec3 samplePos = u_camPos + rayDir * t;
        float shadow = sampleShadow(samplePos);

        float localDensity =
            u_density * exp(-u_fogHeightFalloff * max(samplePos.y - u_fogHeight, 0.0));
        vec3 localEmission = vec3(0.0);
        vec3 localAlbedo = u_fogColor;

        for (int v = 0; v < 16; v++) {
            if (v >= u_numFogVolumes) break;
            vec3 pLocal = (u_fogVolumes[v].invTransform * vec4(samplePos, 1.0)).xyz;
            int shape = int(u_fogVolumes[v].params.x);
            float sdf = 1.0;
            if (shape == 0) {
                sdf = boxSDF(pLocal, u_fogVolumes[v].size.xyz);
            } else if (shape == 1) {
                sdf = sphereSDF(pLocal, u_fogVolumes[v].size.x);
            } else if (shape == 2) {
                sdf = cylinderSDF(pLocal, u_fogVolumes[v].size.x, u_fogVolumes[v].size.y);
            }

            if (sdf <= 0.0) {
                float minDim = min(u_fogVolumes[v].size.x, min(u_fogVolumes[v].size.y, u_fogVolumes[v].size.z));
                float fadeDist = max(minDim * u_fogVolumes[v].params.z, 0.0001);
                float falloff = clamp(-sdf / fadeDist, 0.0, 1.0);
                falloff = falloff * falloff * (3.0 - 2.0 * falloff);

                float volDensity = u_fogVolumes[v].params.y * falloff;

                float noiseAmount = u_fogVolumes[v].emission.w;
                float noiseScale = u_fogVolumes[v].albedo.w;
                if (noiseAmount > 0.0 && noiseScale > 0.0 && volDensity > 0.0) {
                    vec3 drift = vec3(1.0, 0.15, 0.4) * (u_fogVolumes[v].size.w * u_time);
                    vec3 pNoise = pLocal * noiseScale - drift;
                    float turb = fbm3D(pNoise);
                    volDensity = volDensity * mix(1.0, clamp(turb * 1.8, 0.0, 3.0), noiseAmount);
                }

                localDensity = max(0.0, localDensity + volDensity);
                if (volDensity > 0.0) {
                    localEmission += u_fogVolumes[v].emission.rgb * u_fogVolumes[v].params.w * falloff;
                    localAlbedo = mix(localAlbedo, u_fogVolumes[v].albedo.rgb, clamp(falloff, 0.0, 1.0));
                }
            }
        }

        float stepOpticalDepth = localDensity * dt;
        float stepTau = clamp(stepOpticalDepth, 0.0, 10.0);
        float stepTransmittance = exp(-stepTau);

        // Decima Powder effect: forward-scattering highlights along edges
        float powder = 1.0 - exp(-stepTau * 2.0);

        // Sunlight in-scattering + ambient base fog scattering
        vec3 sunScattering = shadow * u_sunColor * phase * powder;
        vec3 ambientScattering = localAlbedo * skyAmbient * u_ambientInject + localEmission;
        vec3 stepLight = sunScattering + ambientScattering;

        accumulatedLight += transmittance * stepLight * (1.0 - stepTransmittance);
        transmittance *= stepTransmittance;

        if (transmittance < 0.001) break;
    }

    fragColor = vec4(accumulatedLight * u_intensity, transmittance);
}

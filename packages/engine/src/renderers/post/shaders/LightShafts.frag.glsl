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
uniform float u_intensity;
uniform float u_density;
uniform float u_asymmetry;
uniform float u_maxDistance;
uniform int u_samples;

uniform mat4 u_cascadeMatrices[4];
uniform vec4 u_cascadeSplits;
uniform vec4 u_dirShadowInfo; // x=bias, y=normalBias, z=castShadow, w=numCascades

out vec4 fragColor;

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
        fragColor = vec4(0.0);
        return;
    }

    int steps = clamp(u_samples, 4, 32);
    float dt = marchDist / float(steps);

    // Schlick phase function: k ~ 1.55g - 0.55g^3
    float g = clamp(u_asymmetry, -0.95, 0.95);
    float k = 1.55 * g - 0.55 * (g * g * g);
    float cosTheta = dot(rayDir, normalize(u_sunDir));
    float denom = 1.0 - k * cosTheta;
    float phase = (1.0 - k * k) / (12.566370614359172 * max(denom * denom, 0.0001));

    float jitter = getIGN(gl_FragCoord.xy);
    vec3 accumulatedLight = vec3(0.0);
    float opticalDepth = 0.0;

    for (int i = 0; i < 32; i++) {
        if (i >= steps) break;
        float t = (float(i) + jitter) * dt;
        if (t > marchDist) break;

        vec3 samplePos = u_camPos + rayDir * t;
        float shadow = sampleShadow(samplePos);

        float stepOpticalDepth = u_density * dt;
        opticalDepth += stepOpticalDepth;
        float transmittance = exp(-opticalDepth);

        accumulatedLight += shadow * u_sunColor * phase * transmittance * stepOpticalDepth;
    }

    fragColor = vec4(accumulatedLight * u_intensity, 1.0);
}

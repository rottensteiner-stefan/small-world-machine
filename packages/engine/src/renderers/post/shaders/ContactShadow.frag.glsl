#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_opaqueDepthMap;
uniform float u_near;
uniform float u_far;
uniform vec2 u_projScale;     // Projection matrix diagonal (data[0], data[5])
uniform vec4 u_lightDirView;  // xyz = normalized direction TOWARDS light in view space, w = intensity
uniform vec4 u_params;        // x = maxDistance, y = thickness, z = fadeDistance, w = bias
uniform vec4 u_settings;      // x = raySteps (float)

float linearizeDepth(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * u_near * u_far) / (u_far + u_near - z * (u_far - u_near));
}

vec3 reconstructViewPos(vec2 uv, float linearZ) {
    vec2 ndc = uv * 2.0 - 1.0;
    return vec3(ndc.x * linearZ / u_projScale.x, ndc.y * linearZ / u_projScale.y, -linearZ);
}

vec3 projectViewToScreen(vec3 viewPos) {
    float linearZ = -viewPos.z;
    if (linearZ <= 0.0001) {
        return vec3(-1.0, -1.0, 0.0);
    }
    float ndcX = (viewPos.x * u_projScale.x) / linearZ;
    float ndcY = (viewPos.y * u_projScale.y) / linearZ;
    vec2 uv = vec2(ndcX * 0.5 + 0.5, ndcY * 0.5 + 0.5);
    return vec3(uv, linearZ);
}

// Interleaved Gradient Noise (Jorge Jimenez, 2014) for high-frequency ray jittering without banding
float interleavedGradientNoise(vec2 pixelCoord) {
    vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(pixelCoord, magic.xy)));
}

void main() {
    float depth = texture(u_opaqueDepthMap, v_uv).r;

    // Sky or clear background
    if (depth >= 1.0) {
        fragColor = vec4(1.0);
        return;
    }

    float linearZ = linearizeDepth(depth);
    vec3 viewPos = reconstructViewPos(v_uv, linearZ);

    float maxDist = u_params.x;
    float thickness = u_params.y;
    float fadeDist = u_params.z;
    float bias = u_params.w;
    float intensity = u_lightDirView.w;
    int steps = int(max(u_settings.x, 1.0));

    // Distance fade out beyond fadeDist
    if (linearZ >= fadeDist) {
        fragColor = vec4(1.0);
        return;
    }
    float distanceFade = clamp(1.0 - (linearZ / fadeDist), 0.0, 1.0);

    vec3 L_view = u_lightDirView.xyz;

    // Ray start and end in view space
    vec3 rayStart = viewPos + L_view * (bias * 2.0);
    vec3 rayEnd = viewPos + L_view * maxDist;

    // Projected start and end in screen UV [0, 1] and linear Z
    vec3 startScreen = projectViewToScreen(rayStart);
    vec3 endScreen = projectViewToScreen(rayEnd);

    vec2 rayDelta = endScreen.xy - startScreen.xy;
    float rayZDelta = endScreen.z - startScreen.z;

    float noise = interleavedGradientNoise(gl_FragCoord.xy);
    float stepSize = 1.0 / float(steps);

    float occlusion = 0.0;

    for (int i = 0; i < steps; i++) {
        float t = (float(i) + noise) * stepSize;
        vec2 sampleUV = startScreen.xy + rayDelta * t;
        float sampleRayZ = startScreen.z + rayZDelta * t;

        // Clip against screen boundaries
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
            break;
        }

        float sampleDepth = texture(u_opaqueDepthMap, sampleUV).r;
        if (sampleDepth >= 1.0) {
            continue;
        }

        float sampleSceneZ = linearizeDepth(sampleDepth);
        float depthDiff = sampleRayZ - sampleSceneZ;

        // If the ray is behind the scene geometry but within the thickness threshold:
        if (depthDiff > bias && depthDiff < thickness) {
            // Screen edge fade so shadows don't abruptly pop at edges
            float edgeDist = min(sampleUV.x, min(1.0 - sampleUV.x, min(sampleUV.y, 1.0 - sampleUV.y)));
            float edgeFade = smoothstep(0.0, 0.05, edgeDist);

            // Proximity weighting: closer occluder = darker shadow
            float proximity = 1.0 - (float(i) / float(steps));
            occlusion = max(occlusion, edgeFade * proximity);
            if (occlusion >= 0.95) {
                break;
            }
        }
    }

    float shadow = 1.0 - (occlusion * distanceFade * intensity);
    float clampedShadow = clamp(shadow, 0.0, 1.0);
    fragColor = vec4(clampedShadow, clampedShadow, clampedShadow, 1.0);
}

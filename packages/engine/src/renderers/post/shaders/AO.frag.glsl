#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_opaqueDepthMap;
uniform float u_near;
uniform float u_far;
uniform vec2 u_projScale; // (A, B) = the perspective projection matrix's [0] and [5] diagonal terms
uniform float u_radius;
uniform float u_intensity;
uniform vec2 u_texelSize;
uniform sampler2D u_normalMap; // world-space octahedral normals (ADR 0028), only read when u_useNormalBuffer
uniform float u_useNormalBuffer;
uniform mat3 u_viewRot; // world -> view rotation

// Same octahedral decode as the WebGPU shaders.
vec3 octDecode(vec2 e) {
    vec3 n = vec3(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
    vec2 folded = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    return normalize(vec3(n.z < 0.0 ? folded : n.xy, n.z));
}

// Standard OpenGL depth-buffer -> linear view-space distance conversion, using this engine's
// perspective matrix layout (see Matrix4.perspective): depth [0,1] -> NDC z [-1,1] -> linear Z.
float linearizeDepth(float d) {
    float z = d * 2.0 - 1.0;
    return (2.0 * u_near * u_far) / (u_far + u_near - z * (u_far - u_near));
}

// Reconstructs view-space position from screen UV + linear view-space depth, using the
// projection matrix's diagonal scale terms -- no full inverse-projection matrix needed since
// we only need X/Y, not a general unproject.
vec3 reconstructViewPos(vec2 uv, float linearZ) {
    vec2 ndc = uv * 2.0 - 1.0;
    return vec3(ndc.x * linearZ / u_projScale.x, ndc.y * linearZ / u_projScale.y, -linearZ);
}

void main() {
    float depth = texture(u_opaqueDepthMap, v_uv).r;
    if (depth >= 1.0) {
        fragColor = vec4(1.0);
        return;
    }

    float linearZ = linearizeDepth(depth);
    vec3 viewPos = reconstructViewPos(v_uv, linearZ);

    // Reconstruct a view-space normal from screen-space derivatives of the reconstructed
    // position -- avoids needing a real normal G-buffer, at the cost of faceting on curved
    // surfaces (a standard, documented trade-off for depth-only screen-space AO).
    vec3 dX = dFdx(viewPos);
    vec3 dY = dFdy(viewPos);
    vec3 crossN = cross(dX, dY);
    float lenSq = dot(crossN, crossN);
    // Judged relative to the edge lengths: an absolute threshold rejected every cross product on
    // high-resolution canvases (see AO.frag.wgsl) and left the camera-axis fallback everywhere.
    float edgeScaleSq = dot(dX, dX) * dot(dY, dY);
    bool validNormal = edgeScaleSq > 0.0 && lenSq > 0.0001 * edgeScaleSq;
    vec3 normal = validNormal ? normalize(crossN) : vec3(0.0, 0.0, 1.0);
    if (normal.z < 0.0) normal = -normal; // Face the camera (+z in view space)

    // ADR 0028: prefer the normal buffer (normal-mapped, no faceting or silhouette artifacts).
    // The sentinel (|x| > 1) marks pixels nothing wrote to, which keep the depth-derived normal.
    if (u_useNormalBuffer > 0.5) {
        vec2 encoded = texture(u_normalMap, v_uv).rg;
        if (abs(encoded.x) <= 1.0 && abs(encoded.y) <= 1.0) {
            vec3 viewNormal = u_viewRot * octDecode(encoded);
            normal = viewNormal.z < 0.0 ? -viewNormal : viewNormal;
        }
    }

    // Simplified HBAO: march a small ring of directions, find the steepest (highest-sine)
    // horizon angle visible along each, and average -- the same core idea as full HBAO's
    // horizon integration, just with one max-sample per direction instead of an angular
    // integral, and no separate temporal/spatial denoise pass (combined here into one shader).
    const int DIR_COUNT = 6;
    vec2 dirs[DIR_COUNT];
    dirs[0] = vec2(1.0, 0.0);
    dirs[1] = vec2(0.5, 0.866025);
    dirs[2] = vec2(-0.5, 0.866025);
    dirs[3] = vec2(-1.0, 0.0);
    dirs[4] = vec2(-0.5, -0.866025);
    dirs[5] = vec2(0.5, -0.866025);

    const int STEPS = 4;
    float occlusion = 0.0;
    for (int d = 0; d < DIR_COUNT; d++) {
        float maxHorizonSin = 0.0;
        for (int s = 1; s <= STEPS; s++) {
            vec2 sampleUv = v_uv + dirs[d] * u_texelSize * float(s) * 4.0;
            if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) {
                continue;
            }

            float sDepth = texture(u_opaqueDepthMap, sampleUv).r;
            if (sDepth >= 1.0) continue;

            float sLinearZ = linearizeDepth(sDepth);
            vec3 sViewPos = reconstructViewPos(sampleUv, sLinearZ);

            vec3 toSample = sViewPos - viewPos;
            float dist = length(toSample);
            if (dist > u_radius || dist < 0.0001) continue;

            float horizonSin = dot(toSample / dist, normal);
            if (!isnan(horizonSin) && !isinf(horizonSin)) {
                maxHorizonSin = max(maxHorizonSin, horizonSin);
            }
        }
        occlusion += clamp(maxHorizonSin, 0.0, 1.0);
    }
    occlusion /= float(DIR_COUNT);

    float ao = clamp(1.0 - occlusion * u_intensity, 0.0, 1.0);
    if (isnan(ao) || isinf(ao)) {
        ao = 1.0;
    }
    fragColor = vec4(ao, 0.0, 0.0, 1.0);
}

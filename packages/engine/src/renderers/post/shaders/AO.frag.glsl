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

// View-space position (xyz) and linear depth (w) of the pixel at `uv`; sky counts as infinitely far.
vec4 neighbourViewPos(vec2 uv) {
    float d = texture(u_opaqueDepthMap, uv).r;
    if (d >= 1.0) return vec4(0.0, 0.0, 0.0, 1.0e9);
    float z = linearizeDepth(d);
    return vec4(reconstructViewPos(uv, z), z);
}

void main() {
    float depth = texture(u_opaqueDepthMap, v_uv).r;
    if (depth >= 1.0) {
        fragColor = vec4(1.0);
        return;
    }

    float linearZ = linearizeDepth(depth);
    vec3 viewPos = reconstructViewPos(v_uv, linearZ);

    // Flat geometric normal from depth (Turanszki, "Improved normal reconstruction from depth"):
    // per axis the neighbour whose depth is closest to the centre forms the triangle, so the edge
    // never reaches across a silhouette. Deliberately not the normal buffer: that normal carries
    // the receiver's normal map, but the horizon test marches against flat depth, so a bumped
    // normal lets rays dip below the surface and over-darkens (the article's warning about SSAO).
    vec4 right = neighbourViewPos(v_uv + vec2(u_texelSize.x, 0.0));
    vec4 left = neighbourViewPos(v_uv - vec2(u_texelSize.x, 0.0));
    vec4 up = neighbourViewPos(v_uv + vec2(0.0, u_texelSize.y));
    vec4 down = neighbourViewPos(v_uv - vec2(0.0, u_texelSize.y));
    bool useRight = abs(right.w - linearZ) <= abs(left.w - linearZ);
    bool useUp = abs(up.w - linearZ) <= abs(down.w - linearZ);
    vec3 dX = useRight ? right.xyz - viewPos : viewPos - left.xyz;
    vec3 dY = useUp ? up.xyz - viewPos : viewPos - down.xyz;
    if ((useRight ? right.w : left.w) >= 1.0e8) dX = vec3(0.0);
    if ((useUp ? up.w : down.w) >= 1.0e8) dY = vec3(0.0);
    vec3 crossN = cross(dX, dY);
    float lenSq = dot(crossN, crossN);
    // Judged relative to the edge lengths: an absolute threshold rejected every cross product on
    // high-resolution canvases (see AO.frag.wgsl) and left the camera-axis fallback everywhere.
    float edgeScaleSq = dot(dX, dX) * dot(dY, dY);
    bool validNormal = edgeScaleSq > 0.0 && lenSq > 0.0001 * edgeScaleSq;
    vec3 normal = validNormal ? normalize(crossN) : vec3(0.0, 0.0, 1.0);
    if (normal.z < 0.0) normal = -normal; // Face the camera (+z in view space)

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

    // March distance follows the world-space radius: radius * projScaleY * (height / 2) / linearZ
    // is the radius projected to pixels. Min 4 px keeps contact AO alive at distance (steps would
    // collapse onto the centre texel); max 128 px bounds the texture-fetch cost of close-ups.
    float pixelRadius = clamp(u_radius * u_projScale.y * 0.5 / (u_texelSize.y * linearZ), 4.0, 128.0);
    float stepPixels = pixelRadius / 4.0;

    const int STEPS = 4;
    float occlusion = 0.0;
    for (int d = 0; d < DIR_COUNT; d++) {
        float maxHorizonSin = 0.0;
        for (int s = 1; s <= STEPS; s++) {
            vec2 sampleUv = v_uv + dirs[d] * u_texelSize * float(s) * stepPixels;
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

[BASE_FRAGMENT_HEADER]
[FOG_DEFS]
[LIGHT_DEFS]
[PBR_MATH]

// The lighting chunk reads the standard fragment varyings; a decal has no meaningful ones (the
// rasterised box is only a screen-space footprint), so alias them to locals filled from the depth.
vec3 g_wp;
vec3 g_n;
vec2 g_uv;
mat3 g_tbn;
#define v_worldPos g_wp
#define v_normal g_n
#define v_uv g_uv
#define v_tbn g_tbn

// Spot-light shadow coordinates are a vertex-stage varying in the standard shader; for a decal
// they must come from the reconstructed surface position, so they are recomputed per pixel.
uniform mat4 u_spotShadowMatrix[4];
vec4 g_spotLS[4];
#define v_spotLightSpacePos g_spotLS

// Explicit UV derivatives (implicit ones are garbage across depth discontinuities).
vec2 g_uvGradX;
vec2 g_uvGradY;
#undef SAMPLE_NORMAL_MAP
#undef SAMPLE_EMISSIVE_MAP
#define SAMPLE_NORMAL_MAP(uv) textureGrad(u_normalMap, uv, g_uvGradX, g_uvGradY)
#define SAMPLE_EMISSIVE_MAP(uv) textureGrad(u_emissiveMap, uv, g_uvGradX, g_uvGradY)

uniform float u_metallic;
uniform float u_roughness;
uniform vec4 u_liquidParams;
uniform vec4 u_thresholds;
uniform vec2 u_texOffset;
uniform vec2 u_texRepeat;
uniform float u_useEnvMap;
uniform float u_useReflectionMap;
uniform float u_reflectivity;
uniform float u_pad1;
uniform float u_time;

uniform mat4 u_model;
uniform mat4 u_decalClipToBox;
uniform vec4 u_decalFade; // [edgeFade, cosStart, cosEnd, unused]
uniform float u_decalHasNormalBuffer;
uniform sampler2D u_opaqueDepthMap;
uniform sampler2D u_normalBufferMap;

// Same octahedral decode as the WebGPU shaders.
vec3 octDecode(vec2 e) {
    vec3 n = vec3(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
    vec2 folded = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    return normalize(vec3(n.z < 0.0 ? folded : n.xy, n.z));
}

// Unprojects one pixel's opaque depth into the decal's unit box. xyz = box position, w = raw depth.
vec4 decalUnproject(ivec2 px, vec2 size) {
    float depth = texelFetch(u_opaqueDepthMap, px, 0).r;
    vec4 ndc = vec4((vec2(px) + 0.5) / size * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 h = u_decalClipToBox * ndc;
    return vec4(h.xyz / h.w, depth);
}

// Neighbour (forward or backward) whose depth is closer to the centre's, so a finite difference
// never reaches across a silhouette; sky neighbours count as infinitely far.
vec3 decalNeighbourDelta(vec4 centre, vec4 forward, vec4 backward) {
    float forwardGap = forward.w >= 1.0 ? 1.0e9 : abs(forward.w - centre.w);
    float backwardGap = backward.w >= 1.0 ? 1.0e9 : abs(backward.w - centre.w);
    return forwardGap <= backwardGap ? forward.xyz - centre.xyz : centre.xyz - backward.xyz;
}

void main() {
    ivec2 px = ivec2(gl_FragCoord.xy);
    ivec2 isize = textureSize(u_opaqueDepthMap, 0);
    vec2 size = vec2(isize);
    ivec2 last = isize - ivec2(1);
    vec4 centre = decalUnproject(px, size);
    vec3 boxPos = centre.xyz;

    bool inside = centre.w < 1.0 && all(lessThanEqual(abs(boxPos), vec3(0.5)));
    if (!inside) discard;

    // Three taps per axis give the surface's tangent vectors and the UV derivatives.
    vec3 stepX = decalNeighbourDelta(centre,
        decalUnproject(min(px + ivec2(1, 0), last), size),
        decalUnproject(max(px - ivec2(1, 0), ivec2(0)), size));
    vec3 stepY = decalNeighbourDelta(centre,
        decalUnproject(min(px + ivec2(0, 1), last), size),
        decalUnproject(max(px - ivec2(0, 1), ivec2(0)), size));
    g_uvGradX = stepX.xz;
    g_uvGradY = stepY.xz;

    vec3 surfaceWorld = (u_model * vec4(boxPos, 1.0)).xyz;
    vec3 viewDir = normalize(u_viewPos - surfaceWorld);
    vec3 worldX = (u_model * vec4(stepX, 0.0)).xyz;
    vec3 worldY = (u_model * vec4(stepY, 0.0)).xyz;
    vec3 tangentCross = cross(worldX, worldY);
    // Relative test (sin^2 of the angle between the edges): see AO.frag.wgsl for why not absolute.
    float edgeScaleSq = dot(worldX, worldX) * dot(worldY, worldY);
    bool validDerived = edgeScaleSq > 0.0 && dot(tangentCross, tangentCross) > 0.0001 * edgeScaleSq;
    vec3 baseNormal = validDerived ? normalize(tangentCross) : viewDir;
    if (dot(baseNormal, viewDir) < 0.0) baseNormal = -baseNormal;

    if (u_decalHasNormalBuffer > 0.5) {
        vec2 encoded = texelFetch(u_normalBufferMap, px, 0).rg;
        if (abs(encoded.x) <= 1.0 && abs(encoded.y) <= 1.0) baseNormal = octDecode(encoded);
    }

    vec3 decalUp = normalize(u_model[1].xyz);
    float angleFade = smoothstep(u_decalFade.z, u_decalFade.y, dot(baseNormal, decalUp));
    vec3 toEdge = vec3(0.5) - abs(boxPos);
    float edgeFade = clamp(min(toEdge.x, min(toEdge.y, toEdge.z)) / max(u_decalFade.x, 0.0001), 0.0, 1.0);

    vec3 tangentSeed = normalize(u_model[0].xyz);
    vec3 tangent = normalize(tangentSeed - baseNormal * dot(tangentSeed, baseNormal));
    g_wp = surfaceWorld;
    g_n = baseNormal;
    g_uv = boxPos.xz + vec2(0.5);
    g_tbn = mat3(tangent, cross(baseNormal, tangent), baseNormal);

    for (int i = 0; i < 4; i++) {
        if (i >= u_numSpotLights) break;
        vec3 spotL = normalize(u_spotLights[i].pos - g_wp);
        float spotNdotL = max(dot(g_n, spotL), 0.0);
        vec3 spotShadowSamplePos = g_wp + g_n * u_spotShadowInfo[i].y * (1.0 - spotNdotL);
        g_spotLS[i] = u_spotShadowMatrix[i] * vec4(spotShadowSamplePos, 1.0);
    }

    vec4 texColor = textureGrad(u_diffuseMap, g_uv, g_uvGradX, g_uvGradY);
    texColor.a *= angleFade * edgeFade;
    vec3 albedo = sRGBToLinear(texColor.rgb) * sRGBToLinear(u_color.rgb);
    float metallic = u_metallic;
    float roughness = clamp(u_roughness, 0.05, 1.0);
    float ao = u_extraParams.x;

    [LIGHT_CALC_PBR]

    [FOG_CALC]
}

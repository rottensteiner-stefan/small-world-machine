precision highp int;

struct PointLight {
    vec3 pos;
    float distance;
    vec3 color;
    float decay;
};

struct SpotLight {
    vec3 pos;
    float _pad;
    vec3 dir;
    float _pad2;
    vec3 color;
    float _pad3;
    vec4 params; // intensity, inner, outer, range
};

struct AreaLight {
    vec3 pos;
    float _pad;
    vec3 color;
    float _pad2;
    vec3 right;
    float _pad3;
    vec3 up;
    float _pad4;
    vec3 normal;
    float _pad5;
    vec2 size;
    vec2 params; // x: distance, y: decay
};

// Note: This block must match the one in headers exactly if not using separate files
// But since these are chunks, we only define the arrays here and expect the UBO to be open.
// Actually, in WebGL2 it's better to define the WHOLE UBO in one chunk or repeat it.
// Let's redefine the WHOLE GlobalUniforms here to be safe and clear.

layout(std140) uniform GlobalUniforms {
    mat4 u_vp;
    vec3 u_viewPos;
    int _pad0;
    vec3 u_ambientColor;
    int _pad1;
    vec3 u_dirLightColor;
    int _pad2;
    vec3 u_dirLightDir;
    int _pad3;
    int u_numPointLights;
    int u_numSpotLights;
    int u_numAreaLights;
    float u_gamma;
    float u_exposure;
    float _pad4;
    vec2 u_cameraNearFar;
    PointLight u_pointLights[16];
    SpotLight u_spotLights[16];
    // Must match MAX_AREA_LIGHTS in src/core/lights/AreaLight.ts -- GLSL can't import it, so this
    // has to be kept in sync by hand.
    AreaLight u_areaLights[4];
    // Clustered light culling (see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md) --
    // WebGLClusterCullPass (CPU) writes these every frame via WebGL2Renderer.writeClusterGridUniforms().
    vec2 u_tileSizePx;
    vec4 u_clusterDims; // x/y/z cell counts, w = maxLightsPerCluster, all as float
};

// Clustered light culling data textures: RGBA32UI (point.rg, spot.ba) per cluster cell,
// RG32UI (point.r, spot.g) flat index lists. Fixed texture units (see CLUSTER_GRID_UNIT and
// CLUSTER_INDEX_UNIT in ClusterGrid.ts), bound outside the generic per-material sampler system.
precision highp usampler2D;
uniform usampler2D u_clusterGrid;
uniform usampler2D u_clusterIndices;

// Must match CLUSTER_TEX_WIDTH in src/math/ClusterGrid.ts exactly -- WebGL2 has no 1D texture
// target, so the flat cluster/index arrays are laid out on a fixed-width 2D texture instead.
const int CLUSTER_TEX_WIDTH = 1024;

// WebGL2's raw light array is capped at 16 (see the ADR above), so a cluster can never need
// more than 16 light slots regardless of `maxLightsPerCluster` config -- this constant only
// needs to be large enough to cover that, not the configured value itself.
const int CLUSTER_MAX_LIGHTS = 16;

uvec2 fetchPointClusterGridEntry(int cellIndex) {
    ivec2 coord = ivec2(cellIndex % CLUSTER_TEX_WIDTH, cellIndex / CLUSTER_TEX_WIDTH);
    return texelFetch(u_clusterGrid, coord, 0).rg;
}

uvec2 fetchSpotClusterGridEntry(int cellIndex) {
    ivec2 coord = ivec2(cellIndex % CLUSTER_TEX_WIDTH, cellIndex / CLUSTER_TEX_WIDTH);
    return texelFetch(u_clusterGrid, coord, 0).ba;
}

uint fetchPointClusterLightIndex(int flatIndex) {
    ivec2 coord = ivec2(flatIndex % CLUSTER_TEX_WIDTH, flatIndex / CLUSTER_TEX_WIDTH);
    return texelFetch(u_clusterIndices, coord, 0).r;
}

uint fetchSpotClusterLightIndex(int flatIndex) {
    ivec2 coord = ivec2(flatIndex % CLUSTER_TEX_WIDTH, flatIndex / CLUSTER_TEX_WIDTH);
    return texelFetch(u_clusterIndices, coord, 0).g;
}

// Same cell/index formula as cluster_cull.wgsl's fragment-side lookup on WebGPU.
int computeClusterCellIndex(vec3 viewPos, vec3 worldPos, vec4 clusterDims, vec2 cameraNearFar, vec2 tileSizePx) {
    ivec3 dims = ivec3(clusterDims.xyz);
    int cellX = min(int(gl_FragCoord.x / tileSizePx.x), dims.x - 1);
    int cellY = min(int(gl_FragCoord.y / tileSizePx.y), dims.y - 1);
    float viewDist = clamp(length(viewPos - worldPos), cameraNearFar.x, cameraNearFar.y);
    float logRatio = log(cameraNearFar.y / cameraNearFar.x);
    float sliceF = floor(log(viewDist / cameraNearFar.x) * clusterDims.z / logRatio);
    int cellZ = min(int(max(sliceF, 0.0)), dims.z - 1);
    return cellX + dims.x * (cellY + dims.y * cellZ);
}

// Linear to sRGB
vec3 linearToSRGB(vec3 color) {
    return pow(color, vec3(1.0 / u_gamma));
}

// sRGB to Linear
vec3 sRGBToLinear(vec3 color) {
    return pow(color, vec3(u_gamma));
}

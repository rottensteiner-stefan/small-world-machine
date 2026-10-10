// WGSL Global and Object structures

// GlobalUniforms: Scene-level uniforms (848 bytes / 212 floats)
// Cleanly grouped into Camera & View, Environment & Fog, Shadow Maps, and Clustered Light Grid.
struct GlobalUniforms {
    // --- 1. Camera & View (80 bytes) ---
    vp: mat4x4f,
    viewPos: vec4f,

    // --- 2. Environment, Direct Light & Atmospheric Fog (112 bytes) ---
    ambientColor: vec4f,
    dirLightColor: vec4f,
    dirLightDir: vec4f,
    numPointLights: f32,
    numSpotLights: f32,
    numAreaLights: f32,
    gamma: f32,
    exposure: f32,
    fogMode: f32,
    fogDensity: f32,
    fogNear: f32,
    fogFar: f32,
    fogHeight: f32,
    fogHeightFalloff: f32,
    envIntensity: f32,
    fogColor: vec4f,

    // --- 3. Shadow Matrices & Projection (576 bytes) ---
    spotShadowMatrices: array<mat4x4f, 4>,
    spotShadowInfo: array<vec4f, 4>, // [bias, normalBias, castShadow, pad]
    cascadeMatrices: array<mat4x4f, 4>,
    cascadeSplits: vec4f,
    dirShadowInfo: vec4f, // [bias, normalBias, castShadow, numCascades]

    // --- 4. Clustered Light Culling & Screen Geometry (80 bytes) ---
    cameraNearFar: vec2f,
    resolution: vec2f,    // canvas size in pixels, for clustered light culling
    projScale: vec2f,     // projection matrix diagonal terms [0][0]/[1][1], for view-space reconstruction
    tileSizePx: vec2f,    // clustered light grid screen-space tile size in pixels
    clusterDims: vec4f    // [x, y, z cell counts, maxLightsPerCluster], all as f32
}

// ObjectUniforms: 512-byte uniform block (32 vec4 / 128 floats)
// Cleanly grouped into Transform, Core Material, Pipeline/Animation, and Semantic Material Parameters.
struct ObjectUniforms {
    // --- 1. Transform Block (64 bytes) ---
    model: mat4x4f,

    // --- 2. Core Material & Surface Properties (64 bytes) ---
    color: vec4f,
    specColor: vec4f, 
    texOffset: vec2f,
    texRepeat: vec2f,
    shininess: f32,
    isTerrain: f32,
    metallic: f32,
    roughness: f32,

    // --- 3. Pipeline, Surface Tuning & Animation (128 bytes) ---
    extraParams: vec4f,   // [ao, time, flowSpeed, noiseScale]
    liquidParams: vec4f,  // [waveFreq, waveAmp, 0, 0]
    thresholds: vec4f,    // [sandToGrass, grassToRock, rockToSnow, softness]
    useEnvMap: f32,
    useReflectionMap: f32,
    reflectivity: f32,
    time: f32,
    isSkinned: f32,
    boneOffset: f32,
    pad1: f32,
    pad2: f32,
    pad3: f32,
    styleA: vec4f,
    styleB: vec4f,

    // --- 4. Semantic Material Parameters: matParam0..15 (256 bytes) ---
    // Dedicated parameter bank for modern materials (OpenWater, StylizedWater, PBR extensions, etc.)
    matParam0: vec4f,  // e.g. OpenWater: [waterAbsorption.rgb, refractionStrength]
    matParam1: vec4f,  // e.g. OpenWater: [foamColor.rgb, foamDistance]
    matParam2: vec4f,  // e.g. OpenWater: [foamCutoff, foamNoiseScale, foamNoiseSpeed, poolHalfExtent]
    matParam3: vec4f,
    matParam4: vec4f,
    matParam5: vec4f,
    matParam6: vec4f,
    matParam7: vec4f,
    matParam8: vec4f,
    matParam9: vec4f,
    matParam10: vec4f,
    matParam11: vec4f,
    matParam12: vec4f,
    matParam13: vec4f,
    matParam14: vec4f,
    matParam15: vec4f
}

// Per-draw view-projection matrix, dynamic-offset-indexed -- one slot for the main camera,
// one per shadow cascade/spot light, so a single frame-shared command encoder can record every
// pass without a per-cascade/light queue.writeBuffer()+submit() dance. See WebGPURenderer's
// VIEW_SLOT_* constants and _setViewMatrix().
struct ViewUniforms {
    vp: mat4x4f,
}

struct Out {
    @builtin(position) pos: vec4f,
    @location(0) wp: vec3f,
    @location(1) n: vec3f,
    @location(2) uv: vec2f,
    @location(3) t: vec3f,
    @location(4) b: vec3f,
    @location(5) original_uv: vec2f,
    @location(6) texIndex: f32
}

struct PointLight {
    pos: vec4f,
    col: vec4f
}

struct SpotLight {
    pos: vec4f,
    dir: vec4f,
    col: vec4f,
    params: vec4f 
}

struct AreaLight {
    pos: vec4f,
    col: vec4f,
    right: vec4f,
    up: vec4f,
    normal: vec4f,
    size: vec4f
}

@group(0) @binding(0) var<uniform> global: GlobalUniforms;
@group(0) @binding(1) var<storage> pLights: array<PointLight>;
@group(0) @binding(2) var<storage> sLights: array<SpotLight>;
@group(0) @binding(3) var<storage> aLights: array<AreaLight>;
@group(0) @binding(4) var u_irradianceMap: texture_cube<f32>;
@group(0) @binding(5) var u_prefilterMap: texture_cube<f32>;
@group(0) @binding(6) var u_brdfLUT: texture_2d<f32>;
@group(0) @binding(7) var globalSampler: sampler;
@group(0) @binding(8) var u_dirShadowMap: texture_depth_2d_array;
@group(0) @binding(9) var u_spotShadowMap: texture_depth_2d_array;
@group(0) @binding(10) var shadowSampler: sampler_comparison;
// Clustered/tiled forward+ light culling (WebGL2/WebGPU only, see
// docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md). Fixed-capacity-per-cluster, no
// atomics: ClusterCullPassGPU (compute) writes these, the lighting chunk below only reads them.
// vec2u per cluster is (offset, count) into the matching index array.
@group(0) @binding(11) var<storage, read_write> pointClusterGrid: array<vec2u>;
@group(0) @binding(12) var<storage, read_write> pointClusterIndices: array<u32>;
@group(0) @binding(13) var<storage, read_write> spotClusterGrid: array<vec2u>;
@group(0) @binding(14) var<storage, read_write> spotClusterIndices: array<u32>;
@group(0) @binding(15) var<storage, read> boneMatrices: array<mat4x4f>;

@group(1) @binding(1) var s: sampler;
@group(1) @binding(2) var u_diffuseMap: texture_2d<f32>;
@group(1) @binding(3) var u_normalMap: texture_2d<f32>;
@group(1) @binding(4) var u_specularMap: texture_2d<f32>;
@group(1) @binding(5) var u_sandMap: texture_2d<f32>;
@group(1) @binding(6) var u_grassMap: texture_2d<f32>;
@group(1) @binding(7) var u_rockMap: texture_2d<f32>;
@group(1) @binding(8) var u_snowMap: texture_2d<f32>;
@group(1) @binding(9) var u_metallicMap: texture_2d<f32>;
@group(1) @binding(10) var u_roughnessMap: texture_2d<f32>;
@group(1) @binding(11) var u_envMap: texture_cube<f32>;
@group(1) @binding(12) var u_emissiveMap: texture_2d<f32>;
@group(1) @binding(13) var u_alphaMap: texture_2d<f32>;
@group(1) @binding(14) var u_opaqueMap: texture_2d<f32>;
@group(1) @binding(15) var u_reflectionMap: texture_2d<f32>;
@group(1) @binding(16) var u_opaqueDepthMap: texture_depth_2d;
@group(1) @binding(17) var u_aoMap: texture_2d<f32>;
@group(1) @binding(18) var u_rampMap: texture_2d<f32>;
@group(1) @binding(19) var u_distortMap: texture_2d<f32>;

@group(2) @binding(0) var<uniform> obj: ObjectUniforms;

@group(3) @binding(0) var<uniform> view: ViewUniforms;


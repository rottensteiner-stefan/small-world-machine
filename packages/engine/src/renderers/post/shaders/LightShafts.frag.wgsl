struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

struct LightShaftsUniforms {
    invViewProj: mat4x4f,
    camPos: vec4f,          // xyz: camPos, w: maxDistance
    sunDir: vec4f,          // xyz: sunDir, w: asymmetry (Schlick k)
    sunColor: vec4f,        // xyz: sunColor, w: unused
    params: vec4f,          // x: density, y: samples, z: pad, w: pad
    cascadeSplits: vec4f,
    dirShadowInfo: vec4f,   // x: bias, y: unused, z: castShadow, w: numCascades
    cascadeMatrices: array<mat4x4f, 4>,
};

@group(0) @binding(0) var opaqueDepthMap: texture_depth_2d;
@group(0) @binding(1) var dirShadowMap: texture_depth_2d_array;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var<uniform> u: LightShaftsUniforms;

fn getIGN(screenPos: vec2f) -> f32 {
    let magic = vec3f(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(screenPos, magic.xy)));
}

fn sampleShadow(worldPos: vec3f) -> f32 {
    if (u.dirShadowInfo.z < 0.5 || u.dirShadowInfo.w < 1.0) {
        return 1.0;
    }

    let numCascades = u32(u.dirShadowInfo.w);
    var cascadeIndex = max(numCascades, 1u) - 1u;
    let viewDist = length(u.camPos.xyz - worldPos);

    for (var c: u32 = 0u; c < 4u; c++) {
        if (c >= numCascades) { break; }
        if (viewDist < u.cascadeSplits[c]) {
            cascadeIndex = c;
            break;
        }
    }

    let lightSpacePos = u.cascadeMatrices[cascadeIndex] * vec4f(worldPos, 1.0);
    let proj = lightSpacePos.xyz / lightSpacePos.w;
    // Same convention as getShadowPCF in pbr_math.wgsl: the matrix is ZO-corrected (z in [0, 1])
    // and texture space has v pointing down, so y is flipped.
    let uv = vec2f(proj.x * 0.5 + 0.5, 0.5 - proj.y * 0.5);

    if (proj.z > 1.0 || proj.z < 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        return 1.0;
    }

    let bias = u.dirShadowInfo.x;
    return textureSampleCompareLevel(dirShadowMap, shadowSampler, uv, cascadeIndex, proj.z - bias);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let dims = vec2f(textureDimensions(opaqueDepthMap));
    let pixelCoord = vec2i(in.uv * dims);
    let rawDepth = textureLoad(opaqueDepthMap, pixelCoord, 0);

    // Reconstruct world position from depth
    // WebGPU NDC z is [0, 1]
    let ndc = vec4f(in.uv.x * 2.0 - 1.0, (1.0 - in.uv.y) * 2.0 - 1.0, rawDepth, 1.0);
    let worldH = u.invViewProj * ndc;
    let worldPos = worldH.xyz / worldH.w;

    let toPos = worldPos - u.camPos.xyz;
    let distToSurface = length(toPos);
    let rayDir = toPos / max(distToSurface, 0.0001);

    let maxDist = u.camPos.w;
    let marchDist = select(min(distToSurface, maxDist), maxDist, rawDepth >= 0.99999);
    if (marchDist <= 0.001) {
        return vec4f(0.0);
    }

    let steps = u32(clamp(u.params.y, 4.0, 32.0));
    let dt = marchDist / f32(steps);

    // Schlick phase function
    let g = clamp(u.sunDir.w, -0.95, 0.95);
    let k = 1.55 * g - 0.55 * (g * g * g);
    let cosTheta = dot(rayDir, normalize(u.sunDir.xyz));
    let denom = 1.0 - k * cosTheta;
    let phase = (1.0 - k * k) / (12.566370614359172 * max(denom * denom, 0.0001));

    let jitter = getIGN(in.position.xy);
    var accumulatedLight = vec3f(0.0);
    var opticalDepth = 0.0;

    let density = u.params.x;
    let sunColor = u.sunColor.xyz;

    for (var i: u32 = 0u; i < 32u; i++) {
        if (i >= steps) { break; }
        let t = (f32(i) + jitter) * dt;
        if (t > marchDist) { break; }

        let samplePos = u.camPos.xyz + rayDir * t;
        let shadow = sampleShadow(samplePos);

        let stepOpticalDepth = density * dt;
        opticalDepth += stepOpticalDepth;
        let transmittance = exp(-opticalDepth);

        accumulatedLight += shadow * sunColor * phase * transmittance * stepOpticalDepth;
    }

    // In-scattered light is scaled cleanly once in PostProcess composite
    return vec4f(accumulatedLight, 1.0);
}

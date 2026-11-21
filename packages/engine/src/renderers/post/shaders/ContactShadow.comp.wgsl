@group(0) @binding(0) var depthMap: texture_depth_2d;

struct ContactShadowUniforms {
    near: f32,
    far: f32,
    projScaleX: f32,
    projScaleY: f32,
    lightDirView: vec4f, // xyz = normalized direction TOWARDS light in view space, w = intensity
    params: vec4f,       // x = maxDistance, y = thickness, z = fadeDistance, w = bias
    settings: vec4f,     // x = raySteps (f32), yzw = reserved
}
@group(0) @binding(1) var<uniform> u: ContactShadowUniforms;
@group(0) @binding(2) var outShadow: texture_storage_2d<rgba8unorm, write>;

fn linearizeDepth(d: f32) -> f32 {
    let z = d * 2.0 - 1.0;
    return (2.0 * u.near * u.far) / (u.far + u.near - z * (u.far - u.near));
}

fn reconstructViewPos(uv: vec2f, linearZ: f32) -> vec3f {
    let ndc = uv * 2.0 - 1.0;
    return vec3f(ndc.x * linearZ / u.projScaleX, ndc.y * linearZ / u.projScaleY, -linearZ);
}

fn projectViewToScreen(viewPos: vec3f) -> vec3f {
    let linearZ = -viewPos.z;
    if (linearZ <= 0.0001) {
        return vec3f(-1.0, -1.0, 0.0);
    }
    let ndcX = (viewPos.x * u.projScaleX) / linearZ;
    let ndcY = (viewPos.y * u.projScaleY) / linearZ;
    let uv = vec2f(ndcX * 0.5 + 0.5, ndcY * 0.5 + 0.5);
    return vec3f(uv, linearZ);
}

// Interleaved Gradient Noise (Jorge Jimenez, 2014) for high-frequency ray jittering without banding
fn interleavedGradientNoise(pixelCoord: vec2f) -> f32 {
    let magic = vec3f(0.06711056, 0.00583715, 52.9829189);
    return fract(magic.z * fract(dot(pixelCoord, magic.xy)));
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id: vec3u) {
    let dims = textureDimensions(depthMap);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }
    let coord = vec2i(id.xy);
    let depth = textureLoad(depthMap, coord, 0);

    // Sky or clear background
    if (depth >= 1.0) {
        textureStore(outShadow, coord, vec4f(1.0, 1.0, 1.0, 1.0));
        return;
    }

    let linearZ = linearizeDepth(depth);
    let uv = (vec2f(coord) + vec2f(0.5)) / vec2f(dims);
    let viewPos = reconstructViewPos(uv, linearZ);

    let maxDist = u.params.x;
    let thickness = u.params.y;
    let fadeDist = u.params.z;
    let bias = u.params.w;
    let intensity = u.lightDirView.w;
    let steps = u32(max(u.settings.x, 1.0));

    // Distance fade out beyond fadeDist
    if (linearZ >= fadeDist) {
        textureStore(outShadow, coord, vec4f(1.0, 1.0, 1.0, 1.0));
        return;
    }
    let distanceFade = clamp(1.0 - (linearZ / fadeDist), 0.0, 1.0);

    let L_view = u.lightDirView.xyz;

    // Ray start and end in view space
    let rayStart = viewPos + L_view * (bias * 2.0);
    let rayEnd = viewPos + L_view * maxDist;

    // Projected start and end in screen UV [0, 1] and linear Z
    let startScreen = projectViewToScreen(rayStart);
    let endScreen = projectViewToScreen(rayEnd);

    let rayDelta = endScreen.xy - startScreen.xy;
    let rayZDelta = endScreen.z - startScreen.z;

    let noise = interleavedGradientNoise(vec2f(coord));
    let stepSize = 1.0 / f32(steps);

    var occlusion: f32 = 0.0;

    for (var i: u32 = 0u; i < steps; i = i + 1u) {
        let t = (f32(i) + noise) * stepSize;
        let sampleUV = startScreen.xy + rayDelta * t;
        let sampleRayZ = startScreen.z + rayZDelta * t;

        // Clip against screen boundaries
        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
            break;
        }

        let sampleCoord = vec2i(sampleUV * vec2f(dims));
        let sampleDepth = textureLoad(depthMap, sampleCoord, 0);
        if (sampleDepth >= 1.0) {
            continue;
        }

        let sampleSceneZ = linearizeDepth(sampleDepth);
        let depthDiff = sampleRayZ - sampleSceneZ;

        // If the ray is behind the scene geometry but within the thickness threshold:
        if (depthDiff > bias && depthDiff < thickness) {
            // Screen edge fade so shadows don't abruptly pop at edges
            let edgeDist = min(sampleUV.x, min(1.0 - sampleUV.x, min(sampleUV.y, 1.0 - sampleUV.y)));
            let edgeFade = smoothstep(0.0, 0.05, edgeDist);

            // Proximity weighting: closer occluder = darker shadow
            let proximity = 1.0 - (f32(i) / f32(steps));
            occlusion = max(occlusion, edgeFade * proximity);
            if (occlusion >= 0.95) {
                break;
            }
        }
    }

    let shadow = 1.0 - (occlusion * distanceFade * intensity);
    let clampedShadow = clamp(shadow, 0.0, 1.0);
    textureStore(outShadow, coord, vec4f(clampedShadow, clampedShadow, clampedShadow, 1.0));
}

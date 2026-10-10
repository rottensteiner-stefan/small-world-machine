[WGSL_STRUCTS]

@vertex
fn vs(
    @location(0) pos: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) tangent: vec3f
) -> Out {
    var o: Out;
    
    let time = obj.extraParams.y;
    let flowSpeed = obj.extraParams.z;
    let waveFrequency = obj.liquidParams.x;
    let waveAmplitude = obj.liquidParams.y;

    var p = pos;
    let worldPosInit = obj.model * vec4f(p, 1.0);
    let displacementSpeed = time * flowSpeed * 0.5;
    
    // Wave based on world coordinates for seamless tiling
    let px = worldPosInit.x * waveFrequency + displacementSpeed;
    let pz = worldPosInit.z * waveFrequency + displacementSpeed;
    let wave = sin(px) * cos(pz) * waveAmplitude;
    p.y += wave;
    // Analytic slope of the wave above -- tilts the normal so the fragment stage can light it.
    let slope = vec2f(cos(px) * cos(pz), -sin(px) * sin(pz)) * (waveAmplitude * waveFrequency);

    let worldPos = obj.model * vec4f(p, 1.0);
    o.wp = worldPos.xyz;
    o.pos = global.vp * worldPos;
    
    // WebGPU depth correction (0 to 1 range, though usually handled by projection)
    // o.pos.z = (o.pos.z + o.pos.w) * 0.5;
    
    o.uv = uv;
    o.n = normalize((obj.model * vec4f(normal, 0.0)).xyz - vec3f(slope.x, 0.0, slope.y));
    o.t = normalize((obj.model * vec4f(tangent, 0.0)).xyz);
    o.b = normalize(cross(o.n, o.t));
    
    return o;
}

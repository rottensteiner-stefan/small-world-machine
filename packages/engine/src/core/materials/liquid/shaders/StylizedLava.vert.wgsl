[WGSL_STRUCTS]

struct LavaOut {
    @builtin(position) pos: vec4f,
    @location(0) wp: vec3f,
    @location(1) color: vec4f,
}

@vertex fn vs(
    @location(0) pos: vec3f,
    @location(11) color: vec4f
) -> LavaOut {
    // Deliberately not named like the engine's default vertex output variable: GPUPipelineCache
    // textually rewrites that variable's return statement to set `Out.texIndex`, a member this
    // vertex output (LavaOut) does not have.
    var vsOut: LavaOut;

    // Unity's _Time.z is 2 * t.
    let timeZ = obj.time * 2.0;

    // Wave movement multiplied by the red vertex color (object-space X*Z diagonal).
    var localPos = vec4f(pos, 1.0);
    localPos.y += sin(timeZ * obj.matParam4.x + (pos.x * pos.z * obj.matParam4.y))
        * obj.matParam4.z * color.r;

    let worldPos = obj.model * localPos;
    vsOut.wp = worldPos.xyz;
    vsOut.color = color;
    vsOut.pos = view.vp * worldPos;
    return vsOut;
}

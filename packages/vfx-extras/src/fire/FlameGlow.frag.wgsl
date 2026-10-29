// Lanes: matParam0 [intensity, falloff, -, -], matParam1 [color.rgb, -].
@fragment fn fs(i: Out) -> @location(0) vec4f {
    let r = length(i.uv - 0.5) * 2.0;
    // Gaussian core, clipped to zero before the quad border so the square never shows.
    let glow = exp(-r * r * obj.matParam0.y) * (1.0 - smoothstep(0.75, 1.0, r));
    return vec4f(displayToTarget(obj.matParam1.rgb) * (glow * obj.matParam0.x), glow);
}

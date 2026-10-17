@vertex fn vs(@location(0) pos: vec3f) -> Out {
    var o: Out;
    o.uv = pos.xy; // Legacy UV for vertex-in-pos
    // Center the sky on the camera: add the camera world position so the cube follows the
    // viewer instead of a fixed scene position. The view transform maps the camera position to
    // the origin, so the model translation is neutralized and only the orientation survives.
    let wp = obj.model * vec4f(pos, 1.0) + vec4f(global.viewPos.xyz, 0.0);
    o.pos = (global.vp * wp).xyww;
    o.wp = pos; // Use local position as direction for skybox
    return o;
}

@fragment fn fs(i: Out) -> @location(0) vec4f {
    // Apply scene exposure so the skybox brightness tracks the rest of the scene.
    // The skybox cubemap is already in sRGB / display space, so we do NOT linearize or
    // re-gamma-correct — a straight exposure scale keeps it perceptually consistent
    // without introducing double-gamma or banding artifacts.
    let col = textureSample(u_envMap, s, i.wp) * obj.color;
    return vec4f(col.rgb * global.exposure, col.a);
}
[WGSL_STRUCTS]

[WGSL_LIQUID_GERSTNER_WAVE]

@vertex
fn vs(
    @location(0) pos: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) tangent: vec3f
) -> Out {
    var o: Out;
    
    let time = obj.time;
    let speed = obj.reflectivity;
    
    var p = pos;
    let worldPosInit = obj.model * vec4f(p, 1.0);
    var wp = worldPosInit.xyz;
    
    let w1 = obj.extraParams;
    let w2 = obj.liquidParams;
    let w3 = obj.thresholds;
    
    var t = vec3f(1.0, 0.0, 0.0);
    var b = vec3f(0.0, 0.0, 1.0);
    var displacement = vec3f(0.0, 0.0, 0.0);

    let w4 = vec4f(w1.y, -w1.x, w1.z * 0.45, w1.w * 0.42); // Detail wave 1 (perpendicular, shorter)
    let w5 = vec4f(-w2.y, w2.x, w2.z * 0.35, w2.w * 0.35); // Detail wave 2
    let w6 = vec4f(w1.x * 0.5 - w1.y * 0.866, w1.x * 0.866 + w1.y * 0.5, w1.z * 0.25, w1.w * 0.22); // Bimodal 60-deg cross-swell

    displacement += gerstnerWave(w1, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w2, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w3, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w4, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w5, wp, speed, time, &t, &b);
    displacement += gerstnerWave(w6, wp, speed, time, &t, &b);

    // S2 SurfaceRippleField (Splat-Lane): single active impact ring wave
    let splatAge = time - obj.styleA.z;
    if (splatAge >= 0.0 && splatAge < 4.0 && obj.styleA.w > 0.0) {
        let splatCenter = obj.styleA.xy;
        let splatDist = length(wp.xz - splatCenter);
        let rippleRadius = splatAge * 3.5;
        let ringDist = splatDist - rippleRadius;
        let ringWidth = 0.8;
        let ringMask = exp(-ringDist * ringDist / (ringWidth * ringWidth));
        let ringDecay = exp(-splatAge * 1.2) * obj.styleA.w;
        let rippleDisp = sin(ringDist * 8.0) * ringMask * ringDecay * 0.15;
        displacement.y += rippleDisp;
        let dir = select((wp.xz - splatCenter) / max(splatDist, 0.001), vec2f(1.0, 0.0), splatDist <= 0.001);
        t.y += rippleDisp * dir.x * 4.0;
        b.y += rippleDisp * dir.y * 4.0;
    }

    // S3 Clapotis (Analytical Wall Reflection): the dominant wave w1 reflects off the vertical
    // walls of a square basin centred on the world origin; half extent in matParam2.w, 0 = off.
    let poolHalfExtent = obj.matParam2.w;
    let wallsActive = poolHalfExtent > 0.0;
    let wallDistX = poolHalfExtent - abs(wp.x);
    let wallDistZ = poolHalfExtent - abs(wp.z);
    if (wallsActive && wallDistX < 1.5 && wallDistX > -0.5) {
        let wallNorm = vec2f(-sign(wp.x), 0.0);
        let dRef = w1.xy - 2.0 * dot(w1.xy, wallNorm) * wallNorm;
        let wRef = vec4f(dRef, w1.z * 0.85, w1.w);
        let wallTrap = smoothstep(1.5, 0.0, wallDistX);
        displacement += gerstnerWave(wRef, wp, speed, time, &t, &b) * wallTrap;
    }
    if (wallsActive && wallDistZ < 1.5 && wallDistZ > -0.5) {
        let wallNorm = vec2f(0.0, -sign(wp.z));
        let dRef = w1.xy - 2.0 * dot(w1.xy, wallNorm) * wallNorm;
        let wRef = vec4f(dRef, w1.z * 0.85, w1.w);
        let wallTrap = smoothstep(1.5, 0.0, wallDistZ);
        displacement += gerstnerWave(wRef, wp, speed, time, &t, &b) * wallTrap;
    }

    wp += displacement;
    o.wp = wp;
    o.pos = global.vp * vec4f(wp, 1.0);

    // Crest foam metric: horizontal Jacobian of the Gerstner displacement, J = Tx*Bz - Tz*Bx
    // (t/b are dP/dx, dP/dz). J < 1 means the surface is compressed (wave crest pinching),
    // J <= 0 means folding. Normalised by the summed steepness so the 0..1 range is
    // preset-independent. Carried in Out.original_uv.x (unused by this shader). NOT in Out.texIndex: GPUPipelineCache
    // injects a texIndex assignment at the end of every vertex function and would overwrite it.
    // (Never write the literal end-of-function statement in a comment here: it is regex-matched.)
    let steepSum = w1.z + w2.z + w3.z + w4.z + w5.z + w6.z;
    let jacobian = t.x * b.z - t.z * b.x;
    o.original_uv = vec2f(clamp(2.5 * (1.0 - jacobian) / max(steepSum, 0.001), -1.0, 1.0), 0.0);
    
    o.uv = uv;
    o.n = normalize(cross(b, t));
    o.t = normalize(t);
    o.b = normalize(b);
    
    return o;
}

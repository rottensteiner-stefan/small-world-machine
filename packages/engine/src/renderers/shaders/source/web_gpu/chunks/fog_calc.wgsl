// WGSL Fog Calculation
if (global.fogMode > 0.0) {
    let fogDist = length(i.wp - global.viewPos.xyz);
    var fogFactor = 0.0;
    
    if (global.fogMode == 1.0) { // LINEAR
        fogFactor = (global.fogFar - fogDist) / (global.fogFar - global.fogNear);
    } else if (global.fogMode == 2.0) { // EXP
        fogFactor = exp(-fogDist * global.fogDensity);
    } else if (global.fogMode == 3.0) { // EXP2
        fogFactor = exp(-(fogDist * global.fogDensity) * (fogDist * global.fogDensity));
    }
    
    if (global.fogHeightFalloff > 0.0) {
        var heightFactor = exp(-global.fogHeightFalloff * (i.wp.y - global.fogHeight));
        heightFactor = clamp(heightFactor, 0.0, 1.0);
        fogFactor = 1.0 - ((1.0 - fogFactor) * heightFactor);
    }
    
    fogFactor = clamp(fogFactor, 0.0, 1.0);
    color = vec3f(mix(global.fogColor.rgb, color, fogFactor));
}

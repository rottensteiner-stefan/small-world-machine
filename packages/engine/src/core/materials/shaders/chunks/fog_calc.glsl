if (u_fogMode > 0) {
    float fogDist = length(v_worldPos - u_viewPos);
    float fogFactor = 0.0;
    
    if (u_fogMode == 1) { // LINEAR
        fogFactor = (u_fogFar - fogDist) / (u_fogFar - u_fogNear);
    } else if (u_fogMode == 2) { // EXP
        fogFactor = exp(-fogDist * u_fogDensity);
    } else if (u_fogMode == 3) { // EXP2
        fogFactor = exp(-(fogDist * u_fogDensity) * (fogDist * u_fogDensity));
    }
    
    // Height falloff (Unreal style)
    if (u_fogHeightFalloff > 0.0) {
        float heightFactor = exp(-u_fogHeightFalloff * (v_worldPos.y - u_fogHeight));
        heightFactor = clamp(heightFactor, 0.0, 1.0);
        fogFactor = 1.0 - ((1.0 - fogFactor) * heightFactor);
    }
    
    fogFactor = clamp(fogFactor, 0.0, 1.0);
    
    #if __VERSION__ == 300
        fragColor.rgb = mix(displayToTarget(u_fogColor), fragColor.rgb, fogFactor);
    #else
        gl_FragColor.rgb = mix(u_fogColor, gl_FragColor.rgb, fogFactor);
    #endif
}

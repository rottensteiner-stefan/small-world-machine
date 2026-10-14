precision highp float;

varying vec2 v_uv;

uniform sampler2D u_sceneColor;
uniform vec2 u_sunScreenPos;
uniform float u_sunCameraZ; // > 0: in front of camera, <= 0: behind camera
uniform float u_density;
uniform float u_weight;
uniform float u_decay;
uniform float u_intensity;
uniform vec3 u_shaftColor;

void main() {
    // Behind-camera inversion guard: if the sun is behind or at the camera plane,
    // smoothly fade out to zero to prevent mirroring artifacts across screen center.
    if (u_sunCameraZ <= 0.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    float camZFactor = clamp(u_sunCameraZ * 0.5, 0.0, 1.0);

    // Vector pointing from current pixel toward projected sun position
    vec2 deltaUV = (v_uv - u_sunScreenPos) * (1.0 / 32.0) * u_density;
    vec2 curUV = v_uv;

    vec3 accumulatedColor = vec3(0.0);
    float illuminationDecay = 1.0;

    for (int i = 0; i < 32; i++) {
        curUV -= deltaUV;
        vec2 clampedUV = clamp(curUV, vec2(0.0), vec2(1.0));
        vec3 tap = texture2D(u_sceneColor, clampedUV).rgb;

        // Extract high-luminance texels (skybox and bright light sources)
        float luma = dot(tap, vec3(0.2126, 0.7152, 0.0722));
        vec3 bright = max(tap - vec3(0.6), vec3(0.0));

        bright *= illuminationDecay * u_weight;
        accumulatedColor += bright;
        illuminationDecay *= u_decay;
    }

    vec3 result = accumulatedColor * u_shaftColor * u_intensity * camZFactor;
    gl_FragColor = vec4(result, 1.0);
}

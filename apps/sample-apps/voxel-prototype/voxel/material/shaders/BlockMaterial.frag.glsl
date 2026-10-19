#version 300 es
// Voxel block fragment shader -- WEBGL2 / GLSL300 (M0, see apps/sample-apps/voxel-prototype/docs/log.md).
// NOTE: the GLSL ES `#version` directive MUST stay on the first line (engine convention).
// Samples the block palette through a `sampler2DArray` (array textures eliminate atlas seam
// bleeding by construction -- dossier §1.4, Dave-Report fact 4) using the per-vertex layer
// from `v_texLayer` and the face-normal-driven UV. Lighting is deliberately lightweight and
// SELF-CONTAINED for M0: a fixed stylized directional term over the world-space normal, no
// engine light data, no IBL. Proper engine-lit block materials are a later milestone (M1/M2);
// per-vertex baked AO replaces this in M2 ("Minecraft-standard look").
precision highp float;
precision highp sampler2DArray;

in vec3 v_normal;
in vec2 v_uv;
flat in uint v_texLayer;

uniform sampler2DArray u_blockAtlas;

out vec4 fragColor;

void main() {
    vec3 albedo = texture(u_blockAtlas, vec3(v_uv, float(v_texLayer))).rgb;

    // Stylized, cheap directional shading: a fixed world-space light direction (up-and-to-the-
    // side). Ambient floor keeps the underside readable; M0 is a contract proof, not a lighting
    // feature. Proper engine-lit block materials come in M1/M2 (per-vertex baked AO replaces
    // this in M2, "Minecraft-standard look").
    vec3 normal = normalize(v_normal);
    vec3 lightDir = normalize(vec3(0.55, 0.82, 0.28));
    float ndl = clamp(dot(normal, lightDir), 0.0, 1.0);
    float ambient = 0.34;
    vec3 lit = albedo * (ambient + (1.0 - ambient) * ndl);

    fragColor = vec4(lit, 1.0);
}

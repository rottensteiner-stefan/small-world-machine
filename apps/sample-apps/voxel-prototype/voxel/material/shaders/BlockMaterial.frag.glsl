#version 300 es
// Voxel block fragment shader -- WEBGL2 / GLSL300 (M0+M2, see apps/sample-apps/voxel-prototype/docs/log.md).
// NOTE: the GLSL ES `#version` directive MUST stay on the first line (engine convention).
// Samples the block palette through a `sampler2DArray` (array textures eliminate atlas seam
// bleeding by construction -- dossier §1.4, Dave-Report fact 4) using the per-vertex layer
// from `v_texLayer` and the face-normal-driven UV. M2:
//   - per-vertex baked AO (`v_ao`, Minecraft 4-level scheme from the VoxelMeshData colors.g)
//     dims the direct term in crevices while the ambient floor keeps them readable;
//   - alpha comes from the ATLAS texture, so the semi-transparent WATER layer blends against
//     the opaque beds beneath (solid tiles sample alpha 1.0 and stay opaque).
// Lighting stays lightweight and SELF-CONTAINED: a fixed stylized directional term, no engine
// light data, no IBL (a later milestone).
precision highp float;
precision highp sampler2DArray;

in vec3 v_normal;
in vec2 v_uv;
flat in uint v_texLayer;
in float v_ao;

uniform sampler2DArray u_blockAtlas;

out vec4 fragColor;

void main() {
    vec4 tex = texture(u_blockAtlas, vec3(v_uv, float(v_texLayer)));
    vec3 albedo = tex.rgb;

    // Stylized, cheap directional shading with a fixed world-space light direction
    // (up-and-to-the-side). Ambient floor keeps the underside readable.
    vec3 normal = normalize(v_normal);
    vec3 lightDir = normalize(vec3(0.55, 0.82, 0.28));
    float ndl = clamp(dot(normal, lightDir), 0.0, 1.0);
    float ambient = 0.34;
    float ao = clamp(v_ao, 0.0, 1.0);
    vec3 lit = albedo * mix(ambient, 1.0, ao) * (ambient + (1.0 - ambient) * ndl);

    fragColor = vec4(lit, tex.a);
}

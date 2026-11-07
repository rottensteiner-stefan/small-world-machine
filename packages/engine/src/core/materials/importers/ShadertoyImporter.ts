import type { ShaderImporter } from "./ShaderImporter.js";
import type { CustomShaderMaterialOptions } from "../CustomShaderMaterial.js";
import { ShaderPropertyType } from "../../../enums/index.js";

/**
 * Minimal GLSL300 gamma lane for the wrapper. `[LIGHT_DEFS]` above user code would put
 * `linearToSRGB`/`sRGBToLinear`/`targetToLinear`/`displayToTarget`, the whole GlobalUniforms member list and
 * the GLASS_* macros into the Shadertoy's scope, and Shadertoys routinely define their own `sRGBToLinear` /
 * `linearToSRGB` (redefinition compile error). This declares only the std140 PREFIX of `GlobalUniforms` up
 * to `u_gamma` (a UBO may be declared as a prefix of the bound buffer) behind an instance name, plus a
 * wrapper-private `swm_displayToTarget` (same maths as `lights.frag.glsl`). Prefix drift is pinned by a test.
 */
export const SHADERTOY_GAMMA_DEFS = `layout(std140) uniform GlobalUniforms {
    mat4 u_vp;
    vec3 u_viewPos;
    int _pad0;
    vec3 u_ambientColor;
    int _pad1;
    vec3 u_dirLightColor;
    int _pad2;
    vec3 u_dirLightDir;
    int _pad3;
    int u_numPointLights;
    int u_numSpotLights;
    int u_numAreaLights;
    float u_gamma;
} swm_global;

vec3 swm_displayToTarget(vec3 color) {
    return pow(max(color, vec3(0.0)), vec3(2.2 / swm_global.u_gamma));
}`;

/**
 * Importer for Shadertoy (GLSL).
 * Wraps the `void mainImage(...)` function into a standard WebGL2 format.
 */
export class ShadertoyImporter implements ShaderImporter {
  public parse(sourceCode: string): CustomShaderMaterialOptions {
    const vsGLSL300 = `[BASE_VERTEX_HEADER]
[BASE_VERTEX_MAIN]`;

    const fsGLSL300 = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 fragColor;

// Global gamma lane (ADR 0049): Shadertoy output is display-referred sRGB. Minimal, instance-named, swm_-
// prefixed so user code can define its own sRGBToLinear/linearToSRGB/displayToTarget.
${SHADERTOY_GAMMA_DEFS}

uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
uniform float iFrame;
uniform vec4 iMouse;

// --- SHADERTOY SOURCE START ---
${sourceCode}
// --- SHADERTOY SOURCE END ---

void main() {
    // Shadertoy expects fragCoord in pixels (0 to resolution)
    vec2 fragCoord = v_uv * iResolution.xy;
    vec4 color = vec4(0.0);
    mainImage(color, fragCoord);
    fragColor = vec4(swm_displayToTarget(color.rgb), color.a);
}`;

    const vsGLSL100 = `[BASE_VS]`;
    const fsSource100 = sourceCode.replace(/texture\s*\(/g, "texture2D(");
    const fsGLSL100 = `precision highp float;
varying vec2 v_uv;

uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
uniform float iFrame;
uniform vec4 iMouse;

// --- SHADERTOY SOURCE START ---
${fsSource100}
// --- SHADERTOY SOURCE END ---

void main() {
    vec2 fragCoord = v_uv * iResolution.xy;
    vec4 fragColor = vec4(0.0);
    mainImage(fragColor, fragCoord);
    gl_FragColor = fragColor;
}`;

    return {
      sources: {
        glsl300: { vs: vsGLSL300, fs: fsGLSL300 },
        glsl100: { vs: vsGLSL100, fs: fsGLSL100 },
      },
      layout: {
        uniforms: {
          u_model: { type: ShaderPropertyType.MAT4 },
          u_texOffset: { type: ShaderPropertyType.VEC2 },
          u_texRepeat: { type: ShaderPropertyType.VEC2 },
          iResolution: { type: ShaderPropertyType.VEC3 },
          iTime: { type: ShaderPropertyType.FLOAT },
          iTimeDelta: { type: ShaderPropertyType.FLOAT },
          iFrameRate: { type: ShaderPropertyType.FLOAT },
          iFrame: { type: ShaderPropertyType.FLOAT },
          iMouse: { type: ShaderPropertyType.VEC4 },
        },
        uniformLayout: [
          "u_model",
          "u_texOffset",
          "u_texRepeat",
          "iResolution",
          "iTime",
          "iTimeDelta",
          "iFrameRate",
          "iFrame",
          "iMouse",
        ],
        textures: {},
      },
      properties: {
        u_model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        u_texOffset: [0.0, 0.0],
        u_texRepeat: [1.0, 1.0],
        iResolution: [800, 600, 1.0],
        iTime: 0.0,
        iTimeDelta: 0.0,
        iFrameRate: 60.0,
        iFrame: 0.0,
        iMouse: [0, 0, 0, 0],
      },
    };
  }
}

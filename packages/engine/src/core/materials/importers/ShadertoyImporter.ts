import type { ShaderImporter } from "./ShaderImporter.js";
import type { CustomShaderMaterialOptions } from "../CustomShaderMaterial.js";
import { ShaderPropertyType } from "../../../enums/index.js";

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

// The global gamma lane and displayToTarget (ADR 0049): Shadertoy output is display-referred sRGB.
[LIGHT_DEFS]

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
    fragColor = vec4(displayToTarget(color.rgb), color.a);
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

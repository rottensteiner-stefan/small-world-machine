import type { ShaderImporter } from "./ShaderImporter.js";
import type { CustomShaderMaterialOptions } from "../CustomShaderMaterial.js";
import { ShaderPropertyType } from "../../../enums/index.js";

/**
 * Importer for GLSLSandbox (GLSL).
 * Maps `uniform float time;` and `uniform vec2 resolution;` correctly.
 */
export class GLSLSandboxImporter implements ShaderImporter {
  public parse(sourceCode: string): CustomShaderMaterialOptions {
    const vsGLSL300 = `[BASE_VERTEX_HEADER]
[BASE_VERTEX_MAIN]`;

    const fsGLSL300 = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor; // We replace gl_FragColor with fragColor for WebGL2

uniform vec2 resolution;
uniform float time;
uniform vec2 mouse;

// In WebGL2, we don't have gl_FragColor built-in.
// We provide a macro so that legacy GLSLSandbox code using gl_FragColor writes to fragColor instead.
#define gl_FragColor fragColor
// Also replace v_uv with gl_FragCoord equivalent for sandbox compatibility
#define gl_FragCoord vec4(v_uv * resolution, 0.0, 1.0)

// --- GLSLSANDBOX SOURCE START ---
${sourceCode}
// --- GLSLSANDBOX SOURCE END ---
`;

    const vsGLSL100 = `[BASE_VS]`;
    const fsSource100 = sourceCode.replace(/texture\s*\(/g, "texture2D(");
    const fsGLSL100 = `precision highp float;
varying vec2 v_uv;

uniform vec2 resolution;
uniform float time;
uniform vec2 mouse;

#define gl_FragCoord vec4(v_uv * resolution, 0.0, 1.0)

// --- GLSLSANDBOX SOURCE START ---
${fsSource100}
// --- GLSLSANDBOX SOURCE END ---
`;

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
          resolution: { type: ShaderPropertyType.VEC2 },
          time: { type: ShaderPropertyType.FLOAT },
          mouse: { type: ShaderPropertyType.VEC2 },
        },
        uniformLayout: ["u_model", "u_texOffset", "u_texRepeat", "resolution", "time", "mouse"],
        textures: {},
      },
      properties: {
        u_model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        u_texOffset: [0.0, 0.0],
        u_texRepeat: [1.0, 1.0],
        resolution: [800, 600],
        time: 0.0,
        mouse: [0, 0],
      },
    };
  }
}

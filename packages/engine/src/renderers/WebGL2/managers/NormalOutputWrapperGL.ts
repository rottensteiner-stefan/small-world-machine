/** Program flag requesting the normal-buffer output; also read by the shader chunks. */
export const NORMAL_OUTPUT_FLAG = "USE_NORMAL_OUT";

const FRAG_COLOR_OUT = /\bout\s+vec4\s+fragColor\s*;/;
const MAIN_ENTRY = /\bvoid\s+main\s*\(\s*(?:void)?\s*\)\s*\{/;
const VARYING_NORMAL = /\bin\s+vec3\s+v_normal\s*;/;
const SHADING_NORMAL_DECLARATION = /\bvec3\s+g_shadingNormal\b/;

const OCT_ENCODE = `vec2 octEncode(vec3 n) {
  vec2 p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
  vec2 s = vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
  return n.z < 0.0 ? (1.0 - abs(p.yx)) * s : p;
}`;

/**
 * GLSL300 counterpart of the WebGPU `wrapFragmentWithNormalOutput` (ADR 0028): pins `fragColor`
 * to location 0, adds a location 1 world-space normal output, and renames the shader's `main`
 * to `swm_main` so a generated `main` can run it and then encode `g_shadingNormal`.
 * Shaders without a `v_normal` varying write the out-of-range sentinel. Shaders lacking the
 * `fragColor` output or a `main` entry are returned unchanged.
 */
export function wrapFragmentWithNormalOutputGL(code: string): string {
  if (!FRAG_COLOR_OUT.test(code) || !MAIN_ENTRY.test(code)) return code;

  const hasGeometryNormal = VARYING_NORMAL.test(code);
  const declareShadingNormal = SHADING_NORMAL_DECLARATION.test(code)
    ? ""
    : "vec3 g_shadingNormal = vec3(0.0, 1.0, 0.0);\n";

  const wrapped = code
    .replace(
      FRAG_COLOR_OUT,
      `layout(location = 0) out vec4 fragColor;\nlayout(location = 1) out vec2 o_normal;\n${declareShadingNormal}`,
    )
    .replace(MAIN_ENTRY, "void swm_main() {");

  const seedNormal = hasGeometryNormal
    ? "if (dot(v_normal, v_normal) > 0.0001) g_shadingNormal = normalize(v_normal);"
    : "";
  const encoded = hasGeometryNormal ? "octEncode(g_shadingNormal)" : "vec2(-2.0, -2.0)";

  return `${wrapped}

${OCT_ENCODE}

void main() {
  ${seedNormal}
  swm_main();
  o_normal = ${encoded};
}
`;
}

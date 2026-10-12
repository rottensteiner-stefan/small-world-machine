export const NORMAL_TARGET_FORMAT: GPUTextureFormat = "rg16float";

/** Out-of-range clear value: octahedral encodings live in [-1, 1], so |x| > 1 means "no normal". */
export const NORMAL_TARGET_CLEAR: number[] = [-2, -2, 0, 0];

const FRAGMENT_ENTRY =
  /@fragment\s*fn\s+fs\s*\(\s*(\w+)\s*:\s*(\w+)\s*\)\s*->\s*@location\(0\)\s*vec4(?:f|<f32>)\s*\{/;

/**
 * Renames a material's `fs` to `fs_color` and appends an `fs` that also writes the world-space
 * shading normal to `@location(1)` (see ADR 0028). Only entry points taking the shared vertex
 * `Out` struct know a geometry normal; any other input type writes the out-of-range sentinel so
 * the pipeline's second target stays valid. Shaders without a matching entry point are returned
 * unchanged.
 */
export function wrapFragmentWithNormalOutput(code: string): string {
  const match = FRAGMENT_ENTRY.exec(code);
  if (!match) return code;

  const paramName = match[1]!;
  const paramType = match[2]!;
  const geometryNormal = paramType === "Out" ? `g_shadingNormal = normalize(${paramName}.n);` : "";
  const encoded = paramType === "Out" ? "octEncode(g_shadingNormal)" : "vec2f(-2.0, -2.0)";

  const renamed = code.replace(
    FRAGMENT_ENTRY,
    `fn fs_color(${paramName}: ${paramType}) -> vec4f {`,
  );
  return `${renamed}

struct FragOutNormal {
  @location(0) color: vec4f,
  @location(1) normal: vec2f,
}

@fragment
fn fs(${paramName}: ${paramType}) -> FragOutNormal {
  ${geometryNormal}
  let color = fs_color(${paramName});
  return FragOutNormal(color, ${encoded});
}
`;
}

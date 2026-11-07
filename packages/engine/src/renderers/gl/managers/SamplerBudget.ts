import { ShaderFlag } from "../../../enums/index.js";

/**
 * Samplers the renderer binds itself on fixed texture units (shadow maps); the program-cache allocator hands
 * them no unit of the material range. Every other `sampler2D` / `samplerCube` / `sampler2DArray` takes one.
 */
export const RENDERER_OWNED_SAMPLERS: ReadonlySet<string> = new Set([
  "u_dirShadowMap",
  "u_dirShadowMapRaw",
  "u_spotShadowMap",
]);

/** First and last texture unit reserved for the renderer's own samplers (shadows, cluster textures). */
export const RESERVED_UNIT_START = 11;
export const RESERVED_UNIT_END = 15;

/**
 * Extension maps in the order they are given up when a program needs more texture units than the device has:
 * the first group goes first. Each group is dropped as a whole (a feature falls back to its factor values; its
 * own sharing flags go with it, they would reference a sampler that no longer exists). The core maps of the
 * surface (diffuse, normal, metallic, roughness, AO, emissive, environment, reflection) are never dropped.
 */
export const EXTENSION_MAP_GROUPS: ReadonlyArray<readonly string[]> = [
  // WebGL1 BRDF LUT: purely a quality upgrade over the analytic fit, so it is the very first to go.
  [ShaderFlag.BRDF_LUT],
  [
    ShaderFlag.IRIDESCENCE_MAP,
    ShaderFlag.IRIDESCENCE_THICKNESS_MAP,
    ShaderFlag.IRIDESCENCE_MAPS_SHARED,
  ],
  [ShaderFlag.SPECULAR_WEIGHT_MAP, ShaderFlag.SPECULAR_COLOR_MAP, ShaderFlag.SPECULAR_MAPS_SHARED],
  [ShaderFlag.ANISOTROPY_MAP],
  [ShaderFlag.SHEEN_COLOR_MAP, ShaderFlag.SHEEN_ROUGHNESS_MAP],
  [ShaderFlag.CLEARCOAT_MAP, ShaderFlag.CLEARCOAT_ROUGHNESS_MAP, ShaderFlag.CLEARCOAT_NORMAL_MAP],
  [ShaderFlag.TRANSMISSION_MAP, ShaderFlag.THICKNESS_MAP],
];

/** The unit number past the last one the allocator would hand out for `samplerCount` material samplers. */
export function nextUnitAfter(samplerCount: number): number {
  const freeBelowReserved = RESERVED_UNIT_START;
  return samplerCount <= freeBelowReserved
    ? samplerCount
    : RESERVED_UNIT_END + 1 + (samplerCount - freeBelowReserved);
}

/**
 * `flags` without the next group of extension maps that is present in it, or `undefined` when none is left.
 */
export function dropNextExtensionMapGroup(flags: readonly string[]): string[] | undefined {
  for (const group of EXTENSION_MAP_GROUPS) {
    if (group.some((flag) => flags.includes(flag))) {
      return flags.filter((flag) => !group.includes(flag));
    }
  }
  return undefined;
}

export interface FittedFlags {
  /** The flags the program should be built with. */
  flags: string[];
  /** The extension-map flags that had to go to fit (empty when nothing was dropped). */
  dropped: string[];
}

/**
 * Drops extension maps, lowest priority first, until `unitsNeeded(flags)` fits in `available` units. Stops when
 * nothing droppable is left, returning what remains, so the caller's own over-budget error still fires for a
 * program that cannot be saved this way.
 * @param flags The program's compile flags.
 * @param unitsNeeded The unit number past the last one the program's samplers would occupy.
 * @param available The device's `MAX_TEXTURE_IMAGE_UNITS`.
 */
export function fitFlagsToTextureUnits(
  flags: readonly string[],
  unitsNeeded: (flags: readonly string[]) => number,
  available: number,
): FittedFlags {
  let current: readonly string[] = flags;
  while (unitsNeeded(current) > available) {
    const reduced = dropNextExtensionMapGroup(current);
    if (!reduced) break;
    current = reduced;
  }
  return { flags: [...current], dropped: flags.filter((flag) => !current.includes(flag)) };
}

// ── Counting the samplers a fragment shader declares ────────────────────────────────────────────────────────

const DIRECTIVE = /^\s*#\s*(\w+)\s*(.*)$/;
const SAMPLER_DECLARATION =
  /^\s*uniform\s+(?:(?:highp|mediump|lowp)\s+)?(sampler2D|samplerCube|sampler2DArray)\s+(\w+)\s*(?:\[\s*(\d+)\s*\])?\s*;/;

/** Evaluates the `#if` expressions the engine's GLSL uses: `defined(X)`, `!`, `&&`, `||`, `==`, `!=`, parentheses. */
function evaluateCondition(expression: string, defines: ReadonlyMap<string, string>): boolean {
  const tokens = expression.match(/defined|[A-Za-z_]\w*|\d+|&&|\|\||==|!=|<=|>=|[()!<>]/g) ?? [];
  let position = 0;
  const peek = (): string | undefined => tokens[position];
  const take = (): string | undefined => tokens[position++];

  const primary = (): number => {
    const token = take();
    if (token === undefined)
      throw new Error(`[SamplerBudget] unexpected end of #if "${expression}"`);
    if (token === "(") {
      const value = or();
      take();
      return value;
    }
    if (token === "!") return primary() === 0 ? 1 : 0;
    if (token === "defined") {
      const parenthesised = peek() === "(";
      if (parenthesised) take();
      const name = take()!;
      if (parenthesised) take();
      return defines.has(name) ? 1 : 0;
    }
    if (/^\d+$/.test(token)) return Number(token);
    if (token === "__VERSION__") return 300;
    const value = defines.get(token);
    return value !== undefined && /^\d+$/.test(value.trim()) ? Number(value.trim()) : 0;
  };
  const comparison = (): number => {
    let left = primary();
    for (
      let op = peek();
      op === "==" || op === "!=" || op === "<" || op === ">" || op === "<=" || op === ">=";
      op = peek()
    ) {
      take();
      const right = primary();
      left =
        op === "=="
          ? Number(left === right)
          : op === "!="
            ? Number(left !== right)
            : op === "<"
              ? Number(left < right)
              : op === ">"
                ? Number(left > right)
                : op === "<="
                  ? Number(left <= right)
                  : Number(left >= right);
    }
    return left;
  };
  const and = (): number => {
    let left = comparison();
    while (peek() === "&&") {
      take();
      const right = comparison();
      left = left !== 0 && right !== 0 ? 1 : 0;
    }
    return left;
  };
  const or = (): number => {
    let left = and();
    while (peek() === "||") {
      take();
      const right = and();
      left = left !== 0 || right !== 0 ? 1 : 0;
    }
    return left;
  };
  return or() !== 0;
}

/**
 * Counts the texture units a GLSL 300 fragment shader's samplers would take, by running its preprocessor
 * directives (`#define`, `#ifdef`, `#ifndef`, `#if`, `#else`, `#endif`) the way the compiler would and counting
 * the active `sampler2D` / `samplerCube` / `sampler2DArray` declarations, array sizes included. The renderer's
 * own shadow samplers do not count. Used before linking: a program over the device's unit limit fails to link
 * and then there is nothing left to inspect.
 * @param source The assembled fragment source, with the flags already injected as `#define` lines.
 */
export function countMaterialSamplers(source: string): number {
  const defines = new Map<string, string>();
  const stack: { parentActive: boolean; active: boolean; taken: boolean }[] = [];
  let active = true;
  let count = 0;

  for (const line of source.split("\n")) {
    const directive = DIRECTIVE.exec(line);
    if (!directive) {
      if (!active) continue;
      const sampler = SAMPLER_DECLARATION.exec(line);
      if (sampler && !RENDERER_OWNED_SAMPLERS.has(sampler[2]!))
        count += sampler[3] ? Number(sampler[3]) : 1;
      continue;
    }
    const kind = directive[1]!;
    const rest = directive[2]!.replace(/\/\/.*$/, "").trim();
    if (kind === "ifdef" || kind === "ifndef" || kind === "if") {
      const value =
        kind === "ifdef"
          ? defines.has(rest)
          : kind === "ifndef"
            ? !defines.has(rest)
            : evaluateCondition(rest, defines);
      stack.push({ parentActive: active, active: value, taken: value });
      active = active && value;
    } else if (kind === "else") {
      const frame = stack[stack.length - 1];
      if (!frame) throw new Error("[SamplerBudget] #else without #if");
      frame.active = !frame.taken;
      frame.taken = true;
      active = frame.parentActive && frame.active;
    } else if (kind === "endif") {
      const frame = stack.pop();
      if (!frame) throw new Error("[SamplerBudget] #endif without #if");
      active = frame.parentActive;
    } else if (active && kind === "define") {
      const match = /^(\w+)(?:\([^)]*\))?\s*(.*)$/.exec(rest);
      if (match) defines.set(match[1]!, match[2] ?? "");
    } else if (active && kind === "undef") {
      defines.delete(rest);
    }
  }
  return count;
}

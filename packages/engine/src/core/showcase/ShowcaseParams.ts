/**
 * Declarative URL parameters for showcases: one spec gives typed, validated values, separate
 * defaults for interactive vs. automated sessions, and a self-generated help table (`?help`).
 * Industry model: Godot exported properties / lil-gui controllers (one definition drives values
 * and documentation).
 */

interface ParamBase {
  /** One-line meaning, shown by `?help`. */
  readonly doc: string;
}
export interface BoolParam extends ParamBase {
  readonly type: "bool";
  readonly default: boolean;
  /** Default for interactive sessions (no automation flag); falls back to `default`. */
  readonly interactive?: boolean;
}
export interface NumberParam extends ParamBase {
  readonly type: "int" | "number";
  readonly default: number;
  readonly interactive?: number;
  readonly min?: number;
  readonly max?: number;
}
export interface OptionalNumberParam extends ParamBase {
  readonly type: "int?" | "number?";
  readonly min?: number;
  readonly max?: number;
}
export interface EnumParam<V extends string = string> extends ParamBase {
  readonly type: "enum";
  readonly values: readonly V[];
  readonly default: V;
  readonly interactive?: V;
}
export interface StringParam extends ParamBase {
  readonly type: "string";
  readonly default: string;
  readonly interactive?: string;
  /** Values not matching fall back to the default (with a warning). */
  readonly pattern?: RegExp;
}
export type ShowcaseParam = BoolParam | NumberParam | OptionalNumberParam | EnumParam | StringParam;
export type ShowcaseParamSpec = Readonly<Record<string, ShowcaseParam>>;

export type ShowcaseParamValues<S extends ShowcaseParamSpec> = {
  readonly [K in keyof S]: S[K] extends BoolParam
    ? boolean
    : S[K] extends NumberParam
      ? number
      : S[K] extends OptionalNumberParam
        ? number | undefined
        : S[K] extends EnumParam<infer V>
          ? V
          : string;
};

export interface ShowcaseParamsResult<S extends ShowcaseParamSpec> {
  readonly values: ShowcaseParamValues<S>;
  /** true = no automation flag present (interactive defaults applied). */
  readonly interactive: boolean;
  /** Whether the key was given in the URL (explicit vs. default). */
  has(key: keyof S | string): boolean;
}

/** URL keys that mark an automated (bench / QA / golden) session. */
export const SHOWCASE_AUTOMATION_KEYS: readonly string[] = ["frames", "qa", "__golden", "truth"];

const TRUE = new Set(["", "1", "true", "on", "yes"]);
const FALSE = new Set(["0", "false", "off", "no"]);

/** Identity helper that keeps the literal types of a spec (`enum` values) for inference. */
export function defineShowcaseParams<const S extends ShowcaseParamSpec>(spec: S): S {
  return spec;
}

/**
 * Reads `spec` from `search` (default `window.location.search`). Invalid values fall back to the
 * default with one console warning; numbers clamp to [min, max]. `?help` prints the table.
 */
export function readShowcaseParams<S extends ShowcaseParamSpec>(
  spec: S,
  search: string = typeof window !== "undefined" ? window.location.search : "",
): ShowcaseParamsResult<S> {
  const params = new URLSearchParams(search);
  const interactive = !SHOWCASE_AUTOMATION_KEYS.some((k) => params.has(k) && params.get(k) !== "0");
  const values: Record<string, unknown> = {};
  const warn = (key: string, raw: string, why: string): void =>
    console.warn(`[ShowcaseParams] ?${key}=${raw} ignored (${why}); see ?help`);
  for (const [key, p] of Object.entries(spec)) {
    const raw = params.get(key);
    const fallback =
      "default" in p
        ? interactive && p.interactive !== undefined
          ? p.interactive
          : p.default
        : undefined;
    if (raw === null) {
      values[key] = fallback;
      continue;
    }
    switch (p.type) {
      case "bool":
        if (TRUE.has(raw.toLowerCase())) values[key] = true;
        else if (FALSE.has(raw.toLowerCase())) values[key] = false;
        else {
          warn(key, raw, "expected 1/0");
          values[key] = fallback;
        }
        break;
      case "int":
      case "number":
      case "int?":
      case "number?": {
        let n = Number(raw);
        if (raw === "" || !Number.isFinite(n)) {
          warn(key, raw, "not a number");
          values[key] = fallback;
          break;
        }
        if (p.type === "int" || p.type === "int?") n = Math.floor(n);
        if (p.min !== undefined) n = Math.max(p.min, n);
        if (p.max !== undefined) n = Math.min(p.max, n);
        values[key] = n;
        break;
      }
      case "enum":
        if (p.values.includes(raw)) values[key] = raw;
        else {
          warn(key, raw, `expected ${p.values.join("|")}`);
          values[key] = fallback;
        }
        break;
      case "string":
        if (p.pattern === undefined || p.pattern.test(raw)) values[key] = raw;
        else {
          warn(key, raw, `does not match ${String(p.pattern)}`);
          values[key] = fallback;
        }
        break;
    }
  }
  if (params.has("help")) console.info(formatShowcaseParams(spec));
  return {
    values: values as ShowcaseParamValues<S>,
    interactive,
    has: (key) => params.has(String(key)),
  };
}

/** Plain-text table of `spec` (key, type/range, defaults, meaning). */
export function formatShowcaseParams(spec: ShowcaseParamSpec): string {
  const rows = Object.entries(spec).map(([key, p]) => {
    let type: string = p.type;
    if (p.type === "enum") type = p.values.join("|");
    else if ("min" in p && (p.min !== undefined || p.max !== undefined)) {
      type += ` [${p.min ?? ""}..${p.max ?? ""}]`;
    }
    const def =
      "default" in p
        ? `${String(p.default)}${p.interactive !== undefined ? ` (interactive ${String(p.interactive)})` : ""}`
        : "-";
    return [`?${key}`, type, def, p.doc];
  });
  const w = [0, 1, 2].map((c) => Math.max(...rows.map((r) => r[c]!.length)));
  return rows
    .map((r) => `${r[0]!.padEnd(w[0]!)}  ${r[1]!.padEnd(w[1]!)}  ${r[2]!.padEnd(w[2]!)}  ${r[3]}`)
    .join("\n");
}

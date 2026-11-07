import * as fs from "fs";
import * as path from "path";

// Minimal scalar evaluator for shader assignment lines (GLSL + WGSL share the same scalar
// grammar for `max/min/clamp/mix/smoothstep` and float literals). Lets tests execute the REAL
// expression found in a shader source instead of pinning its text. Scalar-only by design:
// vector/matrix code is out of scope and must be tested via a CPU reference instead.

const ROOT = path.resolve(__dirname, "../../../..");

export function readSource(relative: string): string {
  return fs.readFileSync(path.join(ROOT, relative), "utf-8");
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Finds `<name> = <expr>;` in `source` (optionally preceded by `float`/`let`/`var`) and returns
 * a callable that evaluates `<expr>` with the given scalar inputs. Throws when the assignment is
 * missing, so a removed/renamed law fails loudly. `mustContain` disambiguates repeated names.
 */
export function compileScalarAssignment(
  source: string,
  name: string,
  inputs: readonly string[],
  mustContain?: string,
): (...args: number[]) => number {
  const re = new RegExp(`\\b${name}\\s*=\\s*([^;]+);`, "g");
  let expr: string | undefined;
  for (const m of source.matchAll(re)) {
    const candidate = m[1] ?? "";
    if (mustContain === undefined || candidate.includes(mustContain)) {
      expr = candidate;
      break;
    }
  }
  if (expr === undefined) {
    throw new Error(
      `assignment '${name}' not found${mustContain ? ` (containing '${mustContain}')` : ""}`,
    );
  }
  const js = expr.replace(/\bf32\(([^)]*)\)/g, "($1)").replace(/\b(\d+\.\d*|\.\d+)f\b/g, "$1");
  const fn = new Function(
    "max",
    "min",
    "clamp",
    "smoothstep",
    "mix",
    ...inputs,
    `"use strict"; return (${js});`,
  ) as (...a: unknown[]) => number;
  return (...args: number[]): number => fn(Math.max, Math.min, clamp, smoothstep, mix, ...args);
}

/**
 * `swm splatter`: seed -> PNG decal through the headless `core/splatter.ts`.
 * Flags mirror the sliders of `public/tools/splatter-gen.html` (kebab-case of the option names).
 */

import { writeFile } from "node:fs/promises";
import { NodePngRasterIO } from "../core/RasterIO.js";
import {
  generateSplatter,
  SPLATTER_ALGORITHMS,
  SPLATTER_DEFAULTS,
  type SplatterAlgorithm,
  type SplatterOptions,
} from "../core/splatter.js";
import type { CliIo } from "./index.js";

const ALGORITHM_FLAG = "--algorithm";

export const SPLATTER_HELP = `Generate a splatter decal (transparent PNG) from a seed.

Usage:
  swm splatter [options] <output.png>

Options:
  -a, --algorithm <name>   noise-warp (default), metaballs or mud-splatter
      --seed <n>           any number; the same seed gives the same decal (default 1)
      --size <px>          output edge length, 1-4096 (default 512)
      --color <#rrggbb>    blob colour (default #4a3728)
      --radius <px>        main blob radius (default 120)
  noise-warp:    --frequency, --amplitude, --satellites, --satellite-range
  metaballs:     --blob-count, --blur, --threshold, --satellites
  mud-splatter:  --blob-count, --warp-strength, --blur, --threshold, --satellites

Defaults per algorithm are the slider defaults of the Splatter page.
`;

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function isAlgorithm(value: string): value is SplatterAlgorithm {
  return (SPLATTER_ALGORITHMS as readonly string[]).includes(value);
}

interface ParsedArgs {
  algorithm: SplatterAlgorithm;
  values: Map<string, string>;
  output: string | undefined;
}

function parseArgs(args: readonly string[]): ParsedArgs | string {
  let algorithm: SplatterAlgorithm = "noise-warp";
  const values = new Map<string, string>();
  let output: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-a" || arg === ALGORITHM_FLAG) {
      const name = args[++i];
      if (name === undefined || !isAlgorithm(name)) {
        return `--algorithm must be one of: ${SPLATTER_ALGORITHMS.join(", ")}`;
      }
      algorithm = name;
    } else if (arg.startsWith("--")) {
      const value = args[++i];
      if (value === undefined) return `${arg} needs a value`;
      values.set(arg.slice(2), value);
    } else if (output === undefined) {
      output = arg;
    } else {
      return `unexpected argument "${arg}"`;
    }
  }
  return { algorithm, values, output };
}

function buildOptions(parsed: ParsedArgs): SplatterOptions | string {
  const defaults: Record<string, string | number> = { ...SPLATTER_DEFAULTS[parsed.algorithm] };
  const known = new Map(Object.keys(defaults).map((key) => [kebab(key), key]));
  for (const [flag, raw] of parsed.values) {
    const key = known.get(flag);
    if (key === undefined) return `unknown option --${flag} for ${parsed.algorithm}`;
    if (key === "color") {
      defaults[key] = raw;
      continue;
    }
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value))
      return `--${flag} needs a number, got "${raw}"`;
    defaults[key] = value;
  }
  return { algorithm: parsed.algorithm, ...defaults } as SplatterOptions;
}

export async function runSplatterCommand(args: readonly string[], io: CliIo): Promise<number> {
  if (args[0] === "-h" || args[0] === "--help") {
    io.out(SPLATTER_HELP);
    return 0;
  }
  const parsed = parseArgs(args);
  if (typeof parsed === "string") {
    io.err(`swm splatter: error: ${parsed}`);
    io.err('Run "swm splatter --help" for usage.');
    return 1;
  }
  if (parsed.output === undefined) {
    io.err("swm splatter: error: missing <output.png>");
    io.err('Run "swm splatter --help" for usage.');
    return 1;
  }
  const options = buildOptions(parsed);
  if (typeof options === "string") {
    io.err(`swm splatter: error: ${options}`);
    return 1;
  }
  try {
    const png = await new NodePngRasterIO().encodePng(generateSplatter(options));
    await writeFile(parsed.output, png);
    io.out(`swm splatter: ${parsed.algorithm} seed ${options.seed} -> ${parsed.output}`);
    return 0;
  } catch (error) {
    io.err(`swm splatter: error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

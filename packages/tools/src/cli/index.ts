/**
 * Minimal `swm` command-line entry (ADR 0034 G2 "dual use", first Ops-D code).
 *
 * Wraps existing headless slices from `packages/tools/src/core/*` as subcommands
 * without touching the engine (Wave-2 territory) and without new dependencies:
 *   - `map` ......... ASCII map <-> JSON grid round-trip (`core/map.ts`)
 *   - `kit validate` . Kit manifest validation over a local directory (`core/kit.ts`)
 *   - `splatter` ..... seed -> PNG decal (`core/splatter.ts`, `cli/splatterCommand.ts`)
 * Everything beyond that is follow-up scope by design (`ops-d-spec.md`).
 *
 * RUNNER: this module is intentionally executed through the committed ESM shim
 * `./swm.mjs`, which registers the `tsx` loader and imports this file in
 * process. Plain-Node type stripping cannot resolve the headless-core
 * `.js`-specifier closure, which is why the cli is not a direct `node` target.
 */

import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mapToString, stringToMap } from "../core/map.js";
import { createNodeDirectoryAssetSource, validateKitSource } from "../core/kit.js";
import type { ValidationReport } from "../common/io/types.js";
import {
  formatValidationIssue,
  formatValidationVerdict,
} from "../common/io/validationReportText.js";
import { runSplatterCommand } from "./splatterCommand.js";

const require = createRequire(import.meta.url);

const SWM_NAME = "swm";
const VERSION_FALLBACK = "0.0.0";
// The CLI module lives in `src/cli/`, so the package.json is two levels up;
// resolved to an absolute path so it works under every loader (tsx, vitest).
const PKG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");

/**
 * Injected I/O seam: tests capture `out`/`err` and fake stdin; the default
 * implementation talks to the real process stdio at runtime.
 */
export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  readStdin(): Promise<string>;
}

const defaultIo: CliIo = {
  out(line: string): void {
    process.stdout.write(`${line}\n`);
  },
  err(line: string): void {
    process.stderr.write(`${line}\n`);
  },
  async readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  },
};

const SWM_HELP = `swm - Small World Machine command-line tools

Usage:
  swm <command> [args...]

Commands:
  map     ASCII map <-> JSON grid conversion (headless core)
  kit     Kit manifest validation (headless core)
  splatter  Seeded splatter decal as PNG (headless core)

Global options:
  -h, --help      Print this help and exit
  -V, --version   Print the swm version and exit

Run "swm <command> --help" for command-specific usage.
`;

const MAP_HELP = `Convert ASCII maps (rows of draw characters) to JSON grids and back.

Usage:
  swm map to-json <input> [output]
  swm map from-json <input> [output]

<input> may be "-" to read from stdin. When <output> is omitted the result is
written to stdout.

  to-json      ASCII map -> JSON grid (array of arrays of draw characters)
  from-json    JSON grid -> ASCII map string
`;

const KIT_HELP = `Validate a kit manifest on disk (root or one folder deep).

Usage:
  swm kit validate <directory>

Fails (exit 1) when no "kit.json" is found or the manifest is invalid.
`;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveVersion(): string {
  try {
    const pkg = require(PKG_PATH) as { version?: string };
    return pkg.version ?? VERSION_FALLBACK;
  } catch {
    return VERSION_FALLBACK;
  }
}

function isStringGrid(value: unknown): value is string[][] {
  return (
    Array.isArray(value) &&
    value.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === "string"))
  );
}

async function mapToJson(args: string[], io: CliIo): Promise<number> {
  const inputPath = args[0];
  const outputPath = args[1];
  if (inputPath === undefined) {
    io.err('swm map: error: missing <input> (use "-" to read from stdin)');
    io.err('Run "swm map --help" for usage.');
    return 1;
  }
  try {
    const source = inputPath === "-" ? await io.readStdin() : await readFile(inputPath, "utf8");
    const json = JSON.stringify(stringToMap(source), null, 2);
    if (outputPath === undefined) {
      io.out(json);
    } else {
      await writeFile(outputPath, `${json}\n`, "utf8");
    }
    return 0;
  } catch (error) {
    io.err(`swm map: error: ${toErrorMessage(error)}`);
    return 1;
  }
}

async function mapFromJson(args: string[], io: CliIo): Promise<number> {
  const inputPath = args[0];
  const outputPath = args[1];
  if (inputPath === undefined) {
    io.err('swm map: error: missing <input> (use "-" to read from stdin)');
    io.err('Run "swm map --help" for usage.');
    return 1;
  }
  try {
    const source = inputPath === "-" ? await io.readStdin() : await readFile(inputPath, "utf8");
    const parsed: unknown = JSON.parse(source);
    if (!isStringGrid(parsed)) {
      io.err("swm map: error: expected a JSON grid (array of arrays of strings)");
      return 1;
    }
    const ascii = mapToString(parsed);
    if (outputPath === undefined) {
      io.out(ascii);
    } else {
      await writeFile(outputPath, `${ascii}\n`, "utf8");
    }
    return 0;
  } catch (error) {
    io.err(`swm map: error: ${toErrorMessage(error)}`);
    return 1;
  }
}

async function kitValidate(args: string[], io: CliIo): Promise<number> {
  const dirPath = args[0];
  if (dirPath === undefined) {
    io.err("swm kit: error: missing <directory>");
    io.err('Run "swm kit --help" for usage.');
    return 1;
  }
  try {
    const source = await createNodeDirectoryAssetSource(dirPath);
    try {
      const result = await validateKitSource(source);
      return printKitReport(result.report, dirPath, io);
    } finally {
      source.dispose?.();
    }
  } catch (error) {
    io.err(`swm kit: error: ${toErrorMessage(error)}`);
    return 1;
  }
}

function printKitReport(report: ValidationReport, dirPath: string, io: CliIo): number {
  for (const issue of report.issues) {
    io.out(formatValidationIssue(issue));
  }
  const verdict = `swm kit: ${formatValidationVerdict(report, dirPath)}`;
  if (report.valid) {
    io.out(verdict);
    return 0;
  }
  io.err(verdict);
  return 1;
}

async function runMapCommand(args: string[], io: CliIo): Promise<number> {
  const [operation, ...rest] = args;
  if (operation === undefined || operation === "-h" || operation === "--help") {
    io.out(MAP_HELP);
    return 0;
  }
  if (operation === "to-json") return mapToJson(rest, io);
  if (operation === "from-json") return mapFromJson(rest, io);
  io.err(`swm map: error: unknown operation "${operation}"`);
  io.err('Run "swm map --help" for usage.');
  return 1;
}

async function runKitCommand(args: string[], io: CliIo): Promise<number> {
  const [operation, ...rest] = args;
  if (operation === undefined || operation === "-h" || operation === "--help") {
    io.out(KIT_HELP);
    return 0;
  }
  if (operation === "validate") return kitValidate(rest, io);
  io.err(`swm kit: error: unknown operation "${operation}"`);
  io.err('Run "swm kit --help" for usage.');
  return 1;
}

/**
 * Runs the `swm` CLI against the given argument vector and returns the process
 * exit code (0 = success). `io` defaults to the real process stdio.
 */
export async function runSwm(argv: readonly string[], io?: CliIo): Promise<number> {
  const activeIo = io ?? defaultIo;
  const [command, ...rest] = argv;

  if (command === undefined || command === "-h" || command === "--help") {
    activeIo.out(SWM_HELP);
    return 0;
  }
  if (command === "-V" || command === "--version") {
    activeIo.out(`${SWM_NAME} ${resolveVersion()}`);
    return 0;
  }

  switch (command) {
    case "map":
      return runMapCommand(rest, activeIo);
    case "kit":
      return runKitCommand(rest, activeIo);
    case "splatter":
      return runSplatterCommand(rest, activeIo);
    default:
      activeIo.err(`swm: error: unknown command "${command}"`);
      activeIo.err('Run "swm --help" for usage.');
      return 1;
  }
}

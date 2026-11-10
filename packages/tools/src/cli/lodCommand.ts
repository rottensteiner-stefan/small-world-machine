/**
 * `swm lod`: offline glTF LOD generation (ADR 0059 step 2 / P2-3) via the headless
 * `core/lod.ts` meshoptimizer pipeline. Writes `<stem>_LOD0.glb` (verbatim) +
 * `<stem>_LOD<n>.glb` (meshoptimizer-simplified, descending detail) into `<out-dir>`.
 *
 * MIRRORS the `iblCommand`/`materialCommand` pattern: option parsing happens here, all
 * deterministic generation lives in `core/lod.ts` (so tests cover the core without the
 * CLI seam). I/O is injected through the same `CliIo` interface as every command.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LOD_DEFAULT_ERROR,
  LOD_DEFAULT_MIN_TRIS,
  LOD_DEFAULT_RATIOS,
  runLodGeneration,
  verifyLodGlb,
  type LodOptions,
  type LodRunResult,
} from "../core/lod.js";
import type { CliIo } from "./index.js";

export const LOD_HELP = `Generate glTF LOD levels (meshoptimizer simplification) from an indexed GLB.

Usage:
  swm lod <input.glb> <out-dir> [options]

Output ('<stem>' = input file name without extension):
  <stem>_LOD0.glb           verbatim copy of the input (finest, lodIndex 0 contract)
  <stem>_LOD1.glb ..._LODn.glb   simplified levels (n descending detail)

Options:
      --ratios <a,b,c>       triangle ratios per generated level (default: 0.5,0.2,0.08)
      --min-tris <n>         triangle floor per level (default: 32)
      --error <f>            base simplification error, relative to the mesh size
                             (default: 0.02 = 2 %; coarser levels scale it linearly)
      --verify               re-parse every output GLB and validate structure
      --out <dir>            output directory (alternative to positional <out-dir>)
  -h, --help                 print this help and exit

Notes:
  - Indexed TRIANGLE primitives only (V1 contract; no skins/animations).
  - Geometry-only output: materials are copied, embedded textures are dropped (warned).
  - TANGENT is omitted from the LOD levels: the engine regenerates tangents at runtime
    (asset-pipeline T1); POSITION/NORMAL/TEXCOORD_0/COLOR_0 are preserved.
  - The simplifier FAILS SOFT: a level reports the honest achieved triangle count when
    collapsing below the error budget would destroy the shape (this preserves quality).
  - Deterministic: identical input + options = identical output bytes.
`;

interface ParsedLodArgs {
  input: string;
  outDir: string;
  options: LodOptions;
  verify: boolean;
}

function parseRatios(raw: string): number[] | null {
  const parts = raw.split(",");
  if (parts.length === 0) return null;
  const ratios: number[] = [];
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value) || value <= 0 || value >= 1) return null;
    ratios.push(value);
  }
  return ratios;
}

function parseLodArgs(args: string[], io: CliIo): ParsedLodArgs | null {
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    io.out(LOD_HELP);
    return null;
  }
  let input: string | undefined;
  let outDir: string | undefined;
  let ratios = LOD_DEFAULT_RATIOS;
  let minTris = LOD_DEFAULT_MIN_TRIS;
  let error = LOD_DEFAULT_ERROR;
  let verify = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--ratios") {
      const raw = args[++i];
      if (raw === undefined) {
        io.err("swm lod: error: --ratios needs a comma-separated value, e.g. 0.5,0.2,0.08");
        return null;
      }
      const parsed = parseRatios(raw);
      if (parsed === null) {
        io.err(`swm lod: error: invalid --ratios "${raw}" (each value must be in (0,1))`);
        return null;
      }
      ratios = parsed;
    } else if (arg === "--min-tris") {
      const raw = args[++i];
      if (raw === undefined) {
        io.err("swm lod: error: --min-tris needs a number");
        return null;
      }
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 3) {
        io.err(`swm lod: error: --min-tris must be an integer >= 3, got "${raw}"`);
        return null;
      }
      minTris = value;
    } else if (arg === "--error") {
      const raw = args[++i];
      if (raw === undefined) {
        io.err("swm lod: error: --error needs a number");
        return null;
      }
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0 || value > 2) {
        io.err(`swm lod: error: --error must be in (0,2], got "${raw}"`);
        return null;
      }
      error = value;
    } else if (arg === "--verify") {
      verify = true;
    } else if (arg === "--out") {
      const raw = args[++i];
      if (raw === undefined) {
        io.err("swm lod: error: --out needs a directory");
        return null;
      }
      outDir = raw;
    } else if (arg.startsWith("-")) {
      io.err(`swm lod: error: unknown flag "${arg}"`);
      io.err('Run "swm lod --help" for usage.');
      return null;
    } else if (input === undefined) {
      input = arg;
    } else if (outDir === undefined) {
      outDir = arg;
    } else {
      io.err(`swm lod: error: unexpected extra argument "${arg}"`);
      io.err('Run "swm lod --help" for usage.');
      return null;
    }
  }
  if (input === undefined) {
    io.err("swm lod: error: missing <input.glb>");
    io.err('Run "swm lod --help" for usage.');
    return null;
  }
  if (outDir === undefined) {
    io.err("swm lod: error: missing <out-dir>");
    io.err('Run "swm lod --help" for usage.');
    return null;
  }
  return {
    input,
    outDir,
    options: { ratios, minTris, error },
    verify,
  };
}

function printResult(result: LodRunResult, outDir: string, io: CliIo): void {
  for (const warning of result.warnings) {
    io.err(`swm lod: warning: ${warning}`);
  }
  for (const level of result.levels) {
    const tris = level.trisPerMesh.map((t) => `${t}`).join("+");
    io.out(`swm lod: wrote ${join(outDir, level.fileName)} (${tris} tris)`);
  }
}

/** Runs `swm lod` against the given argument vector (mirrors `runIblCommand`/`runMaterialCommand`). */
export async function runLodCommand(args: string[], io: CliIo): Promise<number> {
  const parsed = parseLodArgs(args, io);
  if (parsed === null) {
    return args.length === 0 || args[0] === "-h" || args[0] === "--help" ? 0 : 1;
  }
  try {
    const result = await runLodGeneration(parsed.input, parsed.options);
    await mkdir(parsed.outDir, { recursive: true });
    for (const level of result.levels) {
      await writeFile(join(parsed.outDir, level.fileName), level.glb);
    }
    if (parsed.verify) {
      let issues = 0;
      for (const level of result.levels) {
        for (const issue of verifyLodGlb(level.fileName, level.glb)) {
          io.err(`swm lod: verify ${issue.file}: ${issue.message}`);
          issues++;
        }
      }
      if (issues > 0) {
        io.err(`swm lod: verify FAILED (${issues} issue${issues === 1 ? "" : "s"})`);
        return 1;
      }
      io.out(`swm lod: verify OK (${result.levels.length} files structure-valid)`);
    }
    printResult(result, parsed.outDir, io);
    return 0;
  } catch (error) {
    io.err(`swm lod: error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

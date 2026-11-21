/**
 * `swm glb`: packs a `.gltf` asset (embedded data URIs or external `.bin` + images) into a
 * self-contained binary `.glb` container via `GlbWriter.packGltf`. Supports the `--binary`
 * flag (identity explicit binary output mode).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { GlbWriter } from "@small-world-machine/engine/loaders/GlbWriter.js";
import type { GltfJson } from "@small-world-machine/engine/loaders/gltf/types.js";
import type { CliIo } from "./index.js";

export const GLB_HELP = `Pack a glTF 2.0 JSON file (.gltf + data/external buffers & images) into a .glb binary.

Usage:
  swm glb [--binary] <input.gltf> [<output.glb>]
  swm glb --in <input.gltf> [--out <output.glb>] [--binary]

Options:
      --in <file.gltf>    input glTF JSON path
      --out <file.glb>    output binary GLB path (default: <input-stem>.glb beside input)
  -b, --binary            explicit binary GLB container mode (default for swm glb)
  -h, --help              print this help and exit
`;

interface ParsedGlbArgs {
  input: string | undefined;
  output: string | undefined;
}

function parseGlbArgs(args: readonly string[]): ParsedGlbArgs | string {
  let input: string | undefined;
  let output: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-b" || arg === "--binary") {
      continue;
    } else if (arg === "--in") {
      const val = args[++i];
      if (!val) return "--in requires a path";
      input = val;
    } else if (arg === "--out") {
      const val = args[++i];
      if (!val) return "--out requires a path";
      output = val;
    } else if (arg.startsWith("-")) {
      return `unknown option "${arg}"`;
    } else if (input === undefined) {
      input = arg;
    } else if (output === undefined) {
      output = arg;
    } else {
      return `unexpected argument "${arg}"`;
    }
  }
  return { input, output };
}

export async function runGlbCommand(args: readonly string[], io: CliIo): Promise<number> {
  if (args[0] === "-h" || args[0] === "--help") {
    io.out(GLB_HELP);
    return 0;
  }
  const parsed = parseGlbArgs(args);
  if (typeof parsed === "string") {
    io.err(`swm glb: error: ${parsed}`);
    return 1;
  }
  if (!parsed.input) {
    io.err("swm glb: error: missing <input.gltf>");
    io.err('Run "swm glb --help" for usage.');
    return 1;
  }

  const inputAbs = resolve(parsed.input);
  const baseDir = dirname(inputAbs);
  const outPath = parsed.output ?? join(baseDir, `${basename(inputAbs, extname(inputAbs))}.glb`);

  try {
    const rawJson = await readFile(inputAbs, "utf8");
    const gltfJson = JSON.parse(rawJson) as GltfJson;
    const glb = await GlbWriter.packGltf(gltfJson, {
      resolveUri: async (uri: string): Promise<Uint8Array> => {
        const cleanUri = decodeURIComponent(uri);
        const abs = resolve(baseDir, cleanUri);
        if (!abs.startsWith(baseDir + "/") && !abs.startsWith(baseDir + "\\") && abs !== baseDir) {
          throw new Error(`Refusing external URI outside input directory: ${uri}`);
        }
        return readFile(abs);
      },
    });
    await mkdir(dirname(resolve(outPath)), { recursive: true });
    await writeFile(outPath, glb);
    io.out(`swm glb: wrote ${outPath} (${glb.byteLength} bytes)`);
    return 0;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    io.err(`swm glb: error: ${msg}`);
    return 1;
  }
}

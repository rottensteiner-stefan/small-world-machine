/**
 * `swm species`: scan tree (.gltf + .bin) -> field-lane species assets (ADR 0059) via the headless
 * `core/species.ts` bake: `<stem>_LOD0..3.glb`, `<stem>_albedo_<i>`, `<stem>.species.json`
 * (consumed by `vegetation-extras` `loadVegetationSpecies`).
 */
import { basename } from "node:path";
import { bakeSpecies } from "../core/species.js";
import type { CliIo } from "./index.js";

export const SPECIES_HELP = `Bake a scanned tree into field-lane species assets (LOD chain + albedo layers + sidecar).

Usage:
  swm species <input.gltf> <out-dir> [--stem <name>]

Input:
  glTF with an external .bin (e.g. Poly Haven 1k glTF). Primitives whose material name contains
  leaf/leaves/needle/foliage are leaf cards (thinned, never simplified); the rest is wood
  (small twigs thinned, limbs + trunk simplified with meshoptimizer Permissive).
  A leaf cutout needs "<name>_alpha_<res>.png" next to the diffuse and a PNG diffuse.

Output:
  <stem>_LOD0.glb .. <stem>_LOD3.glb   LOD0 finest
  <stem>_albedo_<i>.(jpg|png)          one per primitive (primitive order)
  <stem>.species.json                  sidecar (albedo, foliage mask, cutout per primitive)

Options:
  --stem <name>   output name (default: input file name without _<res>.gltf)
  -h, --help      print this help
`;

export async function runSpeciesCommand(args: string[], io: CliIo): Promise<number> {
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    io.out(SPECIES_HELP);
    return args.length === 0 ? 1 : 0;
  }
  const positional: string[] = [];
  let stem: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--stem") {
      stem = args[++i];
      if (!stem) {
        io.err("swm species: error: --stem needs a value");
        return 1;
      }
    } else {
      positional.push(args[i]!);
    }
  }
  const [input, outDir] = positional;
  if (!input || !outDir) {
    io.err("swm species: error: expected <input.gltf> <out-dir>");
    return 1;
  }
  const name = stem ?? basename(input).replace(/(_\d+k)?\.gltf$/i, "");
  try {
    const result = await bakeSpecies(input, outDir, name);
    result.levels.forEach((row, level) =>
      io.out(
        `LOD${level}: ${Object.entries(row)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`,
      ),
    );
    io.out(`wrote ${result.files.length} files to ${outDir}`);
    return 0;
  } catch (error) {
    io.err(`swm species: error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

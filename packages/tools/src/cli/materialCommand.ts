/**
 * `swm material`: diffuse PNG -> PBR maps (height, normal, specular, roughness, ao, edge)
 * through the headless `core/material.ts` (`derivePbrMaps` + `MATERIAL_STUDIO_PRESETS`).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { NodePngRasterIO } from "../core/RasterIO.js";
import {
  derivePbrMaps,
  MATERIAL_STUDIO_PRESETS,
  NormalMapFormat,
  type MaterialPbrMaps,
  type MaterialPresetId,
  type MaterialStudioMapParams,
} from "../core/material.js";
import type { CliIo } from "./index.js";

const PRESETS = Object.keys(MATERIAL_STUDIO_PRESETS) as readonly MaterialPresetId[];
const DERIVED_MAPS = ["height", "normal", "specular", "roughness", "ao", "edge"] as const;
const VALID_MAP_NAMES = ["diffuse", "albedo", ...DERIVED_MAPS] as const;
type MapOutputName = (typeof VALID_MAP_NAMES)[number];

export const MATERIAL_HELP = `Derive PBR texture maps (PNG) from a diffuse/albedo PNG.

Usage:
  swm material [gen] [options] <diffuse.png> <out-dir>

Options:
  -p, --preset, --profile <name>   default, stone, metal or wood (default: default)
  -m, --maps <list>                comma-separated maps to write:
                                   height,normal,specular,roughness,ao,edge (+ diffuse or albedo)
                                   (default: height,normal,specular,roughness,ao,edge)
      --name <stem>                output filename stem (default: input basename without _diffuse/_albedo)
      --diffuse, --in <file.png>   input diffuse PNG (alternative to positional <diffuse.png>)
      --out <dir>                  output directory (alternative to positional <out-dir>)

Map parameter overrides (mirror the Material Studio sliders):
  height:    --height-blur <n>, --height-contrast <n>, --height-invert [true|false]
  normal:    --normal-strength <n>, --normal-format <opengl|directx>, --normal-invert-r [true|false]
  specular:  --spec-contrast <n>, --spec-thresh <n>, --spec-invert [true|false]
  roughness: --rough-gamma <n>, --rough-invert [true|false]
  ao:        --ao-soft <n>, --ao-fine <n>, --ao-level <n>
  edge:      --edge-thresh <n>, --edge-thick <n>, --edge-invert [true|false] (or --no-<flag>)
`;

const NUMERIC_FLAGS: Readonly<Record<string, keyof MaterialStudioMapParams>> = {
  "height-blur": "heightBlur",
  "height-contrast": "heightContrast",
  "normal-strength": "normalStrength",
  "spec-contrast": "specContrast",
  "spec-thresh": "specThresh",
  "rough-gamma": "roughGamma",
  "ao-soft": "aoSoft",
  "ao-fine": "aoFine",
  "ao-level": "aoLevel",
  "edge-thresh": "edgeThresh",
  "edge-thick": "edgeThick",
};

const BOOLEAN_FLAGS: Readonly<Record<string, keyof MaterialStudioMapParams>> = {
  "height-invert": "heightInvert",
  "normal-invert-r": "normalInvertR",
  "spec-invert": "specInvert",
  "rough-invert": "roughInvert",
  "edge-invert": "edgeInvert",
};

function isPreset(value: string): value is MaterialPresetId {
  return (PRESETS as readonly string[]).includes(value);
}

function isMapName(value: string): value is MapOutputName {
  return (VALID_MAP_NAMES as readonly string[]).includes(value);
}

function defaultStem(inputPath: string): string {
  const base = basename(inputPath, extname(inputPath));
  return base.replace(/_(diffuse|albedo)$/i, "") || base;
}

interface ParsedMaterialArgs {
  preset: MaterialPresetId;
  maps: MapOutputName[];
  stem: string | undefined;
  input: string | undefined;
  outDir: string | undefined;
  overrides: Partial<MaterialStudioMapParams>;
}

function parseMapList(raw: string): MapOutputName[] | string {
  const items = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (items.length === 0) {
    return "--maps must not be empty";
  }
  const result: MapOutputName[] = [];
  for (const item of items) {
    if (!isMapName(item)) {
      return `unknown map "${item}" (expected: ${VALID_MAP_NAMES.join(", ")})`;
    }
    if (!result.includes(item)) result.push(item);
  }
  return result;
}

function parseMaterialArgs(rawArgs: readonly string[]): ParsedMaterialArgs | string {
  const args = rawArgs[0] === "gen" ? rawArgs.slice(1) : rawArgs;
  let preset: MaterialPresetId = "default";
  let maps: MapOutputName[] = [...DERIVED_MAPS];
  let stem: string | undefined;
  let input: string | undefined;
  let outDir: string | undefined;
  const overrides: Partial<
    Record<keyof MaterialStudioMapParams, number | boolean | NormalMapFormat>
  > = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-p" || arg === "--preset" || arg === "--profile") {
      const val = args[++i];
      if (val === undefined || !isPreset(val)) {
        return `--preset must be one of: ${PRESETS.join(", ")}`;
      }
      preset = val;
    } else if (arg === "-m" || arg === "--maps") {
      const val = args[++i];
      if (val === undefined) return "--maps needs a value";
      const parsedMaps = parseMapList(val);
      if (typeof parsedMaps === "string") return parsedMaps;
      maps = parsedMaps;
    } else if (arg === "--name") {
      const val = args[++i];
      if (val === undefined || val.trim() === "") return "--name needs a value";
      stem = val.trim();
    } else if (arg === "--diffuse" || arg === "--in") {
      const val = args[++i];
      if (val === undefined) return `${arg} needs a value`;
      input = val;
    } else if (arg === "--out") {
      const val = args[++i];
      if (val === undefined) return "--out needs a value";
      outDir = val;
    } else if (arg === "--normal-format") {
      const val = args[++i]?.toLowerCase();
      if (val !== NormalMapFormat.OPENGL && val !== NormalMapFormat.DIRECTX) {
        return `--normal-format must be "opengl" or "directx"`;
      }
      overrides.normalFormat = val;
    } else if (arg.startsWith("--no-")) {
      const flag = arg.slice(5);
      const key = BOOLEAN_FLAGS[flag];
      if (key === undefined) return `unknown option ${arg}`;
      overrides[key] = false;
    } else if (arg.startsWith("--")) {
      const flag = arg.slice(2);
      const numKey = NUMERIC_FLAGS[flag];
      const boolKey = BOOLEAN_FLAGS[flag];
      if (numKey !== undefined) {
        const raw = args[++i];
        if (raw === undefined) return `${arg} needs a value`;
        const num = Number(raw);
        if (raw.trim() === "" || !Number.isFinite(num)) {
          return `${arg} needs a number, got "${raw}"`;
        }
        overrides[numKey] = num;
      } else if (boolKey !== undefined) {
        const next = args[i + 1];
        if (next === "true" || next === "false") {
          i++;
          overrides[boolKey] = next === "true";
        } else {
          overrides[boolKey] = true;
        }
      } else {
        return `unknown option ${arg}`;
      }
    } else if (input === undefined) {
      input = arg;
    } else if (outDir === undefined) {
      outDir = arg;
    } else {
      return `unexpected argument "${arg}"`;
    }
  }

  return {
    preset,
    maps,
    stem,
    input,
    outDir,
    overrides: overrides as Partial<MaterialStudioMapParams>,
  };
}

function pickMapImage(derived: MaterialPbrMaps, name: MapOutputName): MaterialPbrMaps["diffuse"] {
  if (name === "albedo" || name === "diffuse") return derived.diffuse;
  return derived[name];
}

export async function runMaterialCommand(args: readonly string[], io: CliIo): Promise<number> {
  if (
    args[0] === "-h" ||
    args[0] === "--help" ||
    (args[0] === "gen" && (args[1] === "-h" || args[1] === "--help"))
  ) {
    io.out(MATERIAL_HELP);
    return 0;
  }

  const parsed = parseMaterialArgs(args);
  if (typeof parsed === "string") {
    io.err(`swm material: error: ${parsed}`);
    io.err('Run "swm material --help" for usage.');
    return 1;
  }
  if (parsed.input === undefined) {
    io.err("swm material: error: missing <diffuse.png>");
    io.err('Run "swm material --help" for usage.');
    return 1;
  }
  if (parsed.outDir === undefined) {
    io.err("swm material: error: missing <out-dir>");
    io.err('Run "swm material --help" for usage.');
    return 1;
  }

  const params: MaterialStudioMapParams = {
    ...MATERIAL_STUDIO_PRESETS[parsed.preset],
    ...parsed.overrides,
  };
  const stem = parsed.stem ?? defaultStem(parsed.input);
  const needDiffuseCopy = parsed.maps.includes("diffuse") || parsed.maps.includes("albedo");

  try {
    const rasterIo = new NodePngRasterIO();
    const inputBytes = await readFile(parsed.input);
    const diffuseImage = await rasterIo.decode(inputBytes);
    const derived = derivePbrMaps(diffuseImage, params, { copyDiffuse: needDiffuseCopy });

    await mkdir(parsed.outDir, { recursive: true });
    for (const mapName of parsed.maps) {
      const outPath = join(parsed.outDir, `${stem}_${mapName}.png`);
      const pngBytes = await rasterIo.encodePng(pickMapImage(derived, mapName));
      await writeFile(outPath, pngBytes);
    }

    io.out(
      `swm material: ${parsed.preset} (${parsed.maps.join(",")}) -> ${join(parsed.outDir, `${stem}_*.png`)}`,
    );
    return 0;
  } catch (error) {
    io.err(`swm material: error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

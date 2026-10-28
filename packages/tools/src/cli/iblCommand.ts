/**
 * `swm ibl`: equirectangular panorama (file or seed-generated via `core/ibl.ts`) ->
 * baked IBL cubemaps (`env.png`, `irradiance.png`, `brdf_lut.png`, `prefilter/mip0..N.png`)
 * and `manifest.json`.
 *
 * Per ADR 0034, the pure panorama generator and option/manifest contracts live in
 * `core/ibl.ts`; the WebGL2 convolution (`IBLBaker`) runs in a throw-away headless
 * Chrome subprocess with SwiftShader. `--panorama-only` writes the deterministic
 * `input.png` + `manifest.json` without launching a browser.
 */

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NodePngRasterIO } from "../core/RasterIO.js";
import {
  generateTestEquirect,
  IBL_GEN_DEFAULTS,
  resolveIblGenOptions,
  type IblBakeManifest,
  type IblGenDefaults,
  type IblGenOptions,
} from "../core/ibl.js";
import type { CliIo } from "./index.js";

const CLI_DIR = dirname(fileURLToPath(import.meta.url));
const IBL_GEN_DIR = resolve(CLI_DIR, "..", "ibl-gen");

export type IblBakeRunner = (
  inputPng: Uint8Array,
  options: IblGenDefaults,
) => Promise<ReadonlyMap<string, Uint8Array>>;

export const IBL_HELP = `Bake IBL environment, irradiance, GGX prefilter and BRDF LUT maps.

Usage:
  swm ibl [bake] [options] <out-dir>

Options:
  -i, --input <panorama.png>       equirectangular PNG input (default: generated from --seed)
      --seed <n>                   PRNG seed for generated panorama (default: 0)
      --width <px>                 generated panorama width (default: 512)
      --height <px>                generated panorama height (default: 256)
      --env-resolution <px>        environment cubemap face size (default: ${IBL_GEN_DEFAULTS.envResolution})
      --irradiance-resolution <px> irradiance cubemap face size (default: ${IBL_GEN_DEFAULTS.irradianceResolution})
      --prefilter-resolution <px>  prefilter mip0 face size (default: ${IBL_GEN_DEFAULTS.prefilterResolution})
      --prefilter-mips <n>         number of prefilter mip levels (default: ${IBL_GEN_DEFAULTS.prefilterMips})
      --brdf-resolution <px>       BRDF LUT size (default: ${IBL_GEN_DEFAULTS.brdfResolution})
      --panorama-only              write only input.png + manifest.json (no headless browser)
      --out <dir>                  output directory (alternative to positional <out-dir>)
`;

const INTEGER_FLAGS = {
  seed: "seed",
  width: "width",
  height: "height",
  "env-resolution": "envResolution",
  "irradiance-resolution": "irradianceResolution",
  "prefilter-resolution": "prefilterResolution",
  "prefilter-mips": "prefilterMips",
  "brdf-resolution": "brdfResolution",
} as const satisfies Record<string, keyof IblGenOptions>;

interface ParsedIblArgs {
  input: string | undefined;
  outDir: string | undefined;
  panoramaOnly: boolean;
  rawOptions: Partial<IblGenOptions>;
}

function parseIblArgs(rawArgs: readonly string[]): ParsedIblArgs | string {
  const args = rawArgs[0] === "bake" ? rawArgs.slice(1) : rawArgs;
  let input: string | undefined;
  let outDir: string | undefined;
  let panoramaOnly = false;
  const rawOptions: Partial<Record<keyof IblGenOptions, number>> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-i" || arg === "--input") {
      const val = args[++i];
      if (val === undefined) return `${arg} needs a value`;
      input = val;
    } else if (arg === "--out") {
      const val = args[++i];
      if (val === undefined) return "--out needs a value";
      outDir = val;
    } else if (arg === "--panorama-only") {
      panoramaOnly = true;
    } else if (arg.startsWith("--")) {
      const flag = arg.slice(2) as keyof typeof INTEGER_FLAGS;
      const optionKey = INTEGER_FLAGS[flag];
      if (optionKey === undefined) {
        return `unknown option ${arg}`;
      }
      const raw = args[++i];
      if (raw === undefined) return `${arg} needs a value`;
      const num = Number(raw);
      if (raw.trim() === "" || !Number.isInteger(num)) {
        return `${arg} needs an integer, got "${raw}"`;
      }
      rawOptions[optionKey] = num;
    } else if (outDir === undefined) {
      outDir = arg;
    } else {
      return `unexpected argument "${arg}"`;
    }
  }

  return { input, outDir, panoramaOnly, rawOptions };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const HARNESS_SOURCE = `
import { IBLBaker } from "./ibl-gen.js";

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

window.__swIblBake = async (config) => {
  const { options } = config;
  const baker = new IBLBaker(options);
  const raw = atob(config.pngBase64);
  const pngBytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) pngBytes[i] = raw.charCodeAt(i);
  const inputFile = new File([pngBytes], "input.png", { type: "image/png" });
  const outputs = [];
  try {
    await baker.generateBRDF("brdfCanvas");
    const equiTex = await baker.loadEquirectangularImage(inputFile);
    const envCube = await baker.generateEnvironmentCubemap(equiTex, "envCanvas");
    const irrCube = await baker.generateIrradianceCubemap(envCube, "irradianceCanvas");
    const prefCube = await baker.generatePrefilteredCubemap(envCube, "prefilterCanvas");
    outputs.push(
      { name: "env.png", base64: await blobToBase64(await baker.exportCubemapToCross(envCube, options.envResolution, 0)) },
      { name: "irradiance.png", base64: await blobToBase64(await baker.exportCubemapToCross(irrCube, options.irradianceResolution, 0)) },
      { name: "brdf_lut.png", base64: await blobToBase64(await baker.exportBRDFToBlob("brdfCanvas")) },
    );
    let prefilterSize = options.prefilterResolution;
    for (let mip = 0; mip < options.prefilterMips; mip++) {
      outputs.push({
        name: "prefilter/mip" + mip + ".png",
        base64: await blobToBase64(await baker.exportCubemapToCross(prefCube, prefilterSize, mip)),
      });
      prefilterSize = Math.floor(prefilterSize / 2);
    }
  } finally {
    baker.dispose();
  }
  return { outputs };
};
`;

async function bundleIblHarness(): Promise<string> {
  const { build } = await import("esbuild");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const result = await build({
    stdin: {
      contents: HARNESS_SOURCE,
      resolveDir: IBL_GEN_DIR,
      sourcefile: "swm-ibl-harness.ts",
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "chrome120",
    logLevel: "silent",
    plugins: [
      {
        name: "raw-text-imports",
        setup(b): void {
          b.onResolve({ filter: /\?raw$/ }, (args) => ({
            path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, "")),
            namespace: "raw-text",
          }));
          b.onLoad({ filter: /.*/, namespace: "raw-text" }, (args) => ({
            contents: `export default ${JSON.stringify(fs.readFileSync(args.path, "utf8"))};`,
            loader: "js",
          }));
        },
      },
      {
        name: "ts-js-resolve",
        setup(b): void {
          b.onResolve({ filter: /\.js$/ }, (args) => {
            const base = path.resolve(args.resolveDir, args.path);
            const ts = base.replace(/\.js$/, ".ts");
            if (fs.existsSync(ts)) return { path: ts };
            return { path: base };
          });
        },
      },
    ],
  });
  return result.outputFiles[0]!.text;
}

export const defaultBrowserBakeRunner: IblBakeRunner = async (
  inputPng: Uint8Array,
  options: IblGenDefaults,
): Promise<ReadonlyMap<string, Uint8Array>> => {
  const puppeteer = await import("puppeteer");
  const bundleText = await bundleIblHarness();
  const tmpDir = await mkdtemp(join(tmpdir(), "swm-ibl-bake-"));

  try {
    const html = `<!doctype html>
<html><head><meta charset="utf-8" /></head>
<body>
  <canvas id="envCanvas" width="${options.envResolution}" height="${options.envResolution}" style="display:none"></canvas>
  <canvas id="irradianceCanvas" width="${options.irradianceResolution}" height="${options.irradianceResolution}" style="display:none"></canvas>
  <canvas id="prefilterCanvas" width="${options.prefilterResolution}" height="${options.prefilterResolution}" style="display:none"></canvas>
  <canvas id="brdfCanvas" width="${options.brdfResolution}" height="${options.brdfResolution}" style="display:none"></canvas>
  <canvas id="previewCanvas" width="1" height="1" style="display:none"></canvas>
  <script>${bundleText}</script>
</body></html>`;
    const htmlPath = join(tmpDir, "index.html");
    await writeFile(htmlPath, html, "utf8");

    const userDataDir = join(tmpDir, "profile");
    await mkdir(userDataDir, { recursive: true });
    const browser = await puppeteer.default.launch({
      headless: true,
      userDataDir,
      protocolTimeout: 60000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--ignore-certificate-errors",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
        "--disable-gpu-sandbox",
      ],
    });

    try {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle0" });
      await page.waitForFunction(
        () => typeof (window as unknown as { __swIblBake?: unknown }).__swIblBake === "function",
      );
      const b64 = Buffer.from(inputPng).toString("base64");
      const outputs = await page.evaluate(
        async (pngBase64, bakeOptions) => {
          const fn = (
            window as unknown as {
              __swIblBake: (cfg: {
                pngBase64: string;
                options: IblGenDefaults;
              }) => Promise<{ outputs: Array<{ name: string; base64: string }> }>;
            }
          ).__swIblBake;
          const res = await fn({ pngBase64, options: bakeOptions });
          return res.outputs;
        },
        b64,
        options,
      );

      const files = new Map<string, Uint8Array>();
      for (const item of outputs) {
        files.set(item.name, new Uint8Array(Buffer.from(item.base64, "base64")));
      }
      return files;
    } finally {
      await browser.close();
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
};

export async function runIblCommand(
  args: readonly string[],
  io: CliIo,
  bakeRunner: IblBakeRunner = defaultBrowserBakeRunner,
): Promise<number> {
  if (
    args[0] === "-h" ||
    args[0] === "--help" ||
    (args[0] === "bake" && (args[1] === "-h" || args[1] === "--help"))
  ) {
    io.out(IBL_HELP);
    return 0;
  }

  const parsed = parseIblArgs(args);
  if (typeof parsed === "string") {
    io.err(`swm ibl: error: ${parsed}`);
    io.err('Run "swm ibl --help" for usage.');
    return 1;
  }
  if (parsed.outDir === undefined) {
    io.err("swm ibl: error: missing <out-dir>");
    io.err('Run "swm ibl --help" for usage.');
    return 1;
  }

  try {
    const rasterIo = new NodePngRasterIO();
    let inputPng: Uint8Array;
    let width = parsed.rawOptions.width;
    let height = parsed.rawOptions.height;

    if (parsed.input !== undefined) {
      const fileBytes = await readFile(parsed.input);
      const decoded = await rasterIo.decode(fileBytes);
      inputPng = new Uint8Array(fileBytes);
      width = decoded.width;
      height = decoded.height;
    } else {
      const preOpts = resolveIblGenOptions(parsed.rawOptions);
      width = preOpts.width;
      height = preOpts.height;
      const rgba = generateTestEquirect(preOpts.seed, width, height);
      inputPng = await rasterIo.encodePng({ width, height, data: rgba });
    }

    const options = resolveIblGenOptions({
      ...parsed.rawOptions,
      width,
      height,
    });

    await mkdir(parsed.outDir, { recursive: true });
    await writeFile(join(parsed.outDir, "input.png"), inputPng);

    const manifest: IblBakeManifest = {
      tool: "ibl-bake",
      schema: 1,
      seed: options.seed,
      options: {
        width: options.width,
        height: options.height,
        envResolution: options.envResolution,
        irradianceResolution: options.irradianceResolution,
        prefilterResolution: options.prefilterResolution,
        prefilterMips: options.prefilterMips,
        brdfResolution: options.brdfResolution,
      },
      inputSha256: sha256Hex(inputPng),
      outputs: [],
    };

    if (!parsed.panoramaOnly) {
      const files = await bakeRunner(inputPng, {
        envResolution: options.envResolution,
        irradianceResolution: options.irradianceResolution,
        prefilterResolution: options.prefilterResolution,
        prefilterMips: options.prefilterMips,
        brdfResolution: options.brdfResolution,
      });
      for (const [name, bytes] of files) {
        const dest = join(parsed.outDir, name.replaceAll("/", sep));
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, bytes);
        manifest.outputs.push({ name, bytes: bytes.length, sha256: sha256Hex(bytes) });
      }
    }

    await writeFile(
      join(parsed.outDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    const modeLabel = parsed.panoramaOnly ? "panorama" : `baked ${manifest.outputs.length} maps`;
    io.out(`swm ibl: ${options.width}x${options.height} (${modeLabel}) -> ${parsed.outDir}`);
    return 0;
  } catch (error) {
    io.err(`swm ibl: error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

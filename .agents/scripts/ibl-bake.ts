#!/usr/bin/env node
/**
 * Headless IBL bake CLI — the "proof" tool from deliberation P1.
 *
 * Drives the REAL engine WebGL2 pipeline (IBLBaker) in a throw-away headless
 * Chromium page via Puppeteer, with a seed-deterministic generated input panorama
 * (pure core, packages/tools/src/ibl-gen/ibl-gen-core.ts). All hashing/manifest
 * assembly happens in Node — the browser only returns PNG payloads. Same seed +
 * options -> identical output bytes and identical manifest hashes (measurement).
 *
 * Usage:
 *   tsx scripts/ibl-bake.ts --seed 7 --out .agents/scratches/ibl-bake
 */

import { build } from "esbuild";
import puppeteer from "puppeteer";
import { PNG } from "pngjs";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  generateTestEquirect,
  resolveIblGenOptions,
  type IblGenOptions,
  type IblBakeManifest,
} from "../../packages/tools/src/ibl-gen/ibl-gen-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

interface CliArgs {
  seed: number;
  out: string;
  width: number;
  height: number;
  dumpHtml: boolean;
  input: string | undefined;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    seed: 0,
    out: path.join(PROJECT_ROOT, ".agents", "scratches", "ibl-bake"),
    width: 512,
    height: 256,
    dumpHtml: false,
    input: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--seed":
        args.seed = Number(next());
        break;
      case "--out":
        args.out = path.resolve(next());
        break;
      case "--width":
        args.width = Number(next());
        break;
      case "--height":
        args.height = Number(next());
        break;
      case "--input":
        args.input = path.resolve(next());
        break;
      case "--dump-html":
        args.dumpHtml = true;
        break;
      case "--help":
        console.log(`Usage: tsx scripts/ibl-bake.ts --seed <n> [--out <dir>] [--width W] [--height H] [--input pano.png]
  Headless IBL bake with a seed-deterministic generated input panorama (P1 proof).
  --input bakes your own equirect PNG instead of the generated one (width/height come from the file).
  Input and output are sRGB-encoded 8-bit, the convolution runs linear (ADR 0048).
  Writes env.png, irradiance.png, brdf_lut.png, prefilter/mipN.png + manifest.json.`);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  return PNG.sync.write(png);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function bundleHarness(): Promise<string> {
  const result = await build({
    entryPoints: [path.join(__dirname, "ibl-bake-harness.ts")],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "chrome120",
    logLevel: "silent",
    plugins: [
      {
        name: "raw-text-imports",
        setup(build) {
          build.onResolve({ filter: /\?raw$/ }, (args) => ({
            path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, "")),
            namespace: "raw-text",
          }));
          build.onLoad({ filter: /.*/, namespace: "raw-text" }, (args) => ({
            contents: `export default ${JSON.stringify(fs.readFileSync(args.path, "utf8"))};`,
            loader: "js",
          }));
        },
      },
      {
        name: "ts-js-resolve",
        setup(build) {
          build.onResolve({ filter: /\.js$/ }, (args) => {
            const base = path.resolve(args.resolveDir, args.path);
            const ts = base.replace(/\.js$/, ".ts");
            if (fs.existsSync(ts)) return { path: ts };
            return { path: base };
          });
        },
      },
    ],
  });
  const text = result.outputFiles[0]!.text;
  if (!text.includes("__swIblBake")) {
    throw new Error("Harness bundle missing window.__swIblBake export");
  }
  return text;
}

async function runBakeInBrowser(
  bundleText: string,
  pngBase64: string,
  options: IblGenOptions,
): Promise<Map<string, Buffer>> {
  const tmpUserDir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-ibl-bake-"));
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: tmpUserDir,
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
    const pageUrl = await writeHarnessPage(bundleText, options);
    const page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => typeof window.__swIblBake === "function");
    const result = await page.evaluate(
      async (b64, bakeOptions) => {
        const { outputs } = await window.__swIblBake({
          pngBase64: b64,
          options: bakeOptions,
        });
        return outputs;
      },
      pngBase64,
      {
        envResolution: options.envResolution,
        irradianceResolution: options.irradianceResolution,
        prefilterResolution: options.prefilterResolution,
        prefilterMips: options.prefilterMips,
        brdfResolution: options.brdfResolution,
      },
    );

    const files = new Map<string, Buffer>();
    for (const output of result) {
      files.set(output.name, Buffer.from(output.base64, "base64"));
    }
    return files;
  } finally {
    await browser.close();
    fs.rmSync(tmpUserDir, { recursive: true, force: true });
  }
}

async function writeHarnessPage(bundleText: string, options: IblGenOptions): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sw-ibl-page-"));
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
  const htmlPath = path.join(dir, "index.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  return pathToFileURL(htmlPath).href;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const customInput = args.input ? PNG.sync.read(fs.readFileSync(args.input)) : undefined;
  const options: IblGenOptions = resolveIblGenOptions({
    seed: args.seed,
    width: customInput?.width ?? args.width,
    height: customInput?.height ?? args.height,
  });

  fs.mkdirSync(args.out, { recursive: true });

  console.log(`[ibl-bake] seed=${options.seed} ${options.width}x${options.height} -> ${args.out}`);

  const inputPng = customInput
    ? fs.readFileSync(args.input!)
    : encodePng(
        options.width,
        options.height,
        generateTestEquirect(options.seed, options.width, options.height),
      );
  const inputSha256 = sha256Hex(inputPng);

  console.log(`[ibl-bake] input.png ${inputPng.length} bytes, sha256 ${inputSha256.slice(0, 16)}…`);

  const bundleText = await bundleHarness();
  if (args.dumpHtml) {
    const dump = path.join(args.out, "harness-debug.html");
    fs.writeFileSync(dump, await writeHarnessPage(bundleText, options), "utf8");
    console.log(`[ibl-bake] harness dumped to ${dump}`);
  }

  const files = await runBakeInBrowser(bundleText, inputPng.toString("base64"), options);

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
    inputSha256,
    outputs: [],
  };

  fs.writeFileSync(path.join(args.out, "input.png"), inputPng);
  for (const [name, bytes] of files) {
    const safeName = name.replaceAll("/", path.sep);
    const dest = path.join(args.out, safeName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
    manifest.outputs.push({ name, bytes: bytes.length, sha256: sha256Hex(bytes) });
    console.log(`[ibl-bake] wrote ${name} (${bytes.length} bytes)`);
  }

  const manifestPath = path.join(args.out, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`[ibl-bake] manifest.json written to ${manifestPath}`);
  console.log(`[ibl-bake] DONE (${manifest.outputs.length} outputs)`);
}

main().catch((err: unknown) => {
  console.error("[ibl-bake] ERROR:", err instanceof Error ? err.message : err);
  process.exit(1);
});

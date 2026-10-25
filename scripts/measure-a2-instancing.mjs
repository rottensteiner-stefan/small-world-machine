// Real-browser draw-call measurement for the A2 geometry-grouping instancing work
// (docs/research/instanced-batching-2026-10-24.md §7.1(b)/§9.1).
//
// Loads Showcase 44 (hardware WebGL2, geometry-mix scatter, one material) in a headless Chrome
// with software WebGL2 (same launch matrix as scripts/check-showcases.js) and measures two legs:
//   - default              -> autoInstancing ON  (A2-active: 2 instanced draws expected)
//   - ?inst=off            -> per-object baseline (1600 draw calls expected)
// Each leg samples `frames` frames in-browser (see Showcase 44) and reports draws/frame + frame
// time. The scene/pdf counts come from Showcase 44 itself; overrides via A2_COUNT / A2_FRAMES.
//
// The script starts its own `vite preview` server on 4173 (dist must be built first) and tears it
// down afterwards -- mirroring check-showcases.js.

import puppeteer from "puppeteer";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PREVIEW_ARGS, PREVIEW_ORIGIN, waitForServer } from "./lib/preview-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COUNT = Number(process.env.A2_COUNT) || 1600;
const FRAMES = Number(process.env.A2_FRAMES) || 240;
// Real-GPU mode (A2_GPU=1): headed Chrome on the actual GPU (Metal/ANGLE, NOT SwiftShader) with the
// compositor frame-rate cap disabled, so frame time reflects real GPU/driver cost instead of being
// clamped by vsync. This is the device-bound measurement the report §9.1.1 left as a follow-up.
const GPU = process.env.A2_GPU === "1";
const GPU_VIEWPORT = { width: 1440, height: 900 };
const URL_PREFIX = `${PREVIEW_ORIGIN}/apps/showcases/44/index.html`;
const LEGS = [
  { label: "inst=on (A2-active)", suffix: "" },
  { label: "inst=off (baseline)", suffix: "&inst=off" },
];

const __ROOT = path.resolve(__dirname, "..");

function line(prefix, ...args) {
  console.log(`[${prefix}]`, ...args);
}

async function waitForMeasure(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page
      .evaluate(() => {
        // eslint-disable-next-line no-undef -- runs inside the page (Puppeteer), not Node
        const el = document.getElementById("__measure");
        return el ? el.textContent : null;
      })
      .catch(() => null);
    if (last && last.startsWith("MEASURE ")) return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`measurement did not finalize; last status: ${JSON.stringify(last)}`);
}

/**
 * Reads the real WebGL renderer identity + drawing buffer size from a live page. Confirms a
 * real-GPU run: a hardware renderer string (e.g. "ANGLE (Apple, Apple M..., OpenGL 4.1 Metal)") vs
 * "SwiftShader" proves whether the measurement actually ran on the GPU. Never fails the run -- the
 * identity is informational only.
 */
async function gpuIdentity(page) {
  return page
    .evaluate(() => {
      // eslint-disable-next-line no-undef -- runs inside the page (Puppeteer), not Node
      const canvas = document.querySelector("canvas");
      const gl = canvas ? canvas.getContext("webgl2") || canvas.getContext("webgl") : null;
      const dbg =
        gl && typeof gl.getExtension === "function"
          ? gl.getExtension("WEBGL_debug_renderer_info")
          : null;
      return {
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
        width: canvas ? canvas.width : null,
        height: canvas ? canvas.height : null,
      };
    })
    .catch(() => null);
}

async function run() {
  line("server", "Starting Vite preview server on", PREVIEW_ORIGIN);
  const server = spawn("npm", PREVIEW_ARGS, { stdio: ["ignore", "pipe", "pipe"], detached: true });
  server.stdout.on("data", (d) => process.stdout.write(`[preview] ${d}`));
  server.stderr.on("data", (d) => process.stderr.write(`[preview!] ${d}`));

  try {
    await waitForServer(`${PREVIEW_ORIGIN}/`);

    const tmpDir = path.join(__ROOT, ".agents", "scratches", "tmp_a2_measure_" + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    if (GPU) {
      line("browser", "Launching headed Chrome on the REAL GPU (Metal/ANGLE, vsync uncapped)...");
    } else {
      line("browser", "Launching headless Chrome (software WebGL2)...");
    }
    const browser = await puppeteer.launch({
      headless: !GPU,
      userDataDir: tmpDir,
      acceptInsecureCerts: true,
      protocolTimeout: 60000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--ignore-certificate-errors",
        ...(GPU
          ? [
              // Real GPU: ANGLE on Metal, no SwiftShader fallback, no vsync cap -- frame time is
              // then the true renderer cost, not a refresh-rate clamp.
              "--use-gl=angle",
              "--use-angle=metal",
              "--enable-gpu",
              "--ignore-gpu-blocklist",
              "--disable-gpu-sandbox",
              "--enable-webgl",
              "--disable-frame-rate-limit",
              "--disable-gpu-vsync",
              "--disable-vsync",
            ]
          : [
              // Headless CI-ish path: deterministic software WebGL2 (same matrix as check-showcases).
              "--use-gl=angle",
              "--use-angle=swiftshader",
              "--enable-webgl",
              "--enable-unsafe-swiftshader",
              "--ignore-gpu-blocklist",
              "--disable-gpu-sandbox",
              "--enable-features=Vulkan",
              "--enable-unsafe-webgpu",
            ]),
      ],
    });

    try {
      for (const leg of LEGS) {
        const page = await browser.newPage();
        const pageErrors = [];
        if (GPU) await page.setViewport(GPU_VIEWPORT);
        page.on("console", (msg) => {
          if (msg.type() === "error") pageErrors.push(`console.error: ${msg.text()}`);
        });
        page.on("pageerror", (err) => pageErrors.push(`pageerror: ${err.message}`));

        const url = `${URL_PREFIX}?count=${COUNT}&frames=${FRAMES}${leg.suffix}`;
        line("load", `${leg.label} :: ${url}`);
        try {
          await page.goto(url, { waitUntil: "load", timeout: 180000 });
          if (GPU) {
            const id = await gpuIdentity(page);
            line("gpu", leg.label, JSON.stringify(id));
          }
          const text = await waitForMeasure(page, 300000);
          const jsonText = text.slice("MEASURE ".length);
          let parsed;
          try {
            parsed = JSON.parse(jsonText);
          } catch (err) {
            throw new Error(`could not parse MEASURE payload: ${jsonText} (${err.message})`, {
              cause: err,
            });
          }
          console.log(`RESULT ${leg.label}`);
          console.log(`  drawCallsPerFrame      ${parsed.drawCallsPerFrame}`);
          console.log(`  perObjectDrawsPerFrame ${parsed.perObjectDrawsPerFrame}`);
          console.log(`  instancedDrawsPerFrame ${parsed.instancedDrawsPerFrame}`);
          console.log(`  avgFps                 ${parsed.avgFps.toFixed(2)}`);
          console.log(`  frameTimeMs            ${parsed.frameTimeMs.toFixed(3)}`);
          console.log(`  full                   ${jsonText}`);
        } catch (err) {
          const diag = await page
            .evaluate(() => {
              // eslint-disable-next-line no-undef -- runs inside the page (Puppeteer), not Node
              const el = document.getElementById("__measure");
              return {
                overlay: el ? el.textContent : null,
                // eslint-disable-next-line no-undef -- runs inside the page (Puppeteer), not Node
                url: window.location.href,
              };
            })
            .catch(() => null);
          console.error(`LEG FAILED (${leg.label}): ${err.message}`);
          if (diag) console.error(`  page: ${diag.overlay} @ ${diag.url}`);
          throw err;
        } finally {
          if (pageErrors.length) {
            console.log(`  pageErrors (${pageErrors.length}):`);
            pageErrors.slice(0, 8).forEach((e) => console.log(`    - ${e}`));
          }
        }
        await page.close();
      }
    } finally {
      await browser.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    line("server", "Killing preview server");
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill();
    }
  }
}

run().catch((err) => {
  console.error(`FATAL ${err.message}`);
  process.exit(1);
});

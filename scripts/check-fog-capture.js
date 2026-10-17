/**
 * Checks that capture mode (`?captureFps=60`) is deterministic: each showcase is loaded in fresh pages
 * per run and per backend, the canvas is hashed at fixed frame indices, and the hashes are compared
 * frame by frame across runs. Showcase 39 covers the volumetric fog and its temporal history, 28 the
 * glass/transmission and emissive-texture paths. Hashes are only compared between runs of the SAME
 * environment (device, driver, browser); they are not expected to match across machines.
 *
 * Usage: node scripts/check-fog-capture.js [--showcases 39,28] [--backends gl1,gl2,gpu] [--runs 2] [--frames 10,30,120]
 * A showcase needs a `window.__showcase<id>` QA hook (set by apps/showcases/<id>/showcase.ts).
 * Env:   BASE_URL (default: spawn `vite preview` over dist/ like the other scripts; never builds),
 *        SHOWCASE_SKIP_WEBGPU=1 skips WebGPU, SHOWCASE_REQUIRE_WEBGPU=1 fails if it is unusable.
 * Exit:  1 if any non-skipped backend has a DIFF (or a run fails), else 0 (unusable WebGPU = SKIPPED).
 *
 * Pitfalls handled: rAF does not tick in background tabs (one foreground page at a time, fixed
 * 640x360 viewport, DPR 1); WebGL canvases must be read in the same task as the render (the
 * `app.step` wrapper hashes right after the original step); the wrapper must be installed before
 * frame 10 (a setter trap on `window.__showcase39` installs it the moment the app is assigned).
 */
/* global window, document */
import puppeteer from "puppeteer";
import { spawn } from "child_process";
import { PREVIEW_ARGS, PREVIEW_ORIGIN, waitForServer } from "./lib/preview-utils.js";

const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS) || 60000;
const BACKENDS = { gl1: "WEB_GL1", gl2: "WEB_GL2", gpu: "WEB_GPU" };
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const showcases = opt("showcases", "39,28").split(",");
const backends = opt("backends", "gl1,gl2,gpu").split(",");
const runs = Number(opt("runs", "2"));
const frames = opt("frames", "10,30,120").split(",").map(Number);
const lastFrame = Math.max(...frames);
for (const b of backends) if (!BACKENDS[b]) throw new Error(`Unknown backend "${b}"`);
for (const id of showcases) if (!/^\d+$/.test(id)) throw new Error(`Unknown showcase "${id}"`);

/** Runs inside every new document: hooks the app the moment the showcase assigns it. */
function installHook(targets, last, hookName) {
  let app;
  window.__caps = {};
  Object.defineProperty(window, hookName, {
    configurable: true,
    get: () => app,
    set(value) {
      app = value;
      const orig = app.step.bind(app);
      app.step = (dt) => {
        orig(dt);
        const f = app.frameInfo.frameIndex;
        if (targets.includes(f)) {
          const { width, height } = app.canvas;
          const tmp = document.createElement("canvas");
          tmp.width = width;
          tmp.height = height;
          const ctx = tmp.getContext("2d");
          ctx.drawImage(app.canvas, 0, 0);
          const data = ctx.getImageData(0, 0, width, height).data;
          let h = 0x811c9dc5;
          for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 0x01000193);
          window.__caps[f] = {
            hash: (h >>> 0).toString(16).padStart(8, "0"),
            width,
            height,
            time: app.frameInfo.time,
          };
        }
        if (f >= last) {
          app.stop();
          window.__done = true;
        }
      };
    },
  });
}

async function probeWebGpu(browser, origin) {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}/`, { waitUntil: "load", timeout: 20000 });
    return await page.evaluate(async () => {
      if (!navigator.gpu) return "navigator.gpu is undefined";
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return "requestAdapter() returned null";
      const device = await adapter.requestDevice();
      device.destroy();
      return null;
    });
  } catch (err) {
    return `probe threw: ${err.message}`;
  } finally {
    await page.close();
  }
}

async function captureRun(browser, origin, showcase, rendererType) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(installHook, frames, lastFrame, `__showcase${showcase}`);
    const url = `${origin}/apps/showcases/${showcase}/index.html?rendererType=${rendererType}&captureFps=60`;
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction("window.__done === true", { timeout: RUN_TIMEOUT_MS, polling: 100 });
    return await page.evaluate(() => window.__caps);
  } finally {
    await page.close();
  }
}

async function main() {
  let server;
  let origin = process.env.BASE_URL;
  if (!origin) {
    server = spawn("npm", PREVIEW_ARGS, { stdio: "ignore", detached: true });
    origin = PREVIEW_ORIGIN;
    await waitForServer(`${origin}/`);
  }
  const browser = await puppeteer.launch({
    headless: true,
    acceptInsecureCerts: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--ignore-certificate-errors",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--disable-gpu-sandbox",
      "--enable-features=Vulkan",
      "--enable-unsafe-webgpu",
    ],
  });
  let failed = false;
  const summary = [];
  let gpuReason; // probed once, `null` = usable
  try {
    for (const id of showcases)
      for (const key of backends) {
        const label = `${id}/${key}`;
        console.log(`\n== showcase ${id}: ${key} (${BACKENDS[key]}) ==`);
        if (key === "gpu") {
          gpuReason ??= process.env.SHOWCASE_SKIP_WEBGPU
            ? "SHOWCASE_SKIP_WEBGPU set"
            : await probeWebGpu(browser, origin);
          const reason = gpuReason;
          if (reason) {
            if (process.env.SHOWCASE_REQUIRE_WEBGPU && !process.env.SHOWCASE_SKIP_WEBGPU)
              failed = true;
            console.log(`SKIPPED (${reason})`);
            summary.push(`${label}=SKIPPED`);
            continue;
          }
        }
        const results = [];
        try {
          for (let r = 0; r < runs; r++)
            results.push(await captureRun(browser, origin, id, BACKENDS[key]));
        } catch (err) {
          console.log(
            /Waiting failed/.test(err.message)
              ? `TIMEOUT after ${RUN_TIMEOUT_MS} ms`
              : `FAILED: ${err.message}`,
          );
          failed = true;
          summary.push(`${label}=ERROR`);
          continue;
        }
        let diffs = 0;
        console.log(
          `frame  ${results.map((_, i) => `run${i + 1}`.padEnd(9)).join("")} size       time      result`,
        );
        for (const f of frames) {
          const caps = results.map((res) => res[f]);
          const hashes = caps.map((c) => c?.hash ?? "missing");
          const match = hashes.every((h) => h !== "missing" && h === hashes[0]);
          if (!match) diffs++;
          const c = caps[0] ?? {};
          console.log(
            `${String(f).padEnd(7)}${hashes.map((h) => h.padEnd(9)).join("")} ${`${c.width}x${c.height}`.padEnd(10)} ${(c.time?.toFixed(6) ?? "?").padEnd(9)} ${match ? "MATCH" : "DIFF"}`,
          );
        }
        if (diffs) failed = true;
        summary.push(`${label}=${diffs ? `DIFF(${diffs})` : "OK"}`);
      }
  } finally {
    await browser.close();
    if (server) process.kill(-server.pid);
  }
  console.log(`\nSummary: ${summary.join("  ")} -> ${failed ? "FAIL" : "PASS"}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

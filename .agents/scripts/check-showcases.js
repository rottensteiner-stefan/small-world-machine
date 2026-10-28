import puppeteer from "puppeteer";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import {
  PREVIEW_ARGS,
  PREVIEW_ORIGIN,
  detectBlankCanvas as measureBlank,
  waitForServer,
} from "./lib/preview-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(__dirname, "..", "..", ".agents", "scratches", "screenshots");
// Below this per-pixel luminance standard deviation, we treat the canvas as
// "effectively a single flat color" -- i.e. nothing was actually rendered,
// even though no console/page error was thrown (this is exactly the kind of
// silent regression a pure error-listener check cannot catch).
const BLANK_CANVAS_STDDEV_THRESHOLD = 2.0;

function detectBlankCanvas(pngBuffer) {
  return measureBlank(pngBuffer, BLANK_CANVAS_STDDEV_THRESHOLD);
}

const numberedShowcases = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "26",
  "27",
  "28",
  "29",
  "30",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
  "38",
  "39",
  "40",
  "41",
  "42",
  "43",
  "44",
];

// Every numbered showcase supports a `?rendererType=` override via AbstractShowcase, so each one
// is checked under all three renderer backends -- not just whichever one `RendererType.BEST`
// happens to auto-select in this environment. Without this, a broken WebGPU path can silently
// fall back to WebGL2 in headless Chrome and never actually get exercised (this is exactly how a
// WebGPU-only sampled-texture-budget bug went undetected: CI never ran the WebGPU code path at
// all). `yad` extends `SmallWorldMachine` directly but reads the same `?rendererType=` override, so it is
// checked under all three backends too.
const RENDERER_TYPES = ["WEB_GL1", "WEB_GL2", "WEB_GPU"];
const targetArg = process.argv[2] || process.env.SHOWCASE_TARGET;

// SHOWCASE_SHARD="i/N" (1-based) runs every N-th showcase, so CI can spread the checks over N parallel
// jobs. Showcases (not single checks) are dealt round-robin, which keeps a showcase's backends together
// and spreads the heavy ones; `yad` is dealt like the last showcase.
function parseShard(value) {
  if (!value) return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const index = match ? Number(match[1]) : 0;
  const total = match ? Number(match[2]) : 0;
  if (!match || index < 1 || index > total) {
    throw new Error(`SHOWCASE_SHARD must look like "2/4" (1 <= i <= N), got "${value}"`);
  }
  return { index, total };
}
const shard = parseShard(process.env.SHOWCASE_SHARD);
const showcaseOrder = [...numberedShowcases, "yad"];
// SHOWCASE_SKIP_WEBGPU=1 leaves out the WEB_GPU legs up front (they would otherwise start a page, fail and
// be retried): CI runners have no real GPU, so every WebGPU leg fails there. Skipped, not failed.
const skipWebGpu = Boolean(process.env.SHOWCASE_SKIP_WEBGPU);
if (skipWebGpu && process.env.SHOWCASE_REQUIRE_WEBGPU) {
  throw new Error("SHOWCASE_SKIP_WEBGPU and SHOWCASE_REQUIRE_WEBGPU contradict each other");
}
const testCases = [
  ...numberedShowcases.flatMap((n) =>
    RENDERER_TYPES.map((rendererType) => ({ showcase: n, rendererType })),
  ),
  ...RENDERER_TYPES.map((rendererType) => ({ showcase: "yad", rendererType })),
]
  .filter((tc) => !targetArg || tc.showcase === targetArg)
  .filter((tc) => !skipWebGpu || "WEB_GPU" !== tc.rendererType)
  .filter((tc) => !shard || showcaseOrder.indexOf(tc.showcase) % shard.total === shard.index - 1);

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// How many showcase checks run concurrently (each in its own Puppeteer page/tab within the same
// browser instance). Higher values finish faster but use more CPU/memory at once; tune down via
// this env var if a CI runner's software-rendering pipeline gets overwhelmed under load.
const CONCURRENCY = Number(process.env.SHOWCASE_TEST_CONCURRENCY) || 4;

// Time budgets. The first pass runs several pages against one software-rendered GPU, where a stalled
// screenshot or a slow navigation is nearly always contention: the sequential retry (no contention)
// passes the same check in seconds. So the first pass fails fast and hands the check to the retry
// instead of holding a worker for the whole protocol timeout, and the retry is patient.
// SHOWCASE_FIRST_PASS_TIMEOUT_MS overrides the first-pass values (used to force the stall path in tests).
const FIRST_PASS_TIMEOUT_MS = Number(process.env.SHOWCASE_FIRST_PASS_TIMEOUT_MS) || 20000;
const FIRST_PASS = { navigationMs: FIRST_PASS_TIMEOUT_MS, screenshotMs: FIRST_PASS_TIMEOUT_MS };
const RETRY_PASS = { navigationMs: 60000, screenshotMs: 60000 };
// Showcase 14 (video wall with post-processing) alone needs 12 to 15 s until `load` with software
// rendering on a fast machine, so even the first pass gets a longer navigation budget for it.
const SLOW_SHOWCASE_NAVIGATION_MS = { 14: 60000 };

/** Rejects if `promise` has not settled after `ms` (the underlying call keeps running until the page closes). */
async function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} stalled for ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs `worker` over every item in `items`, with at most `concurrency` calls in flight at once.
 * @param {unknown[]} items
 * @param {number} concurrency
 * @param {(item: unknown, index: number) => Promise<unknown>} worker
 * @returns {Promise<unknown[]>} Results in the same order as `items`.
 */
async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, runNext));
  return results;
}

/**
 * Probes whether this machine can actually run WebGPU: adapter available, device creatable, and the
 * device not immediately lost. On CI runners without a usable software Vulkan driver, Chrome hands
 * out a device that gets destroyed right away ("Device was destroyed" / "Instance dropped error in
 * getCompilationInfo"), so every WEB_GPU check fails regardless of the showcase -- that is an
 * environment limitation, not a regression, and must not be reported as one.
 * @param {import('puppeteer').Browser} browser
 * @returns {Promise<{ usable: boolean, reason: string }>}
 */
async function probeWebGpu(browser) {
  const page = await browser.newPage();
  try {
    // WebGPU needs a secure context; the preview server is served over https.
    await page.goto(`${PREVIEW_ORIGIN}/`, { waitUntil: "load", timeout: 20000 });
    return await page.evaluate(async () => {
      const gpu = navigator.gpu;
      if (!gpu) return { usable: false, reason: "navigator.gpu is undefined" };
      const adapter = await gpu.requestAdapter();
      if (!adapter) return { usable: false, reason: "requestAdapter() returned null" };
      const device = await adapter.requestDevice();
      let lostInfo = null;
      device.lost.then((info) => {
        lostInfo = info;
      });
      device.createBuffer({ size: 16, usage: 0x40 /* GPUBufferUsage.UNIFORM */ });
      device.queue.submit([device.createCommandEncoder().finish()]);
      await device.queue.onSubmittedWorkDone();
      await new Promise((r) => setTimeout(r, 1000));
      if (lostInfo)
        return { usable: false, reason: `device lost: ${lostInfo.reason} ${lostInfo.message}` };
      device.destroy();
      return { usable: true, reason: "ok" };
    });
  } catch (err) {
    return { usable: false, reason: `probe threw: ${err.message}` };
  } finally {
    await page.close();
  }
}

/**
 * Checks a single showcase/rendererType combination in its own page. Buffers its console output
 * instead of writing it immediately, since this runs concurrently with other checks and
 * interleaved writes would garble the log.
 * @param {import('puppeteer').Browser} browser
 * @param {{ showcase: string, rendererType: string | null }} testCase
 * @param {{ navigationMs: number, screenshotMs: number }} budget
 * @returns {Promise<{ passed: boolean, lines: string[] }>}
 */
async function checkShowcase(browser, { showcase, rendererType }, budget) {
  const label = rendererType ? `${showcase} [${rendererType}]` : showcase;
  const lines = [];
  const page = await browser.newPage();
  const errors = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      const url = msg.location()?.url || "";
      if (text.includes("favicon.ico") || url.includes("favicon.ico")) return;
      errors.push(`${text} (URL: ${url})`);
    }
  });

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });

  let passed = true;
  try {
    const query = rendererType ? `?rendererType=${rendererType}` : "";
    // `yad` lives under apps/sample-apps/yad/, the numbered showcases under apps/showcases/N/ --
    // both are workspace packages now, neither is at the old top-level showcases/ path.
    const basePath =
      showcase === "yad" ? `apps/sample-apps/${showcase}` : `apps/showcases/${showcase}`;
    const url = `${PREVIEW_ORIGIN}/${basePath}/index.html${query}`;

    const navigationMs = Math.max(budget.navigationMs, SLOW_SHOWCASE_NAVIGATION_MS[showcase] ?? 0);
    await page.goto(url, { waitUntil: "load", timeout: navigationMs });

    // Give it 1 second of actual running time to catch runtime loops/render errors
    await sleep(1000);

    // Union bounding box of every <canvas> on the page (most showcases have one
    // #SmallWorldMachine canvas, but e.g. showcase 23 renders multiple monitor canvases).
    const canvasRect = await page.evaluate(() => {
      // eslint-disable-next-line no-undef -- runs inside the page (browser context via Puppeteer), not Node
      const canvases = Array.from(document.querySelectorAll("canvas"));
      if (0 === canvases.length) return null;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const c of canvases) {
        const r = c.getBoundingClientRect();
        if (0 === r.width || 0 === r.height) continue;
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      }
      if (!isFinite(minX)) return null;
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    });

    let blankCanvasWarning = null;
    if (canvasRect) {
      const screenshotPath = path.join(
        SCREENSHOT_DIR,
        `showcase_${showcase}${rendererType ? `_${rendererType}` : ""}.png`,
      );
      const buffer = await withTimeout(
        page.screenshot({
          clip: {
            x: Math.max(0, Math.round(canvasRect.x)),
            y: Math.max(0, Math.round(canvasRect.y)),
            width: Math.max(1, Math.round(canvasRect.width)),
            height: Math.max(1, Math.round(canvasRect.height)),
          },
        }),
        budget.screenshotMs,
        "Page.screenshot",
      );
      fs.writeFileSync(screenshotPath, buffer);

      const { blank, stddev } = detectBlankCanvas(buffer);
      if (blank) {
        blankCanvasWarning = `Canvas appears blank/uniform (luminance stddev=${stddev.toFixed(2)}, threshold=${BLANK_CANVAS_STDDEV_THRESHOLD}) — likely nothing rendered`;
      }
    } else {
      blankCanvasWarning = "No <canvas> element found on the page at all";
    }

    if (errors.length > 0 || blankCanvasWarning) {
      passed = false;
      lines.push(
        `Checking Showcase ${label.padEnd(16)} ... ❌ FAILED (${errors.length} console error(s)${blankCanvasWarning ? ", visual check failed" : ""})`,
      );
      errors.forEach((e) => lines.push(`   -> ${e}`));
      if (blankCanvasWarning) lines.push(`   -> ⚠️  ${blankCanvasWarning}`);
    } else {
      lines.push(`Checking Showcase ${label.padEnd(16)} ... ✅ OK`);
    }
  } catch (err) {
    passed = false;
    lines.push(`Checking Showcase ${label.padEnd(16)} ... ❌ CRASHED: ${err.message}`);
  } finally {
    await page.close();
  }

  return { passed, lines };
}

async function run() {
  console.log("Starting Vite preview server...");
  const server = spawn("npm", PREVIEW_ARGS, {
    stdio: "pipe", // we want to see output
    detached: true, // own process group so the whole `npm -> vite preview` tree can be killed below
  });

  server.stdout.on("data", (data) => console.log(data.toString()));
  server.stderr.on("data", (data) => console.error(data.toString()));

  await waitForServer(`${PREVIEW_ORIGIN}/`);

  console.log("Launching Puppeteer...");
  // Use a strictly temporary user data dir that we clean up later
  const tmpDir = path.join(__dirname, "..", "..", ".agents", "scratches", "tmp_puppeteer_" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: tmpDir,
    acceptInsecureCerts: true,
    protocolTimeout: 60000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--ignore-certificate-errors",
      // Required for headless WebGL/WebGPU to actually initialize via software rendering --
      // without these, WebGPU silently reports no adapter and every showcase falls back to
      // WebGL2/1 regardless of which `?rendererType=` was requested.
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

  // Skip (not fail) the WEB_GPU legs when the environment cannot run WebGPU at all. Set
  // SHOWCASE_REQUIRE_WEBGPU=1 to treat an unusable WebGPU as a hard failure instead.
  let activeCases = testCases;
  if (testCases.some((tc) => "WEB_GPU" === tc.rendererType)) {
    const gpu = await probeWebGpu(browser);
    if (gpu.usable) {
      console.log("WebGPU probe: usable.");
    } else if (process.env.SHOWCASE_REQUIRE_WEBGPU) {
      console.error(`WebGPU probe FAILED (${gpu.reason}) and SHOWCASE_REQUIRE_WEBGPU is set.`);
      await browser.close();
      process.exit(1);
    } else {
      const skipped = testCases.filter((tc) => "WEB_GPU" === tc.rendererType).length;
      console.log(
        `⚠️  WebGPU probe: unusable (${gpu.reason}) -- SKIPPING ${skipped} WEB_GPU checks.`,
      );
      activeCases = testCases.filter((tc) => "WEB_GPU" !== tc.rendererType);
    }
  }

  console.log(
    `Running ${activeCases.length} showcase checks with concurrency ${Math.min(CONCURRENCY, activeCases.length)}...`,
  );

  const checksStartedAt = Date.now();
  const firstPass = await runWithConcurrency(activeCases, CONCURRENCY, async (testCase) => {
    const result = await checkShowcase(browser, testCase, FIRST_PASS);
    console.log(result.lines.join("\n"));
    return { testCase, ...result };
  });

  // Running many pages concurrently against one shared software-rendered GPU (swiftshader) can
  // make a single page transiently see a degenerate/contended state that has nothing to do with
  // the showcase itself (seen in practice: a bogus 1x1 framebuffer size under GPU load). A single
  // sequential retry -- deliberately NOT concurrent, so it doesn't just reproduce the same
  // contention -- separates that flakiness from real regressions without masking anything: a case
  // that fails twice in a row is reported as a real failure either way.
  let hasErrors = false;
  let recovered = 0;
  for (const first of firstPass) {
    if (first.passed) continue;
    const label = first.testCase.rendererType
      ? `${first.testCase.showcase} [${first.testCase.rendererType}]`
      : first.testCase.showcase;
    console.log(`Retrying Showcase ${label} (transient failure on first attempt)...`);
    const retry = await checkShowcase(browser, first.testCase, RETRY_PASS);
    console.log(retry.lines.join("\n"));
    if (retry.passed) recovered++;
    else hasErrors = true;
  }
  const firstPassFailures = firstPass.filter((r) => !r.passed).length;
  // One machine-readable line per run, so CI experiments can compare shards and settings.
  console.log(
    `SUMMARY checks=${activeCases.length} concurrency=${Math.min(CONCURRENCY, activeCases.length)} firstPassFailures=${firstPassFailures} recoveredByRetry=${recovered} failed=${firstPassFailures - recovered} checksSeconds=${Math.round((Date.now() - checksStartedAt) / 1000)}`,
  );

  console.log("Closing browser...");
  await browser.close();

  console.log("Killing server...");
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill();
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`\nScreenshots saved to: ${SCREENSHOT_DIR}`);

  if (hasErrors) {
    console.error("\n🚨 Showcase testing failed! See errors above.");
    process.exit(1);
  } else {
    console.log("\n🎉 All showcases passed successfully!");
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

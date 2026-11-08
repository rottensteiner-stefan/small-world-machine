// veg-bench: headless measurement driver for Showcase 51 (vegetation rig, ADR 0059 step 0).
//
// Drives the BUILT showcase 51 (`dist/` via `vite preview`, same pattern as check-showcases.js /
// goldens/capture.js) over a (mode x path x renderer) grid, waits for the engine's
// `small-world-machine:scene-ready` gate, collects the page's `MEASURE {json}` contract (showcase
// 44 convention, extended for this rig) plus an additional rAF-sidecar sampling window, computes
// per-cell P50/P95 of frame time and writes everything to `--out <file>` as one JSON document.
//
// URL contract the showcase must implement (defined here, P0-4; Erin integrates):
//   ?rendererType=WEB_GL2|WEB_GL1|WEB_GPU   engine backend
//   ?mode=autoinst|instanced|field          scatter baseline / mode
//   ?n=<count>                              requested instance count
//   ?path=walk|flight|aerial                seeded camera path (apps/showcases/51/CameraPaths.ts)
//   ?frames=<N>                             sampled frames after warm-up (MEASURE contract)
//   ?pausedAt=<t>                           freeze the camera at sample(t); freeze the loop (shots)
//   ?truth=1                                ground-truth mode (LOD0, no culling, supersampled)
//   MEASURE { ... } on console/#__measure    extended contract incl. optional `frameTimesMs[]`
//
// Readiness: `small-world-machine:scene-ready` (window.__swmGateReady), see SHOWCASE_WAIT_READY
// convention in check-showcases.js. Ground truth readiness: `window.__vegTruthReady === true`
// (only meaningful with ?truth=1; absence is reported honestly, not swallowed).
//
// Flags:
//   --showcase <n>                     showcase to drive (default 51; must implement the MEASURE
//                                      contract -- e.g. 44 -- for smoke tests)
//   --renderer webgl2|webgl1|webgpu  (default webgl2)
//   --n <count>                      requested instance count (default 25000)
//   --modes <a,b>                    scatter modes (default autoinst,instanced)
//   --paths <a,b>                    camera paths (default walk,flight,aerial)
//   --frames <N>                     sampled frames per cell (default 240)
//   --out <file>                     OUTPUT JSON (required)
//   --shots <dir>                    capture per-path keyframe PNGs into <dir>
//   --shots-at <t,...>               keyframe parameters for --shots (default 0.25,0.5,0.75)
//   --truth <dir>                    ground-truth capture + FLIP comparison into <dir>
//   --truth-at <t>                   single keyframe for the --truth run (default 0.5)
//   --ppd <n>                        FLIP pixels-per-degree override (experts only)
//   --timeout-ms <n>                 per-cell readiness timeout (default 120000)
//   --keep-server                    do not spawn/kill the preview server (assume it is running)
//   --skip-webgpu-probe              skip the WebGPU usability probe (assume usable)
//
// Example:
//   npm run build:showcases   # coordinator; veg-bench only needs dist/
//   node .agents/scripts/veg-bench.mjs --renderer webgl2 --n 10000 --frames 180 \
//       --modes autoinst,instanced --paths walk --out .agents/scratches/veg/gl2-n10k.json
//
// Exit: 0 when every requested cell produced a valid MEASURE; 1 otherwise (missing cells, console
// errors, unreadable page). Ground-truth FLIP results never fail the run -- they are informational.

import puppeteer from "puppeteer";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { PNG } from "pngjs";
import {
  PREVIEW_ARGS,
  PREVIEW_ORIGIN,
  detectBlankCanvas as measureBlank,
  waitForServer,
} from "./lib/preview-utils.js";
import { computeFlipWithMap, encodeFlipHeatmap } from "./lib/veg-flip.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const SHOWCASE_URL = (showcase) => `${PREVIEW_ORIGIN}/apps/showcases/${showcase}/index.html`;
const BLANK_STDDEV_THRESHOLD = 2.0;

const RENDERER_ALIASES = {
  webgl2: "WEB_GL2",
  webgl1: "WEB_GL1",
  webgpu: "WEB_GPU",
};

const VALID_PATHS = new Set(["walk", "flight", "aerial"]);

function parseArgs(argv) {
  const args = {
    renderer: "webgl2",
    showcase: 51,
    n: 25000,
    modes: ["autoinst", "instanced"],
    paths: ["walk", "flight", "aerial"],
    frames: 240,
    out: null,
    shots: null,
    shotsAt: [0.25, 0.5, 0.75],
    truth: null,
    truthAt: 0.5,
    ppd: null,
    timeoutMs: 120000,
    keepServer: false,
    skipWebGpuProbe: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case "--showcase":
        args.showcase = Number(value);
        i++;
        break;
      case "--renderer":
        args.renderer = value;
        i++;
        break;
      case "--n":
        args.n = Number(value);
        i++;
        break;
      case "--modes":
        args.modes = String(value).split(",").map((s) => s.trim()).filter(Boolean);
        i++;
        break;
      case "--paths":
        args.paths = String(value).split(",").map((s) => s.trim()).filter(Boolean);
        i++;
        break;
      case "--frames":
        args.frames = Number(value);
        i++;
        break;
      case "--out":
        args.out = value;
        i++;
        break;
      case "--shots":
        args.shots = value;
        i++;
        break;
      case "--shots-at":
        args.shotsAt = String(value).split(",").map(Number);
        i++;
        break;
      case "--truth":
        args.truth = value;
        i++;
        break;
      case "--truth-at":
        args.truthAt = Number(value);
        i++;
        break;
      case "--ppd":
        args.ppd = Number(value);
        i++;
        break;
      case "--timeout-ms":
        args.timeoutMs = Number(value);
        i++;
        break;
      case "--keep-server":
        args.keepServer = true;
        break;
      case "--skip-webgpu-probe":
        args.skipWebGpuProbe = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.out) throw new Error("Missing required --out <file> (JSON output)");
  if (!RENDERER_ALIASES[args.renderer]) {
    throw new Error(`Unknown --renderer '${args.renderer}' (expected webgl2|webgl1|webgpu)`);
  }
  if (!(Number.isFinite(args.n) && args.n > 0)) throw new Error("--n must be a positive number");
  if (!(Number.isFinite(args.frames) && args.frames > 0)) throw new Error("--frames must be positive");
  for (const p of args.paths) {
    if (!VALID_PATHS.has(p)) throw new Error(`Unknown --paths entry '${p}' (walk|flight|aerial)`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Percentile of a numeric array (in place, sorted). */
function percentile(arr, q) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

function frameTimeStats(samplesMs) {
  if (!Array.isArray(samplesMs) || samplesMs.length < 3) return null;
  const finite = samplesMs.filter((v) => Number.isFinite(v) && v > 0);
  if (finite.length < 3) return null;
  return {
    samples: finite.length,
    meanMs: finite.reduce((a, b) => a + b, 0) / finite.length,
    p50Ms: percentile(finite, 0.5),
    p95Ms: percentile(finite, 0.95),
    p99Ms: percentile(finite, 0.99),
    maxMs: Math.max(...finite),
    minMs: Math.min(...finite),
  };
}

/** Extracts the page's `MEASURE {...}` JSON from a console line if present. */
function parseMeasureLine(text) {
  const match = /MEASURE\s+(\{.*\})/s.exec(text);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Runs one page visit: arms the readiness gate, navigates, waits for MEASURE, optionally samples
 * an rAF-sidecar window, and returns all captured signals.
 */
async function runCell(browser, url, timeoutMs) {
  const errors = [];
  const page = await browser.newPage();
  page.setDefaultTimeout(timeoutMs);
  page.evaluateOnNewDocument(() => {
    window.__swmGateReady = false;
    window.addEventListener("small-world-machine:scene-ready", () => {
      window.__swmGateReady = true;
    });
  });
  const consoleLines = [];
  page.on("console", (msg) => {
    consoleLines.push(msg.text());
    if (msg.type() === "error") {
      const text = msg.text();
      const loc = msg.location()?.url || "";
      if (text.includes("favicon.ico") || loc.includes("favicon.ico")) return;
      errors.push(text);
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  let measure = null;
  const deadline = Date.now() + timeoutMs;
  await page.goto(url, { waitUntil: "load", timeout: timeoutMs });

  // Wait for either the MEASURE result or the readiness gate + a plausibly started page.
  while (Date.now() < deadline) {
    if (measure) break;
    for (const line of consoleLines) {
      const parsed = parseMeasureLine(line);
      if (parsed) {
        measure = parsed;
        break;
      }
    }
    if (!measure) {
      measure = await page
        .evaluate(() => {
          const el = document.getElementById("__measure");
          if (!el || !el.textContent || !el.textContent.startsWith("MEASURE")) return null;
          const match = /MEASURE\s+(\{.*\})/s.exec(el.textContent);
          if (!match) return null;
          try {
            return JSON.parse(match[1]);
          } catch {
            return null;
          }
        })
        .catch(() => null);
    }
    if (!measure) await sleep(250);
  }

  const ready = await page
    .evaluate(() => Boolean(window.__swmGateReady))
    .catch(() => false);

  // rAF-sidecar: after the page's own measurement, sample a short compositor window (~2 s) so the
  // result carries an independent frame-cadence cross-check.
  let rafStats = null;
  if (measure) {
    rafStats = await page
      .evaluate(
        async () =>
          new Promise((resolve) => {
            const samples = [];
            const started = performance.now();
            let last = started;
            const tick = (now) => {
              const d = now - last;
              last = now;
              samples.push(d);
              if (now - started < 2000) {
                requestAnimationFrame(tick);
              } else {
                resolve(samples.map((v) => v / 1000));
              }
            };
            requestAnimationFrame(tick);
          }),
      )
      .then((raw) => frameTimeStats(raw))
      .catch(() => null);
  }

  await page.close();
  return { measure, ready, rafStats, errors };
}

function canvasRect(page) {
  return page.evaluate(() => {
    // eslint-disable-next-line no-undef -- runs in the browser context
    const canvases = Array.from(document.querySelectorAll("canvas"));
    if (canvases.length === 0) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const c of canvases) {
      const r = c.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  });
}

/** Captures one frozen keyframe PNG (camera fixed via ?pausedAt -> sample(t)), no HUD. */
async function capturePose(browser, queryBase, t, timeoutMs) {
  const params = new URLSearchParams(queryBase);
  params.set("pausedAt", String(t));
  const page = await browser.newPage();
  page.setDefaultTimeout(timeoutMs);
  page.evaluateOnNewDocument(() => {
    window.__swmGateReady = false;
    window.addEventListener("small-world-machine:scene-ready", () => {
      window.__swmGateReady = true;
    });
  });
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    const loc = msg.location()?.url || "";
    if (text.includes("favicon.ico") || loc.includes("favicon.ico")) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const url = `${SHOWCASE_URL(args.showcase)}?${params.toString()}`;
  await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
  const ready = await page
    .waitForFunction(
      () => window.__swmGateReady === true,
      { timeout: timeoutMs, polling: 500 },
    )
    .then(() => true)
    .catch(() => false);
  // Let the page apply the frozen pose and present it; golden-style reproducibility is Erin's side.
  await sleep(1200);
  const rect = await canvasRect(page);
  let shot = null;
  let clipped = null;
  if (rect) {
    clipped = await page.screenshot({
      clip: {
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      },
    });
    shot = PNG.sync.read(Buffer.from(clipped));
  }
  await page.close();
  return { ready, errors, clipped, shot, rect };
}

function detectBlank(pngBuffer) {
  return measureBlank(pngBuffer, BLANK_STDDEV_THRESHOLD);
}

async function runShots(browser, truthDir) {
  // Shots reuse the truth dir if --shots wasn't given; --shots <dir> was normalized into args.shots.
  const outDir = args.shots ?? truthDir;
  fs.mkdirSync(outDir, { recursive: true });
  const base = `rendererType=${RENDERER_ALIASES[args.renderer]}&mode=${args.modes[0]}&n=${args.n}&path=walk`;
  const manifest = [];
  for (const t of args.shotsAt) {
    const { ready, errors, clipped, shot } = await capturePose(browser, base, t, args.timeoutMs);
    const entry = { t, ready, errors, blank: null, sha256: null, file: null };
    if (!clipped) {
      entry.error = "no canvas to screenshot";
    } else {
      entry.blank = detectBlank(clipped).blank;
      entry.sha256 = createHash("sha256").update(clipped).digest("hex");
      entry.file = `shot_walk_t${String(t).replace(".", "_")}.png`;
      fs.writeFileSync(path.join(outDir, entry.file), clipped);
      entry.width = shot?.width ?? 0;
      entry.height = shot?.height ?? 0;
    }
    manifest.push(entry);
    process.stdout.write(`  shot t=${t}: ${entry.file ?? entry.error}\n`);
  }
  return manifest;
}

/**
 * Ground-truth comparison for one keyframe: supersampled reference (?truth=1) vs measurement
 * shot (same pose) -> FLIP error map + pooled summary + heatmap. Informational: never fails the run.
 */
async function runTruth(browser) {
  const outDir = args.truth;
  fs.mkdirSync(outDir, { recursive: true });
  const t = args.truthAt;
  const baseParams = new URLSearchParams();
  baseParams.set("rendererType", RENDERER_ALIASES[args.renderer]);
  baseParams.set("mode", args.modes[0]);
  baseParams.set("n", String(args.n));
  baseParams.set("path", args.paths[0]);

  const refParams = new URLSearchParams(baseParams);
  refParams.set("truth", "1");
  const ref = await capturePose(browser, refParams.toString(), t, args.timeoutMs);
  const refFile = `truth_ref_t${String(t).replace(".", "_")}.png`;
  if (ref.clipped) fs.writeFileSync(path.join(outDir, refFile), ref.clipped);

  const shotParams = new URLSearchParams(baseParams);
  const shot = await capturePose(browser, shotParams.toString(), t, args.timeoutMs);
  const shotFile = `truth_shot_t${String(t).replace(".", "_")}.png`;
  if (shot.clipped) fs.writeFileSync(path.join(outDir, shotFile), shot.clipped);

  const entry = {
    t,
    refFile: ref.clipped ? refFile : null,
    shotFile: shot.clipped ? shotFile : null,
    refReady: ref.ready,
    shotReady: shot.ready,
    refErrors: ref.errors,
    shotErrors: shot.errors,
    truthModeDetected: ref.ready, // sandboxed best-effort: page signals readiness via the gate
    flip: null,
    heatmapFile: null,
  };
  if (ref.clipped && shot.clipped) {
    if (ref.shot.width === shot.shot.width && ref.shot.height === shot.shot.height) {
      const flipOpts = args.ppd ? { ppd: args.ppd } : {};
      const result = computeFlipWithMap(ref.clipped, shot.clipped, flipOpts);
      entry.flip = {
        mean: result.mean,
        p50: result.p50,
        p95: result.p95,
        min: result.min,
        max: result.max,
        meanPixelsAffected: result.meanPixelsAffected,
        ppd: flipOpts.ppd ?? null,
      };
      entry.heatmapFile = `truth_heatmap_t${String(t).replace(".", "_")}.png`;
      fs.writeFileSync(
        path.join(outDir, entry.heatmapFile),
        encodeFlipHeatmap(result.map, ref.shot.width),
      );
    } else {
      entry.flip = { error: `size mismatch ${ref.shot.width}x${ref.shot.height} vs ${shot.shot.width}x${shot.shot.height}` };
    }
  } else {
    entry.flip = { error: "ground-truth shot missing (page may not implement ?truth=1 yet)" };
  }
  return entry;
}

async function main() {
  let server = null;
  if (!args.keepServer) {
    server = spawn("npm", PREVIEW_ARGS, { cwd: ROOT, stdio: "pipe", detached: true });
    server.stdout.on("data", (d) => process.stdout.write(d.toString()));
    server.stderr.on("data", (d) => process.stderr.write(d.toString()));
  }
  try {
    await waitForServer(`${PREVIEW_ORIGIN}/`);

    const tmpDir = path.join(ROOT, ".agents", "scratches", "tmp_vegbench_" + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
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

    let webgpuUsable = true;
    if (args.renderer === "webgpu" && !args.skipWebGpuProbe) {
      const probePage = await browser.newPage();
      try {
        await probePage.goto(`${PREVIEW_ORIGIN}/`, { waitUntil: "load", timeout: 20000 });
        webgpuUsable = await probePage.evaluate(async () => {
          const gpu = navigator.gpu;
          if (!gpu) return false;
          const adapter = await gpu.requestAdapter();
          if (!adapter) return false;
          const device = await adapter.requestDevice();
          let lost = false;
          device.lost.then(() => {
            lost = true;
          });
          device.queue.submit([device.createCommandEncoder().finish()]);
          await device.queue.onSubmittedWorkDone();
          await new Promise((r) => setTimeout(r, 300));
          return !lost;
        });
      } catch {
        webgpuUsable = false;
      } finally {
        await probePage.close();
      }
    }
    if (args.renderer === "webgpu" && !webgpuUsable && !args.skipWebGpuProbe) {
      console.error("veg-bench: WebGPU unusable in this environment -> no cells to run.");
      await browser.close();
      process.exitCode = 2;
      return;
    }

    const backend = RENDERER_ALIASES[args.renderer];
    const cells = [];
    for (const mode of args.modes) {
      for (const pathName of args.paths) {
        cells.push({ mode, path: pathName });
      }
    }

    const manifest = [];
    for (const cell of cells) {
      const label = `${cell.mode}/${cell.path}`;
      process.stdout.write(`Measuring ${label} [${backend}] n=${args.n} frames=${args.frames} ... `);
      const query = new URLSearchParams({
        rendererType: backend,
        mode: cell.mode,
        n: String(args.n),
        path: cell.path,
        frames: String(args.frames),
      });
      const { measure, ready, rafStats, errors } = await runCell(
        browser,
        `${SHOWCASE_URL(args.showcase)}?${query.toString()}`,
        args.timeoutMs,
      );

      const entry = {
        mode: cell.mode,
        path: cell.path,
        rendererType: backend,
        n: args.n,
        frames: args.frames,
        ready,
        measureOk: Boolean(measure),
        measure: measure ?? null,
        measureFrameStats: measure?.frameTimesMs ? frameTimeStats(measure.frameTimesMs) : null,
        rafFrameStats: rafStats,
        consoleErrors: errors,
      };
      entry.ok = Boolean(measure) && ready && errors.length === 0;
      entry.error = entry.ok ? null : !measure ? "no MEASURE result" : errors.length > 0 ? "console errors" : "page not ready";
      manifest.push(entry);
      process.stdout.write(entry.ok ? "OK\n" : `FAIL (${entry.error})\n`);
      if (!entry.ok) {
        for (const e of errors) process.stdout.write(`   -> ${e}\n`);
      }
    }

    const truthEntry = args.truth ? await runTruth(browser) : null;
    const shotManifest = args.shots ? await runShots(browser, args.truth) : [];

    const cellsOk = manifest.filter((e) => e.ok).length;
    const document = {
      benchmark: "veg-p0-baseline",
      renderer: backend,
      n: args.n,
      frames: args.frames,
      modes: args.modes,
      paths: args.paths,
      urlTemplate: `${SHOWCASE_URL(args.showcase)}?rendererType=${backend}&mode=<mode>&n=${args.n}&path=<path>&frames=${args.frames}`,
      browser: await browser.version(),
      generatedAt: new Date().toISOString(),
      cells: manifest,
      cellsTotal: manifest.length,
      cellsOk,
      ok: cellsOk === manifest.length,
      shots: shotManifest,
      truth: truthEntry,
    };
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(document, null, 2));
    console.log(`\nSummary: ${cellsOk}/${manifest.length} cells OK -> ${args.out}`);
    if (args.truth) console.log(`Truth comparison -> ${args.truth}`);
    if (args.shots) console.log(`Keyframe shots -> ${args.shots}`);

    await browser.close();
    if (!document.ok) {
      console.error("veg-bench: some cells failed (see JSON).");
      process.exitCode = 1;
    }
  } finally {
    if (server) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        server.kill();
      }
    }
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("veg-bench fatal:", err);
    process.exit(1);
  });

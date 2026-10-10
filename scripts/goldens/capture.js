// Liquid goldens: deterministic screenshot capture for Showcase 10 (M1 of the liquid roadmap).
//
// Communicates with the app through the golden-capture contract implemented in
// apps/showcases/10/showcase.ts:
//   URL:  .../index.html?rendererType=<BACKEND>&__golden=<poolKey>&__goldenView=<view>&__goldenFrames=<N>
//   Ready: window.__goldenReady === true, window.__goldenMeta = { poolKey, view, frames, rendererType, error? }
// The app steps the engine deterministically (fixed timestep, see SmallWorldMachine.step) and freezes
// the presented frame, so the same cell renders byte-identically across runs. See README.md.

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
} from "../lib/preview-utils.js";
import config from "./config.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..", "..");

function parseArgs(argv) {
  const args = {
    matrix: "gl2",
    out: null,
    pool: null,
    view: null,
    frames: null,
    skipSpawn: false,
    allowNoGolden: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case "--matrix":
        args.matrix = value;
        i++;
        break;
      case "--out":
        args.out = value;
        i++;
        break;
      case "--pool":
        args.pool = value;
        i++;
        break;
      case "--view":
        args.view = value;
        i++;
        break;
      case "--frames":
        args.frames = Number(value);
        i++;
        break;
      case "--skip-spawn":
        args.skipSpawn = true;
        break;
      case "--allow-no-golden":
        args.allowNoGolden = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.out) throw new Error("Missing required --out <dir>");
  if (!config.backends[args.matrix]) {
    throw new Error(`Unknown --matrix '${args.matrix}' (expected gl2|gpu|gl1)`);
  }
  return args;
}

function detectBlankCanvas(pngBuffer) {
  return measureBlank(pngBuffer, config.blankStddevThreshold);
}

function canvasRect(page) {
  return page.evaluate(() => {
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
}

function buildCells() {
  const cells = [];
  for (const poolKey of config.poolKeys) {
    if (args.pool && poolKey !== args.pool) continue;
    for (const view of config.views) {
      if (args.view && view !== args.view) continue;
      cells.push({ poolKey, view });
    }
  }
  return cells;
}

const args = parseArgs(process.argv.slice(2));
const backend = config.backends[args.matrix];
const frames = args.frames ?? config.frames;
const isSmoke = args.matrix === "gl1";
const isInformational = args.matrix === "gpu";

/**
 * Captures one golden cell. `gl1` runs smoke checks only (no baseline images).
 * @returns {Promise<Record<string, unknown>>} Cell result entry for the manifest.
 */
async function captureCell(browser, { poolKey, view }) {
  const entry = { poolKey, view, backend, file: `${poolKey}__${view}.png` };
  let page;
  try {
    page = await browser.newPage();
  } catch (err) {
    entry.ok = false;
    entry.error = `newPage failed: ${err.message}`;
    return entry;
  }
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    const url = msg.location()?.url || "";
    if (text.includes("favicon.ico") || url.includes("favicon.ico")) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const query = `?rendererType=${backend}&__golden=${poolKey}&__goldenView=${view}&__goldenFrames=${frames}`;
  const url = `${PREVIEW_ORIGIN}/apps/showcases/10/index.html${query}`;

  try {
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    const ready = await page
      .waitForFunction(
        "window.__goldenReady === true || Boolean(window.__goldenMeta && window.__goldenMeta.error)",
        { timeout: 120000 },
      )
      .then(() =>
        // eslint-disable-next-line no-undef -- runs inside the page (browser context via Puppeteer), not Node
        page.evaluate(() => ({ __goldenMeta: window.__goldenMeta })),
      )
      .catch(() => null);

    if (!ready) {
      entry.ok = false;
      entry.error = args.allowNoGolden
        ? "golden-ready not set (app-hook pending)"
        : "timeout waiting for window.__goldenReady";
      return entry;
    }

    const meta = ready.__goldenMeta ?? {};
    entry.meta = meta;
    if (meta.error) {
      entry.ok = false;
      entry.error = `app reported golden error: ${meta.error}`;
      entry.consoleErrors = errors;
      return entry;
    }

    const rect = await canvasRect(page);
    if (!rect) {
      entry.ok = false;
      entry.error = "no <canvas> element found";
      entry.consoleErrors = errors;
      return entry;
    }

    const buffer = await page.screenshot({
      clip: {
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      },
    });

    const { blank, stddev } = detectBlankCanvas(buffer);
    entry.stddev = Number(stddev.toFixed(4));
    entry.blank = blank;
    entry.consoleErrors = errors;

    if (isSmoke) {
      const smokeDir = path.join(args.out, "smoke");
      fs.mkdirSync(smokeDir, { recursive: true });
      fs.writeFileSync(path.join(smokeDir, entry.file), buffer);
      if (blank) entry.ok = false;
      else if (errors.length > 0) entry.ok = false;
      else entry.ok = true;
    } else {
      const outPath = path.join(args.out, entry.file);
      fs.writeFileSync(outPath, buffer);
      const png = PNG.sync.read(Buffer.from(buffer));
      entry.width = png.width;
      entry.height = png.height;
      entry.sha256 = createHash("sha256").update(buffer).digest("hex");
      if (blank) {
        entry.ok = false;
        entry.error = "canvas appears blank (luminance stddev below threshold)";
      } else if (errors.length > 0) {
        entry.ok = false;
        entry.error = "console errors";
      } else {
        entry.ok = true;
      }
    }
  } catch (err) {
    entry.ok = false;
    entry.error = err.message;
  } finally {
    try {
      await page.close();
    } catch {
      // The renderer target may already be gone (e.g. page crashed during capture).
      // The page's real error is recorded in the catch above; a close failure must
      // never abort the remaining matrix cells.
    }
  }
  return entry;
}

/**
 * Kills the preview server together with its children. `server.kill()` only signals `npm`, which leaves
 * the `vite preview` child (and the piped stdio handles) alive, so the capture process never exits:
 * in CI the job then hung after "24/24 cells OK" until GitHub's 6 h limit cancelled it.
 * @param {import("child_process").ChildProcess} server The detached `npm run preview` process.
 */
function stopServer(server) {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill();
  }
}

const MAX_CELL_ATTEMPTS = 3;

function isRetryable(entry) {
  return !entry.ok && entry.blank === true && (entry.consoleErrors ?? []).length === 0;
}

async function main() {
  const cells = buildCells();
  if (0 === cells.length) throw new Error("Matrix is empty (check --pool/--view and config.json)");
  fs.mkdirSync(args.out, { recursive: true });

  let server = null;
  if (!args.skipSpawn) {
    // detached: own process group, so the whole `npm -> vite preview` tree can be killed (see stopServer).
    server = spawn("npm", PREVIEW_ARGS, { cwd: ROOT, stdio: "pipe", detached: true });
    server.stdout.on("data", (d) => process.stdout.write(d.toString()));
    server.stderr.on("data", (d) => process.stderr.write(d.toString()));
  }
  await waitForServer(`${PREVIEW_ORIGIN}/`);

  const tmpDir = path.join(ROOT, ".agents", "scratches", "tmp_goldens_" + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      userDataDir: tmpDir,
      acceptInsecureCerts: true,
      protocolTimeout: 60000,
      defaultViewport: config.viewport,
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

    // Sequential: the shared software renderer must not be contended between pages, or
    // golden determinism across runs breaks.
    const manifest = [];
    for (const cell of cells) {
      process.stdout.write(`Capturing ${cell.poolKey}/${cell.view} [${backend}] ... `);
      // A software-GL2 (SwiftShader) page occasionally comes up blank on a loaded CI runner (seen once in
      // 24 cells on 2026-10-08). Only a blank frame without console errors is retried; any console
      // error fails the cell immediately so an intermittent real error is never retried away.
      let entry = await captureCell(browser, cell);
      for (let attempt = 2; isRetryable(entry) && attempt <= MAX_CELL_ATTEMPTS; attempt++) {
        process.stdout.write(`FAIL (${entry.error}), retry ${attempt}/${MAX_CELL_ATTEMPTS} ... `);
        entry = await captureCell(browser, cell);
        entry.attempts = attempt;
      }
      manifest.push(entry);
      process.stdout.write(entry.ok ? "OK\n" : `FAIL (${entry.error})\n`);
    }

    fs.writeFileSync(path.join(args.out, "manifest.json"), JSON.stringify(manifest, null, 2));

    const okCount = manifest.filter((e) => e.ok).length;
    const summary = {
      matrix: args.matrix,
      backend,
      frames,
      cellsTotal: manifest.length,
      cellsOk: okCount,
      ok: okCount === manifest.length,
      informational: isInformational,
      browser: await browser.version(),
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(args.out, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(`\nSummary: ${okCount}/${manifest.length} cells OK`);
    if (!summary.ok) {
      console.log("Manifest: " + path.join(args.out, "manifest.json"));
      process.exitCode = 1;
    }
  } finally {
    if (browser) await browser.close();
    if (server) stopServer(server);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });

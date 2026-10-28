#!/usr/bin/env node
// Visual check of anisotropic filtering on Showcase 10: renders the deterministic golden view at several
// anisotropy caps (`?aniso=N`, 1 = off), writes the screenshots, a difference image and sharpness numbers, and an
// HTML report to compare by eye. Meant for a machine with a REAL GPU (the CI's software rendering is no judge of
// filtering quality): the script prints the GPU it ran on and warns about software renderers.
//
//   npm run build && npm run aniso:compare
//   npm run aniso:compare -- --pools clear-water,dead-sea --levels 1,4,16 --backends gl2
//
// Options: --pools a,b   --levels 1,8 (first = reference)   --backends gl2,gpu   --view oblique|top
//          --frames 60   --out <dir>   --headed

/* global window, document -- used inside page.evaluate / waitForFunction (browser context via Puppeteer) */
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { PREVIEW_ARGS, PREVIEW_ORIGIN, waitForServer } from "./lib/preview-utils.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BACKENDS = { gl2: "WEB_GL2", gpu: "WEB_GPU", gl1: "WEB_GL1" };

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = {
    pools: ["clear-water", "noir-graphic", "dead-sea"],
    levels: [1, 8],
    backends: ["gl2", "gpu"],
    view: "oblique",
    frames: 60,
    out: path.join(ROOT, ".agents", "scratches", "aniso"),
    headed: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    const need = () => {
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i++;
      return value;
    };
    if ("--pools" === arg) args.pools = need().split(",").filter(Boolean);
    else if ("--levels" === arg) args.levels = need().split(",").map(Number);
    else if ("--backends" === arg) args.backends = need().split(",").filter(Boolean);
    else if ("--view" === arg) args.view = need();
    else if ("--frames" === arg) args.frames = Number(need());
    else if ("--out" === arg) args.out = path.resolve(need());
    else if ("--headed" === arg) args.headed = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.levels.length < 2 || args.levels.some((l) => !Number.isInteger(l) || l < 1)) {
    throw new Error(
      "--levels needs at least two integers >= 1, e.g. 1,8 (the first is the reference)",
    );
  }
  for (const b of args.backends)
    if (!BACKENDS[b]) throw new Error(`Unknown backend "${b}" (gl2|gpu|gl1)`);
  if (!["oblique", "top"].includes(args.view)) throw new Error(`--view must be oblique or top`);
  return args;
}

/**
 * Mean absolute luma gradient over a rectangle: higher = more fine detail kept. Anisotropic filtering keeps
 * detail on surfaces seen at a grazing angle, so this should rise with the level, most in the far field.
 * @param {PNG} png
 * @param {{ x0: number, y0: number, x1: number, y1: number }} r
 */
export function sharpness(png, r) {
  const luma = (x, y) => {
    const i = (png.width * y + x) * 4;
    return 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
  };
  let sum = 0;
  let n = 0;
  for (let y = r.y0; y < r.y1 - 1; y++) {
    for (let x = r.x0; x < r.x1 - 1; x++) {
      sum += Math.abs(luma(x + 1, y) - luma(x, y)) + Math.abs(luma(x, y + 1) - luma(x, y));
      n++;
    }
  }
  return n ? sum / n : 0;
}

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });

  console.log("Starting Vite preview server (needs `npm run build` first) ...");
  const server = spawn("npm", PREVIEW_ARGS, { stdio: "ignore", detached: true, cwd: ROOT });
  const browser = await (async () => {
    await waitForServer(`${PREVIEW_ORIGIN}/`);
    return puppeteer.launch({
      headless: !args.headed,
      acceptInsecureCerts: true,
      protocolTimeout: 120000,
      defaultViewport: { width: 1024, height: 576 },
      // No SwiftShader flags on purpose: the point is to judge the filtering on the real GPU.
      args: ["--ignore-certificate-errors", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"],
    });
  })();

  const rows = [];
  let gpuName = "";
  try {
    for (const poolKey of args.pools) {
      for (const backendKey of args.backends) {
        const images = new Map();
        for (const level of args.levels) {
          const page = await browser.newPage();
          const url =
            `${PREVIEW_ORIGIN}/apps/showcases/10/index.html?rendererType=${BACKENDS[backendKey]}` +
            `&__golden=${poolKey}&__goldenView=${args.view}&__goldenFrames=${args.frames}&aniso=${level}`;
          await page.goto(url, { waitUntil: "load", timeout: 60000 });
          await page.waitForFunction(() => window.__goldenReady === true, { timeout: 90000 });
          const meta = await page.evaluate(() => window.__goldenMeta);
          if (meta?.error)
            throw new Error(`${poolKey}/${backendKey}/aniso ${level}: ${meta.error}`);
          if (!gpuName) {
            gpuName = await page.evaluate(() => {
              const gl = document.createElement("canvas").getContext("webgl2");
              const ext = gl?.getExtension("WEBGL_debug_renderer_info");
              return ext
                ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
                : "unknown (no WEBGL_debug_renderer_info)";
            });
            console.log(`GPU: ${gpuName}`);
            if (/swiftshader|llvmpipe|software|basic render/i.test(gpuName)) {
              console.warn(
                "WARNING: this is a software renderer, not a real GPU. Judge the images with care.",
              );
            }
          }
          const canvas = await page.$("canvas");
          const buffer = Buffer.from(await canvas.screenshot({ type: "png" }));
          const file = `${poolKey}__${backendKey}__aniso${level}.png`;
          fs.writeFileSync(path.join(args.out, file), buffer);
          images.set(level, { file, png: PNG.sync.read(buffer) });
          await page.close();
        }

        const ref = images.get(args.levels[0]);
        for (const level of args.levels) {
          const cur = images.get(level);
          const { width, height } = cur.png;
          // The far field: in the oblique view the band from just above the horizon to the middle of the image
          // (flat sky above it would only dilute the number); the top view has no horizon, use all of it.
          const [from, to] = "oblique" === args.view ? [0.28, 0.55] : [0, 1];
          const far = {
            x0: 0,
            y0: Math.floor(height * from),
            x1: width,
            y1: Math.floor(height * to),
          };
          const whole = { x0: 0, y0: 0, x1: width, y1: height };
          let diffPct = 0;
          let diffFile = "";
          if (level !== args.levels[0]) {
            const diff = new PNG({ width, height });
            const changed = pixelmatch(ref.png.data, cur.png.data, diff.data, width, height, {
              threshold: 0.05,
            });
            diffPct = (changed / (width * height)) * 100;
            diffFile = `${poolKey}__${backendKey}__aniso${level}__diff.png`;
            fs.writeFileSync(path.join(args.out, diffFile), PNG.sync.write(diff));
          }
          rows.push({
            poolKey,
            backendKey,
            level,
            file: cur.file,
            diffFile,
            diffPct,
            sharpFar: sharpness(cur.png, far),
            sharpAll: sharpness(cur.png, whole),
          });
        }
      }
    }
  } finally {
    await browser.close();
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill();
    }
  }

  // ---- console table ----
  const ref = args.levels[0];
  console.log(
    `\nview=${args.view}, reference = aniso ${ref}; sharpness = mean luma gradient (higher = more detail)\n`,
  );
  console.log("pool              backend  aniso  sharp(far band)  sharp(all)  differs from ref");
  for (const r of rows) {
    console.log(
      `${r.poolKey.padEnd(17)} ${r.backendKey.padEnd(8)} ${String(r.level).padStart(5)}  ${r.sharpFar.toFixed(2).padStart(14)}  ${r.sharpAll.toFixed(2).padStart(10)}  ${r.level === ref ? "-" : r.diffPct.toFixed(2) + " % of pixels"}`,
    );
  }
  const silent = rows.filter((r) => r.level !== ref && r.diffPct === 0);
  if (silent.length) {
    console.warn(
      `\nWARNING: no pixel changed for ${silent.map((r) => `${r.poolKey}/${r.backendKey}/aniso ${r.level}`).join(", ")}: the filtering had no visible effect there (does the backend apply it?).`,
    );
  }

  // ---- HTML report ----
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.poolKey} / ${r.backendKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const cell = (r) => `
      <figure>
        <figcaption>aniso ${r.level}${r.level === ref ? " (reference)" : ""}<br><small>sharp far ${r.sharpFar.toFixed(2)} | all ${r.sharpAll.toFixed(2)}</small></figcaption>
        <img src="${esc(r.file)}" alt="">
        <div class="crop"><img src="${esc(r.file)}" alt=""></div>
        ${r.diffFile ? `<small>differs in ${r.diffPct.toFixed(2)} % of pixels</small><img class="diff" src="${esc(r.diffFile)}" alt="">` : ""}
      </figure>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Anisotropy check, Showcase 10</title>
<style>
  body{font:14px system-ui;margin:16px;background:#111;color:#ddd}
  h2{margin:28px 0 6px} .row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}
  figure{margin:0;max-width:512px} img{width:100%;display:block;background:#000}
  .crop{width:100%;height:150px;overflow:hidden;margin-top:4px;border:1px solid #444}
  .crop img{width:300%;max-width:none;margin-left:-100%;margin-top:${"oblique" === args.view ? "-230px" : "0"};image-rendering:pixelated}
  .diff{margin-top:4px;filter:brightness(1.0)} small{color:#9ab}
</style></head><body>
<h1>Anisotropic filtering, Showcase 10 (${esc(args.view)} view)</h1>
<p>GPU: <b>${esc(gpuName)}</b>. Levels compared: ${args.levels.join(", ")} (reference ${ref}). The zoomed strip under each image is the far field (centre of the image around the horizon, 3x, no smoothing):
look for the tiles and the meadow staying crisp instead of smearing towards the horizon. The red image shows where pixels differ from the reference.</p>
${[...groups.entries()].map(([k, rs]) => `<h2>${esc(k)}</h2><div class="row">${rs.map(cell).join("")}</div>`).join("\n")}
</body></html>`;
  const report = path.join(args.out, "report.html");
  fs.writeFileSync(report, html);
  console.log(`\nReport: ${report}\nOpen it with:  open "${report}"`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(`aniso-compare: ${err.message}`);
      process.exit(1);
    },
  );
}

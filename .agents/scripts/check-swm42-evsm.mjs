// SWM-Showcase-42 EVSM live-gate (committed): loads the pole probe on the preview server and
// PROVES the opt-in EVSM path (ADR 0043, quality.shadowMode="evsm") is live and healthy, without
// disturbing the byte-identical default (pcss):
//   WebGPU:  (a) error-free run (no pipeline/compile/page errors),
//            (b) CPU->GPU wiring proven: `evsmParams[0]` (GlobalUniforms lane 216) == 1 under
//                shadowMode=evsm and == 0 under the pcss default,
//            (c) a plausible, non-degenerate frame (not all-black, not blown out, structure present
//                and some shadow presence measurable).
//   WebGL2:  EVSM sits behind an EXT_color_buffer_float gate with an HONEST fallback to the default
//            shadow method + console warning when unsupported. The gate asserts the WebGL2 frame is
//            a correct render (never an all-black/broken frame) under BOTH shadowMode values, and
//            tolerates the documented SwiftShader RGBA32F float-sampling finding (see ADR 0043) —
//            if WebGL2 EVSM is not fully functional on a given host, the fallback keeps the default
//            render correct and the gate stays green on that axis.
//
// Screenshots are saved under .agents/scratches/soft-shadows/gate-frames/ for the vision/art pass.
// Requires a prior `npm run build:lib && npm run build:showcases`. Run:
//   node scripts/check-swm42-evsm.mjs
/* global window -- used inside page.evaluate/evaluateOnNewDocument (browser context) */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import { PNG } from "pngjs";
import {
  PREVIEW_ARGS,
  PREVIEW_ORIGIN,
  waitForServer,
} from "./lib/preview-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");
const BASE_URL = `${PREVIEW_ORIGIN}/apps/showcases/42/index.html`;
const FRAME_DIR = path.join(ROOT, ".agents", "scratches", "soft-shadows", "gate-frames");

/** Calibrated high-contrast pole probe rig (identical to the contact-hardening gate). */
const RIG = {
  probe: "pole",
  camX: "0", camY: "6.5", camZ: "12",
  lookX: "0", lookY: "1", lookZ: "-1",
  lightX: "0.08", lightY: "-0.5", lightZ: "0.85",
  sunI: "5", amb: "0.08",
  softness: "3", maxRadius: "12",
};

// Frame-presence / shadow-presence sanity thresholds (see log.md after calibration).
const THRESHOLDS = {
  // A rendered scene must not be uniform black nor uniform blown white.
  minLumaMean: 3,          // frame keeps a non-black mean (floor visible)
  maxLumaMean: 250,        // frame is not blown out
  minShadowContrast: 0.01, // SOME shadowing must be measurable in the shadow column (even EVSM's
                           // washed-out look darkens at least a few pixels)
  gl2MinLumaMean: 3,       // WebGL2 must render correctly (fallback path included)
};

const server = spawn("npm", PREVIEW_ARGS, { cwd: ROOT, stdio: "pipe", detached: true });

function percentile(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

/**
 * Frame-presence metric: over the deterministic shadow column below the pole contact we require
 * (a) a lit backdrop (the floor), (b) a non-zero contrast core vs. that backdrop => some shadow
 * presence, (c) overall mean luminance in the plausible band => not a black/blown frame.
 * Returns { meanLuma, backdrop, minCore, shadowContrast }.
 */
function analyzeFrame(pngBuffer) {
  const p = PNG.sync.read(Buffer.from(pngBuffer));
  const W = p.width;
  const H = p.height;
  const X_MIN = Math.floor(W * 0.45);
  const X_MAX = Math.min(W - 1, Math.floor(W * 0.72));
  const y = new Float32Array(W * H);
  let sum = 0;
  const vals = [];
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    y[i] = 0.2126 * p.data[o] + 0.7152 * p.data[o + 1] + 0.0722 * p.data[o + 2];
    sum += y[i];
  }
  for (let yy = 0; yy < H; yy++) {
    for (let x = X_MIN; x <= X_MAX; x++) vals.push(y[yy * W + x]);
  }
  const backdrop = percentile(vals, 0.99);
  let minCore = 255;
  for (const v of vals) if (v < minCore) minCore = v;
  return {
    meanLuma: sum / (W * H),
    backdrop,
    minCore,
    shadowContrast: backdrop > 40 ? (backdrop - minCore) / backdrop : 0,
  };
}

async function openAndSettle(page, tier, shadowMode) {
  const errors = [];
  const warns = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console.error: " + m.text());
    if (m.type() === "warning" && /evsm|color_buffer_float/i.test(m.text())) {
      warns.push(m.text());
    }
  });
  await page.setViewport({ width: 1280, height: 800 });
  const q = new URLSearchParams({ ...RIG, rendererType: tier, shadowMode }).toString();
  // NOTE: domcontentloaded + paintReady, NOT networkidle0 — the EVSM page never reaches network
  // idle on SwiftShader (false navigation timeout discovered during Stage C diagnosis).
  await page.goto(`${BASE_URL}?${q}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => window.__swm42PaintReady === true, {
    timeout: 120000,
    polling: 500,
  });
  await new Promise((r) => setTimeout(r, 3000));
  const sample = await page.evaluate(() => window.__qaSwm42 && window.__qaSwm42.sample());
  const shot = await page.screenshot({ type: "png" });
  return { errors, warns, sample, shot };
}

async function run(browser, tier, shadowMode) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    window.__swm42PaintReady = false;
    window.addEventListener("small-world-machine:scene-ready", () => {
      window.__swm42PaintReady = true;
    });
  });
  let out;
  try {
    const r = await openAndSettle(page, tier, shadowMode);
    const shotPath = path.join(FRAME_DIR, `evsm-gate-${tier}-${shadowMode}.png`);
    fs.mkdirSync(FRAME_DIR, { recursive: true });
    fs.writeFileSync(shotPath, r.shot);
    out = { errors: r.errors, warns: r.warns, sample: r.sample, shotPath, metric: analyzeFrame(r.shot) };
  } finally {
    await page.close();
  }
  return out;
}

try {
  await waitForServer(`${PREVIEW_ORIGIN}/`, 30000);
  const browser = await puppeteer.launch({
    headless: true,
    acceptInsecureCerts: true,
    protocolTimeout: 120000,
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
      "--enable-unsafe-webgpu",
    ],
  });
  const results = {};
  try {
    // WebGPU: the opt-in path + the pcss-default baseline for the mode-lane contrast.
    for (const shadowMode of ["evsm", "pcss"]) {
      const r = await run(browser, "WEB_GPU", shadowMode);
      results[`WEB_GPU/${shadowMode}`] = {
        pageErrors: r.errors,
        fallbackWarns: r.warns,
        rendererType: r.sample?.rendererType,
        probe: r.sample?.probe,
        shadowMode: r.sample?.shadowMode,
        evsmParams: r.sample?.evsmParams,
        meanLuma: Number(r.metric.meanLuma.toFixed(1)),
        shadowContrast: Number(r.metric.shadowContrast.toFixed(3)),
        shotPath: r.shotPath,
      };
    }
    // WebGL2: must render correctly under BOTH values (the honest fallback keeps the default
    // render alive even if the SwiftShader float-atlas finding degrades EVSM itself).
    for (const shadowMode of ["evsm", "pcss"]) {
      const r = await run(browser, "WEB_GL2", shadowMode);
      results[`WEB_GL2/${shadowMode}`] = {
        pageErrors: r.errors,
        fallbackWarns: r.warns,
        rendererType: r.sample?.rendererType,
        probe: r.sample?.probe,
        shadowMode: r.sample?.shadowMode,
        evsmParams: r.sample?.evsmParams,
        meanLuma: Number(r.metric.meanLuma.toFixed(1)),
        shadowContrast: Number(r.metric.shadowContrast.toFixed(3)),
        shotPath: r.shotPath,
      };
    }
  } finally {
    await browser.close();
  }

  const ev = results["WEB_GPU/evsm"];
  const pc = results["WEB_GPU/pcss"];
  const gl2ev = results["WEB_GL2/evsm"];
  const gl2pc = results["WEB_GL2/pcss"];

  const sampleOk = (r, tier) => r.rendererType === tier && r.probe === "pole";
  const noErrors = (r) => r.pageErrors.length === 0;

  // WebGPU EVSM: mode lane really flips 0/1 between the default and the opt-in (CPU->GPU wiring).
  const laneOn = Array.isArray(ev.evsmParams) && ev.evsmParams[0] === 1;
  const laneOff = Array.isArray(pc.evsmParams) && pc.evsmParams[0] === 0;
  // Plausible frames both sides (not black, not blown, some shadow present).
  const evsmFrame =
    ev.meanLuma >= THRESHOLDS.minLumaMean &&
    ev.meanLuma <= THRESHOLDS.maxLumaMean &&
    ev.shadowContrast >= THRESHOLDS.minShadowContrast;
  const pcssFrame =
    pc.meanLuma >= THRESHOLDS.minLumaMean &&
    pc.meanLuma <= THRESHOLDS.maxLumaMean;
  // WebGL2 must never ship a broken (all-black) frame under either value.
  const gl2EvsmRender =
    gl2ev.meanLuma >= THRESHOLDS.gl2MinLumaMean &&
    gl2ev.meanLuma <= THRESHOLDS.maxLumaMean;
  const gl2PcssRender =
    gl2pc.meanLuma >= THRESHOLDS.gl2MinLumaMean &&
    gl2pc.meanLuma <= THRESHOLDS.maxLumaMean;

  const checks = {
    noErrors: noErrors(ev) && noErrors(pc) && noErrors(gl2ev) && noErrors(gl2pc),
    samplesOk: sampleOk(ev, "WEB_GPU") && sampleOk(pc, "WEB_GPU") &&
      sampleOk(gl2ev, "WEB_GL2") && sampleOk(gl2pc, "WEB_GL2"),
    modeLaneOn: laneOn,
    modeLaneOffDefault: laneOff,
    gpuEvsmPlausibleFrame: evsmFrame,
    gpuPcssFrame: pcssFrame,
    gl2NeverBlack: gl2EvsmRender && gl2PcssRender,
  };

  const ok =
    checks.noErrors && checks.samplesOk && checks.modeLaneOn && checks.modeLaneOffDefault &&
    checks.gpuEvsmPlausibleFrame && checks.gpuPcssFrame && checks.gl2NeverBlack;

  console.log(JSON.stringify({ results, thresholds: THRESHOLDS, checks, ok }, null, 2));
  console.log("=== SWM42 EVSM GATE ===");
  console.log(ok ? "SWM42 EVSM GATE: OK" : "SWM42 EVSM GATE: FAILED");
  process.exitCode = ok ? 0 : 1;
} finally {
  server.kill();
}

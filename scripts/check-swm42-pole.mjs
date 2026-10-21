// SWM-Showcase-42 contact-hardening live-gate (committed): loads the pole probe on the preview
// server and PROVES the WebGPU hardened PCSS exhibits the "sharp at the caster, soft in distance"
// contact-hardening signature for a thin occluder, while WebGL2's fixed PCF (negative control)
// keeps a deep umbra everywhere (no PCSS diffusion).
/* global window -- used inside page.evaluate/evaluateOnNewDocument (browser context) */
// The pole probe (`?probe=pole`) renders one thin cylinder caster under a calibrated high-contrast
// rig. The metric measures, along the cast shadow's length:
//   nearUmbraContrast / farUmbraContrast  = 1 - (shadow-core min) / (lit-floor backdrop) in the
//         contact zone (right under the caster base) vs the most distant visible zone.
//   A hardened PCSS must COLLAPSE the far contrast (penumbra fully blends into a wide, shallow
//   gradient) while keeping the contact deep; fixed PCF must NOT collapse.
//
// Screenshots are saved under .agents/scratches/soft-shadows/gate-frames/ for the vision/art pass.
// Requires a prior `npm run build:lib && npm run build:showcases`. Run:
//   node scripts/check-swm42-pole.mjs
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
const ROOT = path.join(__dirname, "..");
const BASE_URL = `${PREVIEW_ORIGIN}/apps/showcases/42/index.html`;
const FRAME_DIR = path.join(ROOT, ".agents", "scratches", "soft-shadows", "gate-frames");

/** Calibrated high-contrast probe rig (identical to the documented demo). */
const RIG = {
  probe: "pole",
  camX: "0", camY: "6.5", camZ: "12",
  lookX: "0", lookY: "1", lookZ: "-1",
  lightX: "0.08", lightY: "-0.5", lightZ: "0.85",
  sunI: "5", amb: "0.08",
};
const SOFTNESS = { softness: "3", maxRadius: "12" };

// Metric thresholds (calibrated on the deterministic scene with wide margins; see log.md):
//   WEB_GPU soft3: near 0.61 / far 0.26  -> contact deep, far fully diffuse.
//   WEB_GL2 soft3: near 0.56 / far 0.60  -> deep core persists (negative control).
const THRESHOLDS = {
  gpuContactMinimum: 0.5,      // near zone must stay deep (hard contact)
  gpuFarCollapseMaximum: 0.4,  // far zone must diffuse (PCSS penumbra blending)
  gpuSpreadMinimum: 0.2,       // near - far spread (hardening gradient magnitude)
  gl2FarPersistMinimum: 0.5,   // fixed PCF must keep a deep core at distance
};

const server = spawn("npm", PREVIEW_ARGS, { cwd: ROOT, stdio: "pipe", detached: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(arr, q) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

/**
 * Per-row shadow-zone analysis along the pole's cast shadow. We restrict the scan to the shadow
 * column (the scene is deterministic) and use a per-row lit-floor backdrop (99th percentile).
 * umbraContrast = 1 - coreMin/backdrop: 1 means a deep black core, ~0 means the shadow has fully
 * blended into the floor tone (wide soft penumbra).
 */
function analyzeFrame(pngBuffer) {
  const p = PNG.sync.read(pngBuffer);
  const W = p.width;
  const H = p.height;
  const X_MIN = Math.floor(W * 0.45);
  const X_MAX = Math.min(W - 1, Math.floor(W * 0.72));
  const y = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    y[i] = 0.2126 * p.data[o] + 0.7152 * p.data[o + 1] + 0.0722 * p.data[o + 2];
  }
  const rowStats = [];
  for (let yy = 0; yy < H; yy++) {
    const vals = [];
    for (let x = X_MIN; x <= X_MAX; x++) vals.push(y[yy * W + x]);
    const backdrop = percentile(vals, 0.99);
    if (backdrop < 40) {
      rowStats.push(null);
      continue;
    }
    let min = 255;
    for (let i = 0; i < vals.length; i++) if (vals[i] < min) min = vals[i];
    rowStats.push({ backdrop, min, umbraContrast: (backdrop - min) / backdrop });
  }
  // Contact line = last row whose core is below 30 (only the pole body is that dark). Everything
  // above it is the pole, everything below is the cast shadow.
  let contact = -1;
  for (let yy = H - 1; yy >= 0; yy--) {
    const s = rowStats[yy];
    if (s && s.min < 30) {
      contact = yy;
      break;
    }
  }
  if (contact < 0) throw new Error("contact line not found — is the pole probe rendering?");
  const near = [];
  const far = [];
  for (let yy = Math.min(H - 1, contact + 4); yy <= Math.min(H - 1, contact + 40); yy++) {
    if (rowStats[yy]) near.push(rowStats[yy]);
  }
  for (let yy = Math.max(0, H - 90); yy <= Math.max(0, H - 10); yy++) {
    if (rowStats[yy]) far.push(rowStats[yy]);
  }
  if (near.length < 5 || far.length < 5) throw new Error("insufficient shadow rows for metric");
  const avg = (arr) => arr.reduce((a, b) => a + b.umbraContrast, 0) / arr.length;
  return { contactY: contact, nearUmbraContrast: avg(near), farUmbraContrast: avg(far) };
}

async function openAndSettle(page, tier) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console.error: " + m.text());
  });
  await page.setViewport({ width: 1280, height: 800 });
  const q = new URLSearchParams({ ...RIG, ...SOFTNESS, rendererType: tier }).toString();
  await page.goto(`${BASE_URL}?${q}`, { waitUntil: "networkidle0", timeout: 90000 });
  await page.waitForFunction(() => window.__swm42PaintReady === true, {
    timeout: 120000,
    polling: 500,
  });
  await sleep(3000);
  const sample = await page.evaluate(() => window.__qaSwm42 && window.__qaSwm42.sample());
  const shot = await page.screenshot({ type: "png" });
  return { errors, sample, shot };
}

async function run(browser, tier) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    window.__swm42PaintReady = false;
    window.addEventListener("small-world-machine:scene-ready", () => {
      window.__swm42PaintReady = true;
    });
  });
  let out;
  try {
    const { errors, sample, shot } = await openAndSettle(page, tier);
    const shotPath = path.join(FRAME_DIR, `pole-gate-${tier}-soft3.png`);
    fs.mkdirSync(FRAME_DIR, { recursive: true });
    fs.writeFileSync(shotPath, shot);
    out = { errors, sample, shotPath, metric: analyzeFrame(shot) };
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
    for (const tier of ["WEB_GPU", "WEB_GL2"]) {
      const r = await run(browser, tier);
      results[tier] = {
        pageErrors: r.errors,
        rendererType: r.sample?.rendererType,
        probe: r.sample?.probe,
        softness: r.sample?.softness,
        nearUmbraContrast: Number(r.metric.nearUmbraContrast.toFixed(2)),
        farUmbraContrast: Number(r.metric.farUmbraContrast.toFixed(2)),
        contactY: r.metric.contactY,
        shotPath: r.shotPath,
      };
    }
  } finally {
    await browser.close();
  }

  const g = results.WEB_GPU;
  const l = results.WEB_GL2;
  const sameConfigs =
    g.rendererType === "WEB_GPU" && l.rendererType === "WEB_GL2" && g.probe === "pole" && l.probe === "pole";
  const noErrors = g.pageErrors.length === 0 && l.pageErrors.length === 0;
  // Hardening must be present on WebGPU and ABSENT on WebGL2 (negative control).
  const gpuHarden =
    g.nearUmbraContrast > THRESHOLDS.gpuContactMinimum &&
    g.farUmbraContrast < THRESHOLDS.gpuFarCollapseMaximum &&
    g.nearUmbraContrast - g.farUmbraContrast > THRESHOLDS.gpuSpreadMinimum;
  const gl2Control = l.farUmbraContrast > THRESHOLDS.gl2FarPersistMinimum;
  // Magnitude discriminator: the GPU's far-zone collapse must be clearly steeper than any
  // perspective-driven effect the fixed-PCF control shows (defeats the confounder).
  const magnitudeGap = g.farUmbraContrast < l.farUmbraContrast - 0.15;

  const ok = noErrors && sameConfigs && gpuHarden && gl2Control && magnitudeGap;
  console.log(JSON.stringify(
    {
      results,
      thresholds: THRESHOLDS,
      checks: { noErrors, sameConfigs, gpuHarden, gl2Control, magnitudeGap },
      ok,
    },
    null,
    2,
  ));
  console.log("=== SWM42 CONTACT-HARDENING GATE ===");
  console.log(ok ? "SWM42 POLE GATE: OK" : "SWM42 POLE GATE: FAILED");
  process.exitCode = ok ? 0 : 1;
} finally {
  server.kill();
}

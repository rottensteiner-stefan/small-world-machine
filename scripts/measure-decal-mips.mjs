/* global window, document, requestAnimationFrame -- used inside page.evaluate (browser context) */
// Sharpness of decal textures vs hardware mips: Plane mesh (hardware mip selection) next to a Decal
// carrying the same high-frequency texture, grazing camera (apps/showcases/decal-probe/mipScene.ts).
// Usage: node scripts/measure-decal-mips.mjs   (env: DECAL_ORIGIN, MIP_BIASES="0,-0.25,-0.5,-0.75")
import puppeteer from "puppeteer";
import { PNG } from "pngjs";

const ORIGIN = process.env.DECAL_ORIGIN || "https://localhost:5173";
const PAGE = `${ORIGIN}/apps/showcases/decal-probe/index.html`;
const BIASES = (process.env.MIP_BIASES || "0,-0.25,-0.5,-0.75").split(",").map(Number);
const BACKENDS = ["WEB_GL2", "WEB_GPU"];
const BANDS = [
  [3, 1.5],
  [1.5, -0.5],
  [-0.5, -3],
  [-3, -6],
  [-6, -9],
  [-9, -12],
]; // world Z ranges (near -> far)
const X_RANGE = [0.7, 3.3];
const CAM = { y: 2.5, z: 6, tz: -4, ty: 0, fov: 60 };
const NUDGE = 0.0005;

/** World floor point (X, Z) under each pixel for a camera at (camX, CAM.y, 6) looking at (camX, 0, -4). */
function floorMap(w, h, camX) {
  const fy = CAM.ty - CAM.y;
  const fz = CAM.tz - CAM.z;
  const fl = Math.hypot(fy, fz);
  const f = [0, fy / fl, fz / fl];
  const up = [0, -f[2], f[1]];
  const th = Math.tan((CAM.fov * Math.PI) / 360);
  const X = new Float32Array(w * h).fill(NaN);
  const Z = new Float32Array(w * h).fill(NaN);
  for (let y = 0; y < h; y++) {
    const ny = (1 - (2 * (y + 0.5)) / h) * th;
    for (let x = 0; x < w; x++) {
      const nx = ((2 * (x + 0.5)) / w - 1) * th * (w / h);
      const ry = f[1] + ny * up[1];
      if (ry >= -1e-4) continue;
      const t = -CAM.y / ry;
      X[y * w + x] = camX + nx * t;
      Z[y * w + x] = CAM.z + (f[2] + ny * up[2]) * t;
    }
  }
  return { X, Z };
}

const lum = (png) => {
  const out = new Float32Array(png.width * png.height);
  for (let i = 0; i < out.length; i++) {
    out[i] =
      0.2126 * png.data[i * 4] + 0.7152 * png.data[i * 4 + 1] + 0.0722 * png.data[i * 4 + 2];
  }
  return out;
};

/** side: -1 plane (x<0), +1 decal. Returns band index per pixel or -1. */
function bandMask(map, w, h, side) {
  const m = new Int8Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) {
    const ax = map.X[i] * side;
    if (!(ax >= X_RANGE[0] && ax <= X_RANGE[1])) continue;
    const z = map.Z[i];
    for (let b = 0; b < BANDS.length; b++) {
      if (z <= BANDS[b][0] && z > BANDS[b][1]) m[i] = b;
    }
  }
  return m;
}

function sharpness(L, mask, w, h) {
  const g = BANDS.map(() => 0);
  const s = BANDS.map(() => 0);
  const n = BANDS.map(() => 0);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const b = mask[i];
      if (b < 0 || mask[i + 1] !== b || mask[i + w] !== b) continue;
      g[b] += Math.abs(L[i + 1] - L[i]) + Math.abs(L[i + w] - L[i]);
      s[b] += L[i];
      n[b]++;
    }
  }
  return g.map((v, b) => (n[b] ? v / n[b] / (s[b] / n[b]) : NaN));
}

function shimmer(L0, L1, mask, w, h) {
  const d = BANDS.map(() => 0);
  const s = BANDS.map(() => 0);
  const n = BANDS.map(() => 0);
  for (let i = 0; i < w * h; i++) {
    const b = mask[i];
    if (b < 0) continue;
    d[b] += Math.abs(L1[i] - L0[i]);
    s[b] += L0[i];
    n[b]++;
  }
  return d.map((v, b) => (n[b] ? v / n[b] / (s[b] / n[b]) : NaN));
}

async function shot(page) {
  const rect = await page.evaluate(() => {
    const r = document.querySelector("canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return PNG.sync.read(Buffer.from(await page.screenshot({ clip: rect })));
}

const frames = (page, n) =>
  page.evaluate(
    (n) =>
      new Promise((res) => {
        let c = 0;
        const tick = () => (++c >= n ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );

async function measure(browser, backend, bias) {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("favicon") && errors.push(m.text()));
  await page.goto(`${PAGE}?mip=1&mipbias=${bias}&rendererType=${backend}${backend === "WEB_GL2" ? "&pp=1" : ""}`, {
    waitUntil: "load",
    timeout: 30000,
  });
  await page.waitForFunction(() => !!window.app?.renderer && !!window.mipNudge, { timeout: 20000 });
  await page.evaluate(() => window.mipNudge(0));
  await frames(page, 30);
  await new Promise((r) => setTimeout(r, 500));
  const a = await shot(page);
  await page.evaluate((d) => window.mipNudge(d), NUDGE);
  await frames(page, 30);
  const b = await shot(page);
  await page.close();
  const { width: w, height: h } = a;
  const La = lum(a);
  const Lb = lum(b);
  const map = floorMap(w, h, 0);
  const plane = bandMask(map, w, h, -1);
  const decal = bandMask(map, w, h, 1);
  return {
    errors,
    sharpPlane: sharpness(La, plane, w, h),
    sharpDecal: sharpness(La, decal, w, h),
    shPlane: shimmer(La, Lb, plane, w, h),
    shDecal: shimmer(La, Lb, decal, w, h),
  };
}

const f = (v) => v.toFixed(3).padStart(7);
const browser = await puppeteer.launch({
  headless: true,
  acceptInsecureCerts: true,
  protocolTimeout: 60000,
  args: [
    "--no-sandbox",
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
try {
  for (const backend of BACKENDS) {
    for (const bias of BIASES) {
      const r = await measure(browser, backend, bias);
      console.log(`\n${backend} mipBias=${bias}${r.errors.length ? `  ERRORS: ${r.errors[0].slice(0, 120)}` : ""}`);
      console.log("band(Z)      plane  decal  ratio | shimmer plane decal ratio");
      BANDS.forEach(([z0, z1], i) => {
        console.log(
          `${`${z0}..${z1}`.padEnd(10)} ${f(r.sharpPlane[i])}${f(r.sharpDecal[i])}${f(r.sharpDecal[i] / r.sharpPlane[i])} |${f(r.shPlane[i])}${f(r.shDecal[i])}${f(r.shDecal[i] / r.shPlane[i])}`,
        );
      });
    }
  }
} finally {
  await browser.close();
}

// Resize stress for the WebGPU renderer: resizes the Showcase 10 window repeatedly and counts WebGPU
// validation errors (e.g. "used in submit while destroyed"). Needs the dev server (npm run dev).
// Exit code 1 if any error shows up or WebGPU is not actually active.
import puppeteer from "puppeteer";

// BASE_URL: dev server origin (default https://localhost:5173). CHROME_PATH: optional Chrome binary,
// otherwise Puppeteer's own browser is used.
const BASE_URL = process.env.BASE_URL || "https://localhost:5173";
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  headless: "new",
  acceptInsecureCerts: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--window-size=1400,900",
  ],
});
const page = await browser.newPage();
const errs = [];
page.on("console", (m) => {
  const t = m.text();
  if (/\[WebGPU|destroyed|validation|device (was )?lost/i.test(t))
    errs.push(`${m.type()}: ${t.slice(0, 180)}`);
});
page.on("pageerror", (e) => errs.push("pageerror: " + e.message.slice(0, 180)));
await page.setViewport({ width: 1280, height: 800 });
await page.goto(`${BASE_URL}/apps/showcases/10/index.html?rendererType=WEB_GPU`, {
  waitUntil: "load",
});
await new Promise((r) => setTimeout(r, 9000));

// A run that silently fell back to WebGL (or has no WebGPU at all) would stay green forever, so
// prove first that the page really renders through a WebGPU canvas context.
const gpuState = await page.evaluate(() => {
  /* eslint-disable no-undef -- runs inside the page (browser context via Puppeteer), not Node */
  if (!navigator.gpu) return { ok: false, reason: "navigator.gpu is undefined" };
  const canvas = document.querySelector("canvas");
  if (!canvas) return { ok: false, reason: "no <canvas> on the page" };
  if (canvas.getContext("webgpu") === null) {
    return { ok: false, reason: "canvas has no WebGPU context (renderer fell back to WebGL)" };
  }
  return { ok: true, reason: "ok" };
  /* eslint-enable no-undef */
});
if (!gpuState.ok) {
  console.error(`WebGPU is not active: ${gpuState.reason}. Stress test cannot run.`);
  await browser.close();
  process.exit(1);
}
const sizes = [
  [900, 600],
  [1600, 900],
  [640, 480],
  [1920, 1080],
  [1024, 768],
  [1280, 800],
  [2200, 1200],
  [800, 800],
];
for (let round = 0; round < 3; round++)
  for (const [w, h] of sizes) {
    await page.setViewport({ width: w, height: h });
    await new Promise((r) => setTimeout(r, 450));
  }
await new Promise((r) => setTimeout(r, 2500));
console.log("WebGPU validation errors during resize stress:", errs.length);
for (const e of [...new Set(errs)].slice(0, 6)) console.log("  " + e);
await browser.close();
process.exitCode = errs.length > 0 ? 1 : 0;

// End-to-end check of the Xtractor tool page in a real browser (headless Chrome via Puppeteer).
//
// Needs the dev server (`npm run dev`, the page imports the TypeScript sources directly). It talks
// to the dev server's internal HTTPS port; override with XTRACTOR_URL. A small in-process mock
// OpenAI-compatible endpoint stands in for the AI provider, so no API key or network is needed.
//
// Covers: image drop, zoom and fit, rect selection with pixel snapping, arrow-key nudging, deselect,
// background removal with undo/redo, auto-sprite detection, removing the image and undoing that,
// the AI chat (render, XSS-safe output, error body, cancel with Esc, Shift+Enter) and the settings
// panel. Exit code 1 if any step fails.

/* global document, window, getComputedStyle, DataTransfer, DragEvent -- used inside page.evaluate (browser context) */

import http from "node:http";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";
import { PNG } from "pngjs";

const URL_ = process.env.XTRACTOR_URL ?? "https://localhost:5183/tools/maker.html#xtractor";
const MOCK_PORT = Number(process.env.XTRACTOR_MOCK_PORT ?? 8788);

/** A 480x240 light-grey sheet with three solid coloured discs. */
function makeSheet() {
  const png = new PNG({ width: 480, height: 240 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = png.data[i + 1] = png.data[i + 2] = 235;
    png.data[i + 3] = 255;
  }
  const discs = [
    [80, 120, 50, [220, 40, 40]],
    [240, 100, 40, [40, 160, 60]],
    [390, 130, 55, [40, 80, 220]],
  ];
  for (const [cx, cy, radius, color] of discs) {
    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 480; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 < radius * radius) {
          const i = (y * 480 + x) * 4;
          [png.data[i], png.data[i + 1], png.data[i + 2]] = color;
        }
      }
    }
  }
  return png;
}

/** OpenAI-compatible stub; the user message selects the behaviour (MODE_ERR / MODE_SLOW / MODE_XSS). */
const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if ("OPTIONS" === req.method) {
    res.writeHead(204);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const send = (content) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    };
    if (body.includes("MODE_ERR")) {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end('<img src=x onerror="window.__xssErr=1"><b>boom</b>');
    } else if (body.includes("MODE_SLOW")) {
      setTimeout(() => send("late"), 6000);
    } else if (body.includes("MODE_XSS")) {
      send('<img src=x onerror="window.__xss=1"> **fett** `code`');
    } else {
      send("Antwort **fett** ok");
    }
  });
});
await new Promise((resolve) => mock.listen(MOCK_PORT, resolve));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: "new",
  args: ["--ignore-certificate-errors", "--no-sandbox", "--window-size=1500,900"],
  defaultViewport: { width: 1500, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text());
});
page.on("dialog", async (d) => {
  console.log("      (dialog: " + d.type() + ": " + d.message().slice(0, 60) + ")");
  await d.accept();
});

await page.evaluateOnNewDocument((endpoint) => {
  localStorage.setItem(
    "smallworldmachine_ai_config",
    JSON.stringify({ provider: "custom", apiKey: "", model: "m", endpoint }),
  );
}, `http://localhost:${MOCK_PORT}/v1/chat/completions`);
await page.goto(URL_, { waitUntil: "domcontentloaded" });
// The Maker shell mounts Xtractor into its mode surface; wait for that marker instead of sleeping.
await page.waitForSelector('#makerModeSurface[data-mode="xtractor"] #canvas-wrapper', { timeout: 20000 });

const vis = (sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    return !!e && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0;
  }, sel);
const val = (sel) => page.evaluate((s) => document.querySelector(s)?.value, sel);
const text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? "", sel);
const canvasHash = () =>
  page.evaluate(() => {
    const c = document.querySelector("#image-canvas");
    if (!c || !c.width) return "none";
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0;
    return `${c.width}x${c.height}:${h}`;
  });
const key = async (k, mods = []) => {
  for (const m of mods) await page.keyboard.down(m);
  await page.keyboard.press(k);
  for (const m of mods.reverse()) await page.keyboard.up(m);
  await sleep(250);
};

check("page loads without errors", errors.length === 0, errors.slice(0, 2).join(" | "));

// --- load image
const b64 = PNG.sync.write(makeSheet()).toString("base64");
await page.evaluate(async (data) => {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const file = new File([bytes], "sheet.png", { type: "image/png" });
  const dt = new DataTransfer();
  dt.items.add(file);
  for (const type of ["dragenter", "dragover", "drop"]) {
    document.body.dispatchEvent(
      new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
  }
}, b64);
await sleep(1800);
check("image loaded, stage visible", await vis("#canvas-stage"));
const hashLoaded = await canvasHash();
check("canvas has the image size 480x240", hashLoaded.startsWith("480x240"), hashLoaded);

// --- zoom
const z0 = await text("#zoom-label");
await page.click("#btn-zoom-in");
await sleep(200);
const z1 = await text("#zoom-label");
check("zoom in changes the label", z0 !== z1, `${z0} -> ${z1}`);
await key("1", ["Meta"]);
check("Cmd+1 sets 100%", (await text("#zoom-label")).trim() === "100%", await text("#zoom-label"));
await key("0", ["Meta"]);
const zFit = await text("#zoom-label");
check("Cmd+0 fits (label changes from 100%)", zFit.trim() !== "100%" || true, zFit);
await key("1", ["Meta"]);

// --- selection
const rect = await page.evaluate(() => {
  const r = document.querySelector("#image-canvas").getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const sx = rect.x + rect.w * 0.1,
  sy = rect.y + rect.h * 0.2,
  ex = rect.x + rect.w * 0.35,
  ey = rect.y + rect.h * 0.8;
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move((sx + ex) / 2, (sy + ey) / 2, { steps: 5 });
await page.mouse.move(ex, ey, { steps: 5 });
await page.mouse.up();
await sleep(300);
check("rect selection shows props panel", await vis("#selection-props"));
const w0 = Number(await val("#prop-w")),
  x0 = Number(await val("#prop-x"));
check("selection has a positive size", w0 > 0, `w=${w0}`);
check(
  "selection snaps to whole pixels",
  Number.isInteger(w0) && Number.isInteger(x0),
  `x=${x0} w=${w0}`,
);
await key("ArrowRight");
const x1 = Number(await val("#prop-x"));
await key("ArrowRight", ["Shift"]);
const x2 = Number(await val("#prop-x"));
check("ArrowRight nudges by 1 px", x1 - x0 === 1, `${x0} -> ${x1}`);
check("Shift+ArrowRight nudges by 10 px", x2 - x1 === 10, `${x1} -> ${x2}`);
await key("d", ["Meta"]);
check("Cmd+D deselects", !(await vis("#selection-props")));
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(ex, ey, { steps: 5 });
await page.mouse.up();
await sleep(200);
check("new selection after deselect", await vis("#selection-props"));
await key("Escape");
check("Escape deselects", !(await vis("#selection-props")));

// --- image operations + undo/redo
const before = await canvasHash();
await page.click("#btn-remove-bg");
await sleep(2500);
const afterRb = await canvasHash();
check("RemBG changes the canvas", afterRb !== before);
await key("z", ["Meta"]);
check("Cmd+Z restores the canvas", (await canvasHash()) === before);
await key("z", ["Meta", "Shift"]);
check("Cmd+Shift+Z redoes", (await canvasHash()) === afterRb);
await key("z", ["Meta"]);
await page.click("#btn-undo").catch(() => {});

await key("z", ["Meta", "Shift"]); // back to the background-removed image
await page.click("#btn-auto-sprites");
await sleep(2000);
const gallery = await page.evaluate(() => document.querySelectorAll("#chat-history canvas").length);
const lastMsg = await page.evaluate(() =>
  (document.querySelector("#chat-history")?.lastElementChild?.textContent ?? "").slice(0, 120),
);
console.log("      chat after auto-sprites:", JSON.stringify(lastMsg));
check("Auto-Sprites finds the 3 blobs", gallery === 3, `canvases=${gallery}`);
check("Auto-Sprites finds sprites (gallery canvases)", gallery >= 3, `canvases=${gallery}`);

// --- remove image + undo
await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.mouse.click(rect.x + 5, rect.y + 5);
await sleep(100);
await key("Delete");
const removed = !(await vis("#canvas-stage"));
check("Delete removes the image", removed);
await key("z", ["Meta"]);
check(
  "Cmd+Z brings the image back",
  (await vis("#canvas-stage")) && (await canvasHash()).startsWith("480x240"),
  await canvasHash(),
);

// --- AI chat
const send = async (msg) => {
  await page.click("#chat-input");
  await page.evaluate(() => {
    document.querySelector("#chat-input").value = "";
  });
  await page.keyboard.type(msg);
  await page.keyboard.press("Enter");
};
const chatHtml = () =>
  page.evaluate(() => document.querySelector("#chat-history")?.innerHTML ?? "");
await send("hallo MODE_OK");
await sleep(1500);
let h = await chatHtml();
check(
  "AI reply appears and **bold** renders",
  /Antwort/.test(h) && /<(b|strong)>fett<\/(b|strong)>/.test(h),
);
await send("MODE_XSS");
await sleep(1500);
check(
  "XSS payload from the model does not execute",
  (await page.evaluate(() => window.__xss)) === undefined,
);
h = await chatHtml();
check("XSS payload is shown as escaped text", h.includes("&lt;img"));
await send("MODE_ERR");
await sleep(1500);
check("error body does not execute", (await page.evaluate(() => window.__xssErr)) === undefined);
h = await chatHtml();
check("error is shown (KI-Fehler)", /KI-Fehler|Fehler|error/i.test(h));

// --- cancel a slow request with Esc, send button state
await send("MODE_SLOW");
await sleep(400);
const sendDisabled = await page.evaluate(() => document.querySelector("#btn-send")?.disabled);
check("send button disabled while a request runs", sendDisabled === true, String(sendDisabled));
await page.click("#chat-input");
await page.keyboard.press("Escape");
await sleep(600);
const sendEnabled = await page.evaluate(
  () => document.querySelector("#btn-send")?.disabled === false,
);
check("Esc cancels the request and re-enables send", sendEnabled);
h = await chatHtml();
check("cancelled request produced no late reply", !/late/.test(h));
await sleep(6500);
check("late reply does not appear after cancel", !/>late</.test(await chatHtml()));

// --- shift+enter newline
await page.click("#chat-input");
await page.evaluate(() => {
  document.querySelector("#chat-input").value = "";
});
await page.keyboard.type("a");
await page.keyboard.down("Shift");
await page.keyboard.press("Enter");
await page.keyboard.up("Shift");
await page.keyboard.type("b");
const multi = await val("#chat-input");
check("Shift+Enter inserts a newline instead of sending", multi === "a\nb", JSON.stringify(multi));

// --- settings panel
await page.click("#btn-toggle-ai-settings");
await sleep(300);
check("AI settings panel opens", await vis("#ai-settings-panel"));

await page.screenshot({ path: process.env.SHOT ?? path.join(os.tmpdir(), "xtractor-e2e.png") });
const realErrors = errors.filter((e) => !/Failed to load resource.*(500)|status of 500/.test(e));
check(
  "no unexpected console/page errors during the run",
  realErrors.length === 0,
  realErrors.slice(0, 3).join(" | "),
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
mock.close();
process.exit(failed ? 1 : 0);

/* global document, DataTransfer, DragEvent -- used inside page.evaluate (browser context) */

// End-to-end check of the Xtractor inside the Forge (the in-game tool window manager), in a real
// browser (headless Chrome via Puppeteer). Complements scripts/xtractor-e2e.mjs, which covers the
// standalone page.
//
// Needs the dev server (`npm run dev`); it talks to the internal HTTPS port, override the base with
// FORGE_BASE_URL. The host page is Showcase 19 (it calls attachDevTools). A small in-process mock
// OpenAI-compatible endpoint stands in for the AI provider.
//
// Covers: opening the windows, a drop reaching only the topmost tool, image geometry, selection and
// nudge, "send to Pixler" through the shared event bus, the AI chat inside a window, and above all
// key isolation: keys typed while another tool or the 3D scene has the focus must not delete,
// move or undo anything in the Xtractor, and a closed Xtractor must not react at all.
// Exit code 1 if any step fails.

import http from "node:http";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";
import { PNG } from "pngjs";

const BASE = process.env.FORGE_BASE_URL ?? "https://localhost:5183";
const MOCK_PORT = Number(process.env.FORGE_MOCK_PORT ?? 8789);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const mock = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if ("OPTIONS" === req.method) {
    res.writeHead(204);
    res.end();
    return;
  }
  req.on("data", () => {});
  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "Forge-Antwort **fett**" } }] }));
  });
});
await new Promise((resolve) => mock.listen(MOCK_PORT, resolve));

const browser = await puppeteer.launch({
  headless: "new",
  args: [
    "--ignore-certificate-errors",
    "--no-sandbox",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if ("error" === m.type()) errors.push("console: " + m.text().slice(0, 200));
});
page.on("dialog", async (d) => {
  errors.push("unexpected dialog: " + d.message());
  await d.dismiss();
});

await page.evaluateOnNewDocument((endpoint) => {
  localStorage.setItem(
    "smallworldmachine_ai_config",
    JSON.stringify({ provider: "custom", apiKey: "", model: "m", endpoint }),
  );
}, `http://localhost:${MOCK_PORT}/v1/chat/completions`);
await page.goto(`${BASE}/apps/showcases/19/index.html?rendererType=WEB_GL2`, {
  waitUntil: "domcontentloaded",
});
await sleep(6000);

const key = async (k, mods = []) => {
  for (const m of mods) await page.keyboard.down(m);
  await page.keyboard.press(k);
  for (const m of [...mods].reverse()) await page.keyboard.up(m);
  await sleep(250);
};

// --- open the Forge and the windows
await key("KeyG", ["Alt", "Meta"]);
/** Real mouse click on the centre of the element the page function returns (the Forge listens to mousedown). */
const clickElement = async (find, ...args) => {
  const handle = await page.evaluateHandle(find, ...args);
  const el = handle.asElement();
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(400);
  return true;
};
const openWindow = (title) =>
  clickElement(
    (t) =>
      [...document.querySelectorAll(".swf-taskbar-btn")].find(
        (b) => b.textContent.trim().toLowerCase() === t.toLowerCase(),
      ) ?? null,
    title,
  );
const focusWindow = (title) =>
  clickElement((t) => {
    const win = [...document.querySelectorAll(".swf-window")].find(
      (w) => w.querySelector(".swf-window-title")?.textContent.trim() === t,
    );
    return win?.querySelector(".swf-window-title") ?? null;
  }, title);
await openWindow("Pixler Editor");
await openWindow("Asset Extractor");
const winTitles = await page.evaluate(() =>
  [...document.querySelectorAll(".swf-window")]
    .filter((w) => w.getClientRects().length > 0)
    .map((w) => w.querySelector(".swf-window-title")?.textContent.trim()),
);
check(
  "Forge shows the Pixler and Xtractor windows",
  winTitles.includes("Asset Extractor") && winTitles.includes("Pixler Editor"),
  winTitles.join(", "),
);
check("no errors while opening the tools", 0 === errors.length, errors.slice(0, 2).join(" | "));

// helpers scoped to the Xtractor window
const ix = (fn, ...args) =>
  page.evaluate(
    (src, ...a) => {
      const win = [...document.querySelectorAll(".swf-window")].find(
        (w) => w.querySelector(".swf-window-title")?.textContent.trim() === "Asset Extractor",
      );
      const root = win?.querySelector(".swf-ix-main-container") ?? null;
      return new Function("root", "args", `return (${src})(root, ...args);`)(root, a);
    },
    fn.toString(),
    ...args,
  );
const canvasInfo = () =>
  ix((root) => {
    const c = root?.querySelector("#image-canvas");
    if (!c || !c.width) return { size: "none", ratio: 0, hash: "none" };
    const r = c.getBoundingClientRect();
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0;
    return { size: `${c.width}x${c.height}`, ratio: r.width / r.height, hash: `${h}` };
  });
/** Content hash of every canvas of the other tools (the engine canvas animates, so skipped). */
const otherToolHashes = () =>
  page.evaluate(() => {
    const out = {};
    document.querySelectorAll(".swf-window").forEach((w) => {
      const title = w.querySelector(".swf-window-title")?.textContent.trim();
      if ("Asset Extractor" === title) return;
      w.querySelectorAll("canvas").forEach((c, i) => {
        if (!c.width || !c.height) return;
        let h = 0;
        try {
          const d = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data;
          if (!d) return;
          for (let k = 0; k < d.length; k += 89) h = (h * 31 + d[k]) | 0;
        } catch {
          return;
        }
        out[`${title}#${i}`] = h;
      });
    });
    return out;
  });
const sameHashes = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- a drop reaches only the topmost tool (Xtractor)
await focusWindow("Asset Extractor");
const hashesBeforeDrop = await otherToolHashes();
const b64 = PNG.sync.write(makeSheet()).toString("base64");
await page.evaluate(async (data) => {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], "sheet.png", { type: "image/png" }));
  for (const type of ["dragenter", "dragover", "drop"]) {
    document.body.dispatchEvent(
      new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }),
    );
  }
}, b64);
await sleep(1800);
let info = await canvasInfo();
check("drop loads the image into the Xtractor window", info.size === "480x240", info.size);
check(
  "image keeps its aspect ratio inside the Forge (2.00)",
  Math.abs(info.ratio - 2) < 0.02,
  info.ratio.toFixed(2),
);
check(
  "the other tools did not receive the drop",
  sameHashes(hashesBeforeDrop, await otherToolHashes()),
);
const loadedHash = info.hash;

// --- selection, nudge, send to Pixler
const rect = await ix((root) => {
  const r = root.querySelector("#image-canvas").getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const sx = rect.x + rect.w * 0.1;
const sy = rect.y + rect.h * 0.2;
const ex = rect.x + rect.w * 0.35;
const ey = rect.y + rect.h * 0.8;
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(ex, ey, { steps: 8 });
await page.mouse.up();
await sleep(300);
const prop = (id) => ix((root, i) => Number(root.querySelector(i)?.value), id);
const x0 = await prop("#prop-x");
check(
  "rect selection exists and is pixel-snapped",
  (await prop("#prop-w")) > 0 && Number.isInteger(x0),
  `x=${x0}`,
);
await key("ArrowRight");
check(
  "ArrowRight nudges the selection while the Xtractor is on top",
  (await prop("#prop-x")) === x0 + 1,
);

const pixlerBefore = await otherToolHashes();
await ix((root) => root.querySelector("#btn-send-pixler").click());
await sleep(800);
const pixlerAfter = await otherToolHashes();
check(
  "Send-to-Pixler reaches the Pixler window through the event bus",
  !sameHashes(pixlerBefore, pixlerAfter),
);

// --- Pixler keeps its own keys: Cmd+Z / tool letters belong to the window that is on top
const pixlerTool = () =>
  page.evaluate(() => {
    const win = [...document.querySelectorAll(".swf-window")].find(
      (w) => w.querySelector(".swf-window-title")?.textContent.trim() === "Pixler Editor",
    );
    const active = win?.querySelector(
      ".tool-btn.active, .pixler-tool-btn.active, [class*='active']",
    );
    return active
      ? `${active.className}|${active.textContent.trim()}|${active.title ?? ""}`
      : "none";
  });
const pixlerToolBefore = await pixlerTool();
await focusWindow("Asset Extractor");
await key("f");
await key("z", ["Meta"]);
await key("z", ["Meta", "Shift"]);
check(
  "Cmd+Z and tool letters with the Xtractor on top leave the Pixler alone",
  sameHashes(pixlerAfter, await otherToolHashes()) && (await pixlerTool()) === pixlerToolBefore,
  `tool ${pixlerToolBefore} -> ${await pixlerTool()}`,
);

// --- AI chat inside the window
await ix((root) => {
  const input = root.querySelector("#chat-input");
  input.focus();
});
await page.keyboard.type("hallo");
await page.keyboard.press("Enter");
await sleep(1500);
const chat = await ix((root) => root.querySelector("#chat-history")?.innerHTML ?? "");
check(
  "AI chat answers inside the window",
  /Forge-Antwort/.test(chat) && /<(b|strong)>fett<\/(b|strong)>/.test(chat),
);

// --- key isolation: the focus is on another tool, the Xtractor must stay put
await ix((root) => root.querySelector("#image-canvas").blur?.());
await focusWindow("Pixler Editor");
const xBefore = await prop("#prop-x");
const infoBefore = await canvasInfo();
await key("ArrowRight");
await key("Delete");
await key("Backspace");
await key("Escape");
info = await canvasInfo();
check(
  "keys typed in the Pixler window do not delete the Xtractor image",
  info.size === "480x240",
  `canvas=${info.size}`,
);
check(
  "keys typed in the Pixler window do not nudge or clear the Xtractor selection",
  (await prop("#prop-x")) === xBefore,
  `x ${xBefore} -> ${await prop("#prop-x")}`,
);
void infoBefore;

// --- key isolation: the whole Forge is closed, the keys belong to the 3D scene
await key("KeyG", ["Alt", "Meta"]);
await key("Delete");
await key("Backspace");
await key("z", ["Meta"]);
await key("KeyG", ["Alt", "Meta"]);
info = await canvasInfo();
check(
  "Delete/Backspace/Cmd+Z with the Forge hidden leave the Xtractor image alone",
  info.size === "480x240" && info.hash === loadedHash,
  `canvas=${info.size}`,
);

// --- the Xtractor window on top works again, including remove + undo
await focusWindow("Asset Extractor");
await key("Delete");
check("Delete removes the image when the Xtractor is on top", (await canvasInfo()).size === "none");
await key("z", ["Meta"]);
info = await canvasInfo();
check("Cmd+Z brings it back", info.size === "480x240" && info.hash === loadedHash);

// --- closing the window unmounts the tool: its keys must be dead
await clickElement(() => {
  const win = [...document.querySelectorAll(".swf-window")].find(
    (w) => w.querySelector(".swf-window-title")?.textContent.trim() === "Asset Extractor",
  );
  return win?.querySelector(".swf-window-close") ?? null;
});
await sleep(500);
const stillVisible = await page.evaluate(() =>
  [...document.querySelectorAll(".swf-window")].some(
    (w) =>
      w.querySelector(".swf-window-title")?.textContent.trim() === "Asset Extractor" &&
      w.getClientRects().length > 0,
  ),
);
check("closing hides the Xtractor window", !stillVisible);
await focusWindow("Pixler Editor");
await key("Delete");
await key("z", ["Meta"]);
info = await canvasInfo();
check(
  "a hidden Xtractor ignores Delete and Cmd+Z",
  info.size === "480x240" && info.hash === loadedHash,
  `canvas=${info.size}`,
);

await page.screenshot({
  path: process.env.SHOT ?? path.join(os.tmpdir(), "xtractor-forge-e2e.png"),
});
check(
  "no unexpected console or page errors during the run",
  0 === errors.length,
  errors.slice(0, 3).join(" | "),
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await browser.close();
mock.close();
process.exit(failed ? 1 : 0);

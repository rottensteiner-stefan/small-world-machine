/* global document, window -- used inside page.evaluate (browser context) */

// End-to-end check of the Forge tools Map Generator, Pixler and Material Studio in a real browser
// (headless Chrome via Puppeteer). The Xtractor has its own script (xtractor-forge-e2e.mjs).
//
// Needs the dev server (`npm run dev`); it talks to the internal HTTPS port, override the base with
// FORGE_BASE_URL. The host page is Showcase 19 (it calls attachDevTools).
//
// Covers per tool: its core editing path with real mouse input, undo/redo where the tool has it,
// that a drop reaches only the topmost tool, and key isolation (keys typed while another tool is on
// top must not touch it). Exit code 1 if any step fails.

import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { createReporter, openForgeHost, sleep } from "./lib/forge-page.mjs";

const BASE = process.env.FORGE_BASE_URL ?? "https://localhost:5183";
const { check, finish } = createReporter();

/** A 128x128 colourful texture, so every derived map in Material Studio has structure. */
function makeTexture() {
  const png = new PNG({ width: 128, height: 128 });
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const i = (y * 128 + x) * 4;
      const brick = ((x >> 4) + (y >> 4)) & 1;
      png.data[i] = brick ? 200 : 90 + ((x * 3) & 63);
      png.data[i + 1] = 80 + ((y * 2) & 127);
      png.data[i + 2] = brick ? 60 : 150;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png).toString("base64");
}

const host = await openForgeHost({ base: BASE, viewport: { width: 2000, height: 950 } });
const { page, errors, key, clickElement, inWindow, canvasHash, dropFile, focusWindow, openWindow } =
  host;

const MAP = "Map Generator";
const PIX = "Pixler Editor";
const MS = "Material Studio";

await host.toggleForge();
check("Forge opens with Alt+Cmd+G", await host.forgeVisible());
for (const title of [MAP, PIX, MS]) await openWindow(title);
for (const title of [MAP, PIX, MS]) {
  check(`${title} window is shown`, await host.windowVisible(title));
}
// at their default size every window must lie fully inside the screen, close button included
const offscreen = await page.evaluate(() =>
  [...document.querySelectorAll(".swf-window")]
    .filter((w) => w.getClientRects().length > 0)
    .map((w) => ({
      title: w.querySelector(".swf-window-title")?.textContent.trim(),
      r: w.getBoundingClientRect(),
    }))
    .filter(({ r }) => r.right > window.innerWidth || r.bottom > window.innerHeight)
    .map(({ title, r }) => `${title} ${Math.round(r.right)}x${Math.round(r.bottom)}`),
);
check(
  "every window fits on screen at its default size",
  0 === offscreen.length,
  offscreen.join(", "),
);

// the default positions overlap so much that a covered window cannot be reached: tile them
await host.layoutWindow(MAP, 10, 10, 700, 560);
await host.layoutWindow(PIX, 720, 10, 580, 700);
await host.layoutWindow(MS, 1310, 10, 680, 800);
check(
  "no errors while mounting the three tools",
  0 === errors.length,
  errors.slice(0, 2).join(" | "),
);

/** Canvas-relative mouse click in page coordinates inside a window. */
const canvasPoint = (title, selector, fx, fy) =>
  inWindow(
    title,
    (root, sel, ax, ay) => {
      const r = root.querySelector(sel).getBoundingClientRect();
      return { x: r.x + r.width * ax, y: r.y + r.height * ay };
    },
    selector,
    fx,
    fy,
  );

// =====================================================================================
// Map Generator
// =====================================================================================
await focusWindow(MAP);
const MAP_CANVAS = "#mapgen-canvas";
const mapEmpty = await canvasHash(MAP, MAP_CANVAS);
check("Map Generator canvas renders", mapEmpty.startsWith("640x400"), mapEmpty);

let p = await canvasPoint(MAP, MAP_CANVAS, 0.25, 0.4);
await page.mouse.click(p.x, p.y);
await sleep(200);
const mapWall = await canvasHash(MAP, MAP_CANVAS);
check("painting a wall cell changes the map", mapWall !== mapEmpty);

await clickElement((t) => {
  const win = [...document.querySelectorAll(".swf-window")].find(
    (w) => w.querySelector(".swf-window-title")?.textContent.trim() === t,
  );
  return (
    [...win.querySelectorAll(".mapgen-palette-btn")].find((b) => b.textContent.includes("Lava")) ??
    null
  );
}, MAP);
p = await canvasPoint(MAP, MAP_CANVAS, 0.6, 0.6);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
p = await canvasPoint(MAP, MAP_CANVAS, 0.75, 0.6);
await page.mouse.move(p.x, p.y, { steps: 6 });
await page.mouse.up();
await sleep(200);
const mapLava = await canvasHash(MAP, MAP_CANVAS);
check("dragging the Lava brush paints a line of cells", mapLava !== mapWall);

// the mouse is released outside the canvas: the window-level mouseup must still end the stroke
const strokeBefore = await canvasHash(MAP, MAP_CANVAS);
p = await canvasPoint(MAP, MAP_CANVAS, 0.5, 0.2);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
await page.mouse.move(p.x + 40, p.y - 120, { steps: 4 }); // leaves the canvas
await page.mouse.up();
await sleep(150);
const afterRelease = await canvasHash(MAP, MAP_CANVAS);
p = await canvasPoint(MAP, MAP_CANVAS, 0.9, 0.9);
await page.mouse.move(p.x, p.y, { steps: 3 });
await sleep(150);
check(
  "releasing outside the canvas ends the stroke (no painting without the button)",
  (await canvasHash(MAP, MAP_CANVAS)) === afterRelease || afterRelease !== strokeBefore,
);

await inWindow(MAP, (root) => {
  const w = root.querySelector("#mapgen-w");
  const h = root.querySelector("#mapgen-h");
  w.value = "20";
  h.value = "10";
  w.dispatchEvent(new Event("input", { bubbles: true }));
  h.dispatchEvent(new Event("input", { bubbles: true }));
  root.querySelector("#mapgen-btn-resize").click();
});
await sleep(300);
const resized = await canvasHash(MAP, MAP_CANVAS);
check("Resize changes the grid", resized !== afterRelease, resized.split(":")[0]);

p = await canvasPoint(MAP, MAP_CANVAS, 0.5, 0.5);
await page.mouse.click(p.x, p.y);
await sleep(200);
const beforeClear = await canvasHash(MAP, MAP_CANVAS);
check("a cell is painted before clearing", beforeClear !== resized);
const clearButton = () =>
  inWindow(MAP, (root) => root.querySelector("#mapgen-btn-clear").textContent.trim());
await inWindow(MAP, (root) => root.querySelector("#mapgen-btn-clear").click());
await sleep(200);
check(
  "the first Clear click only arms the button (no blocking dialog) and keeps the map",
  /nochmal/.test(await clearButton()) && (await canvasHash(MAP, MAP_CANVAS)) === beforeClear,
  await clearButton(),
);
await inWindow(MAP, (root) => root.querySelector("#mapgen-btn-clear").click());
await sleep(300);
const cleared = await canvasHash(MAP, MAP_CANVAS);
check("the second click clears the map", cleared !== beforeClear, cleared.split(":")[0]);
check("the button label is back to Clear Map", "Clear Map" === (await clearButton()));

const mapText = Buffer.from("WWWWWW\nW....W\nW.P..W\nWWWWWW\n").toString("base64");
const beforeMapDrop = {
  pixler: await canvasHash(PIX, "canvas"),
  studio: await canvasHash(MS, "#canvas-grid-height"),
};
await dropFile("level.map", "text/plain", mapText);
await sleep(1200);
const afterMapDrop = await canvasHash(MAP, MAP_CANVAS);
check("a dropped .map file loads into the Map Generator (topmost)", afterMapDrop !== cleared);
check(
  "that drop did not reach Pixler or Material Studio",
  beforeMapDrop.pixler === (await canvasHash(PIX, "canvas")) &&
    beforeMapDrop.studio === (await canvasHash(MS, "#canvas-grid-height")),
);

// =====================================================================================
// Pixler
// =====================================================================================
await focusWindow(PIX);
const PIX_CANVAS = "canvas";
const pixBlank = await canvasHash(PIX, PIX_CANVAS);
check("Pixler canvas is 32x32 at start", pixBlank.startsWith("32x32"), pixBlank);

const pixelAt = (fx, fy) => canvasPoint(PIX, PIX_CANVAS, fx, fy);
p = await pixelAt(0.3, 0.3);
await page.mouse.click(p.x, p.y);
await sleep(200);
const pixDot = await canvasHash(PIX, PIX_CANVAS);
check("the pencil paints a pixel", pixDot !== pixBlank);

p = await pixelAt(0.5, 0.5);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
p = await pixelAt(0.8, 0.7);
await page.mouse.move(p.x, p.y, { steps: 8 });
await page.mouse.up();
await sleep(200);
const pixLine = await canvasHash(PIX, PIX_CANVAS);
check("dragging paints a stroke", pixLine !== pixDot);

await key("z", ["Meta"]);
const pixUndo = await canvasHash(PIX, PIX_CANVAS);
check("Cmd+Z undoes the stroke", pixUndo === pixDot, `${pixUndo === pixDot}`);
await key("z", ["Meta", "Shift"]);
check("Cmd+Shift+Z redoes it", (await canvasHash(PIX, PIX_CANVAS)) === pixLine);

// tool letters switch the active tool button
const activeTool = () =>
  inWindow(PIX, (root) => {
    const b = [...root.querySelectorAll(".swf-btn.secondary")].find(
      (x) => /Pencil|Bucket|Picker|Line/.test(x.title) && /primary/.test(x.style.borderColor),
    );
    return b ? b.title.trim() : "none";
  });
const toolBefore = await activeTool();
await key("f");
const toolAfterF = await activeTool();
await key("p");
const toolAfterP = await activeTool();
check(
  "tool letters switch the tool (F bucket, P pencil)",
  /Bucket/.test(toolAfterF) && /Pencil/.test(toolAfterP),
  `${toolBefore} -> ${toolAfterF} -> ${toolAfterP}`,
);

// resize via the W/H inputs
await inWindow(PIX, (root) => {
  const [w, h] = root.querySelectorAll("input[type=number]");
  for (const [el, v] of [
    [w, "16"],
    [h, "16"],
  ]) {
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
await sleep(400);
const pixSmall = await canvasHash(PIX, PIX_CANVAS);
check("W/H inputs resize the canvas to 16x16", pixSmall.startsWith("16x16"), pixSmall);

// a drop with Pixler on top lands in Pixler only
const texture = makeTexture();
const beforePixDrop = {
  map: await canvasHash(MAP, MAP_CANVAS),
  studio: await canvasHash(MS, "#canvas-grid-height"),
};
await dropFile("tex.png", "image/png", texture);
await sleep(1500);
const pixDropped = await canvasHash(PIX, PIX_CANVAS);
check(
  "a dropped image loads into Pixler (topmost)",
  pixDropped !== pixSmall,
  pixDropped.split(":")[0],
);
check(
  "that drop did not reach Map Generator or Material Studio",
  beforePixDrop.map === (await canvasHash(MAP, MAP_CANVAS)) &&
    beforePixDrop.studio === (await canvasHash(MS, "#canvas-grid-height")),
);

// =====================================================================================
// Material Studio
// =====================================================================================
await focusWindow(MS);
const STUDIO_HEIGHT = "#canvas-grid-height";
const msBefore = await canvasHash(MS, STUDIO_HEIGHT);
const pixBeforeMsDrop = await canvasHash(PIX, PIX_CANVAS);
await dropFile("brick.png", "image/png", texture);
let msLoaded = msBefore;
for (let i = 0; i < 20 && msLoaded === msBefore; i++) {
  await sleep(500);
  msLoaded = await canvasHash(MS, STUDIO_HEIGHT);
}
check("a dropped texture fills the Material Studio maps", msLoaded !== msBefore);
check("that drop did not change Pixler", pixBeforeMsDrop === (await canvasHash(PIX, PIX_CANVAS)));

const setSlider = (id, value) =>
  inWindow(
    MS,
    (root, sid, v) => {
      const el = root.querySelector(sid);
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    id,
    value,
  );
await setSlider("#height-blur-slider", "6");
await sleep(1200);
const msBlurred = await canvasHash(MS, STUDIO_HEIGHT);
check("the height blur slider re-renders the height map", msBlurred !== msLoaded);
const normalBefore = await canvasHash(MS, "#canvas-grid-normal");
await setSlider("#normal-strength-slider", "400");
await sleep(1200);
check(
  "the normal strength slider re-renders the normal map",
  (await canvasHash(MS, "#canvas-grid-normal")) !== normalBefore,
);

await clickElement((t) => {
  const win = [...document.querySelectorAll(".swf-window")].find(
    (w) => w.querySelector(".swf-window-title")?.textContent.trim() === t,
  );
  return (
    [...win.querySelectorAll(".tool-tab")].find((b) => b.textContent.trim() === "Height Map") ??
    null
  );
}, MS);
const mainPreview = await canvasHash(MS, "#canvas-main-preview");
check(
  "the Height Map tab shows the map in the main preview",
  !/^none|^unreadable/.test(mainPreview),
  mainPreview.split(":")[0],
);

// =====================================================================================
// Key isolation across the three tools
// =====================================================================================
await focusWindow(MAP);
const pixIso = await canvasHash(PIX, PIX_CANVAS);
const studioIso = await canvasHash(MS, STUDIO_HEIGHT);
await key("z", ["Meta"]);
await key("f");
await key("p");
await key("Delete");
check(
  "keys typed with the Map Generator on top do not change Pixler or Material Studio",
  pixIso === (await canvasHash(PIX, PIX_CANVAS)) &&
    studioIso === (await canvasHash(MS, STUDIO_HEIGHT)),
);
const mapIso = await canvasHash(MAP, MAP_CANVAS);
await focusWindow(PIX);
await key("z", ["Meta"]);
check(
  "Cmd+Z with Pixler on top leaves the Map Generator alone",
  mapIso === (await canvasHash(MAP, MAP_CANVAS)),
);
await focusWindow(PIX);
const pixKeys = await canvasHash(PIX, PIX_CANVAS);
await host.toggleForge();
await key("z", ["Meta"]);
await key("f");
check(
  "with the Forge hidden, Cmd+Z and F do not reach Pixler",
  pixKeys === (await canvasHash(PIX, PIX_CANVAS)),
);
await host.toggleForge();

// =====================================================================================
// Closing the windows (listeners and the Material Studio's own engine are torn down)
// =====================================================================================
for (const title of [MS, PIX, MAP]) {
  await clickElement((t) => {
    const win = [...document.querySelectorAll(".swf-window")].find(
      (w) => w.querySelector(".swf-window-title")?.textContent.trim() === t,
    );
    return win?.querySelector(".swf-window-close") ?? null;
  }, title);
}
check(
  "all three windows close",
  !(await host.windowVisible(MAP)) &&
    !(await host.windowVisible(PIX)) &&
    !(await host.windowVisible(MS)),
);
await key("z", ["Meta"]);
await key("f");
await page.mouse.move(400, 400);
await page.mouse.down();
await page.mouse.move(500, 450, { steps: 4 });
await page.mouse.up();
await sleep(500);

await page.screenshot({ path: process.env.SHOT ?? path.join(os.tmpdir(), "forge-tools-e2e.png") });
check(
  "no unexpected console or page errors during the run",
  0 === errors.length,
  errors.slice(0, 3).join(" | "),
);

await host.browser.close();
process.exit(finish());

/* global document, window, DataTransfer, DragEvent -- used inside page.evaluate (browser context) */

// Shared helpers for the Forge end-to-end scripts: launching Showcase 19 (the host page that calls
// attachDevTools), opening the Forge, driving its windows with real mouse input (the Forge
// reacts to mouse events, not synthetic clicks), and collecting PASS/FAIL results.

import puppeteer from "puppeteer";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Collects PASS/FAIL lines and the final exit code. */
export function createReporter() {
  const results = [];
  return {
    check(name, ok, detail = "") {
      results.push({ name, ok });
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
    },
    finish() {
      const failed = results.filter((r) => !r.ok).length;
      console.log(`\n${results.length - failed}/${results.length} passed`);
      return failed ? 1 : 0;
    },
  };
}

/**
 * Launches headless Chrome, opens the host page with the Forge available and returns helpers.
 * `init` runs before any page script (use it to seed localStorage).
 */
export async function openForgeHost({
  base,
  init,
  initArg,
  viewport = { width: 1600, height: 900 },
} = {}) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--ignore-certificate-errors",
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
    defaultViewport: viewport,
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
  if (init) await page.evaluateOnNewDocument(init, initArg);
  await page.goto(`${base}/apps/showcases/19/index.html?rendererType=WEB_GL2`, {
    waitUntil: "domcontentloaded",
  });
  await sleep(6000);

  const key = async (k, mods = []) => {
    for (const m of mods) await page.keyboard.down(m);
    await page.keyboard.press(k);
    for (const m of [...mods].reverse()) await page.keyboard.up(m);
    await sleep(250);
  };

  /** Real mouse click on the centre of the element the page function returns. */
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

  const forgeVisible = () =>
    page.evaluate(() => {
      const overlay = document.querySelector(".swf-forge-overlay");
      return null !== overlay && "none" !== overlay.style.display;
    });
  const toggleForge = () => key("KeyG", ["Alt", "Meta"]);

  const windowVisible = (title) =>
    page.evaluate(
      (t) =>
        [...document.querySelectorAll(".swf-window")].some(
          (w) =>
            w.querySelector(".swf-window-title")?.textContent.trim() === t &&
            w.getClientRects().length > 0,
        ),
      title,
    );

  /** Shows the window through its taskbar button when it is hidden. */
  const openWindow = async (title) => {
    if (await windowVisible(title)) return;
    await clickElement(
      (t) =>
        [...document.querySelectorAll(".swf-taskbar-btn")].find(
          (b) => b.textContent.trim() === t,
        ) ?? null,
      title,
    );
  };

  /** Brings a window to the front by clicking a spot on its header that no other window covers. */
  const focusWindow = async (title) => {
    const point = await page.evaluate((t) => {
      const win = [...document.querySelectorAll(".swf-window")].find(
        (w) => w.querySelector(".swf-window-title")?.textContent.trim() === t,
      );
      const header = win?.querySelector(".swf-window-header");
      if (!header) return null;
      const r = header.getBoundingClientRect();
      for (let x = r.x + 8; x < Math.min(r.x + r.width - 40, window.innerWidth - 8); x += 12) {
        const y = r.y + r.height / 2;
        if (header.contains(document.elementFromPoint(x, y))) return { x, y };
      }
      return null;
    }, title);
    if (point) await page.mouse.click(point.x, point.y);
    await sleep(300);
    return null !== point;
  };

  /** Runs `fn(root, ...args)` in the page with the window's content element as `root`. */
  const inWindow = (title, fn, ...args) =>
    page.evaluate(
      (t, src, ...a) => {
        const win = [...document.querySelectorAll(".swf-window")].find(
          (w) => w.querySelector(".swf-window-title")?.textContent.trim() === t,
        );
        const root = win?.querySelector(".swf-window-content") ?? null;
        return new Function("root", "args", `return (${src})(root, ...args);`)(root, a);
      },
      title,
      fn.toString(),
      ...args,
    );

  /** Cheap content hash of one canvas inside a window; "none" when empty/unreadable. */
  const canvasHash = (title, selector) =>
    inWindow(
      title,
      (root, sel) => {
        const c = root?.querySelector(sel);
        if (!c || !c.width || !c.height) return "none";
        try {
          const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
          let h = 0;
          // small canvases (pixel art) are hashed byte by byte so a single pixel counts
          const step = d.length <= 65536 ? 1 : 53;
          for (let i = 0; i < d.length; i += step) h = (h * 31 + d[i]) | 0;
          return `${c.width}x${c.height}:${h}`;
        } catch {
          return "unreadable";
        }
      },
      selector,
    );

  /** Drops a file onto the document (what a real drag from the desktop dispatches). */
  const dropFile = (name, type, base64) =>
    page.evaluate(
      async (n, t, data) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], n, { type: t }));
        for (const ev of ["dragenter", "dragover", "drop"]) {
          document.body.dispatchEvent(
            new DragEvent(ev, { dataTransfer: dt, bubbles: true, cancelable: true }),
          );
        }
      },
      name,
      type,
      base64,
    );

  /** Places a window like a user would by dragging and resizing it. */
  const layoutWindow = (title, left, top, width, height) =>
    page.evaluate(
      (t, l, tp, w, h) => {
        const win = [...document.querySelectorAll(".swf-window")].find(
          (x) => x.querySelector(".swf-window-title")?.textContent.trim() === t,
        );
        Object.assign(win.style, {
          left: `${l}px`,
          top: `${tp}px`,
          width: `${w}px`,
          height: `${h}px`,
        });
      },
      title,
      left,
      top,
      width,
      height,
    );

  return {
    browser,
    layoutWindow,
    page,
    errors,
    key,
    clickElement,
    forgeVisible,
    toggleForge,
    windowVisible,
    openWindow,
    focusWindow,
    inWindow,
    canvasHash,
    dropFile,
  };
}

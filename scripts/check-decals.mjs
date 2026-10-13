/* global window, document, requestAnimationFrame, GPUBufferUsage, GPUMapMode -- used inside page.evaluate (browser context) */
// GPU assertions for the decal system (apps/showcases/decal-probe).
// Usage: npm run test:decals   (env: DECAL_ORIGIN=https://localhost:5173, DECAL_REQUIRE_WEBGPU=1)
// WebGL2 is the blocking set; WebGPU is informational unless DECAL_REQUIRE_WEBGPU=1.
import puppeteer from "puppeteer";
import { PNG } from "pngjs";

const ORIGIN = process.env.DECAL_ORIGIN || "https://localhost:5173";
const PAGE = `${ORIGIN}/apps/showcases/decal-probe/index.html`;
const FRAMES = 20;
const FLOOR = [0.5, 0.9];
const SKY = [0.5, 0.03];
const PROBE = [0.12, 0.8];
const STRIPE = [0.33, 0.68]; // left stripe decal; brief said (0.33,0.62) which is plain floor in the current camera

const failures = { blocking: 0, info: 0 };
const log = (ok, blocking, msg) => {
  console.log(`${ok ? "PASS" : blocking ? "FAIL" : "WARN"}  ${msg}`);
  if (!ok) failures[blocking ? "blocking" : "info"]++;
};

/** Runs in the page: returns decoded octahedral normals (or raw enc) at the given fractions. */
async function readNormals(page, backend, points) {
  return page.evaluate(
    async (backend, points) => {
      const app = window.app;
      const r = app.renderer;
      const halfToFloat = (h) => {
        const s = h & 0x8000 ? -1 : 1;
        const e = (h >> 10) & 0x1f;
        const f = h & 0x3ff;
        if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
        if (e === 31) return f ? NaN : s * Infinity;
        return s * Math.pow(2, e - 15) * (1 + f / 1024);
      };
      const decode = (x, y) => {
        const z = 1 - Math.abs(x) - Math.abs(y);
        let nx = x,
          ny = y;
        if (z < 0) {
          nx = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1);
          ny = (1 - Math.abs(x)) * (y >= 0 ? 1 : -1);
        }
        const l = Math.hypot(nx, ny, z) || 1;
        return [nx / l, ny / l, z / l];
      };
      let w, h, get;
      if (backend === "WEB_GPU") {
        const dev = r._device;
        const tex = r._normalTexture;
        if (!tex) throw new Error("no _normalTexture");
        w = tex.width;
        h = tex.height;
        const bpr = Math.ceil((w * 8) / 256) * 256; // rg16f = 4 B, but be safe w/ rgba16f
        const bytesPer = tex.format === "rg16float" ? 4 : 8;
        const bprow = Math.ceil((w * bytesPer) / 256) * 256;
        void bpr;
        const buf = dev.createBuffer({
          size: bprow * h,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const enc = dev.createCommandEncoder();
        enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bprow }, [w, h]);
        dev.queue.submit([enc.finish()]);
        await buf.mapAsync(GPUMapMode.READ);
        const u16 = new Uint16Array(buf.getMappedRange().slice(0));
        buf.unmap();
        get = (px, py) => {
          const i = (py * bprow + px * bytesPer) / 2;
          return [halfToFloat(u16[i]), halfToFloat(u16[i + 1])];
        };
      } else {
        const gl = r.gl;
        if (!r.hasNormalTarget) throw new Error("hasNormalTarget=false");
        const tex = r.normalTexture;
        const fbo = r._hdrFbo;
        w = fbo.width ?? gl.drawingBufferWidth;
        h = fbo.height ?? gl.drawingBufferHeight;
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw new Error("normal FBO incomplete");
        const out = new Float32Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, out);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(f);
        const err = gl.getError();
        if (err) throw new Error(`readPixels GL error 0x${err.toString(16)}`);
        get = (px, py) => {
          const i = ((h - 1 - py) * w + px) * 4;
          return [out[i], out[i + 1]];
        };
      }
      return points.map(([fx, fy]) => {
        const [ex, ey] = get(Math.floor(fx * w), Math.floor(fy * h));
        const sentinel = Math.abs(ex) > 1 || Math.abs(ey) > 1;
        return { enc: [ex, ey], sentinel, n: sentinel ? null : decode(ex, ey) };
      });
    },
    backend,
    points,
  );
}

/** Pending GL error codes of the page's WebGL context (drained, so nothing is left behind). */
async function drainGlErrors(page) {
  return page.evaluate(() => {
    const gl = window.app.renderer.gl;
    const found = [];
    for (let i = 0; i < 16; i++) {
      const code = gl.getError();
      if (code === gl.NO_ERROR) break;
      found.push(`0x${code.toString(16)}`);
    }
    return found;
  });
}

async function openProbe(browser, query) {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  const errors = [];
  const glWarnings = [];
  page.on("console", (m) => {
    // Chrome reports GL errors such as INVALID_ENUM from drawElements as warnings, not as errors.
    if (
      m.type() === "warning" &&
      /GL_INVALID|GL ERROR|INVALID_(ENUM|OPERATION|VALUE)/i.test(m.text())
    ) {
      glWarnings.push(m.text());
    }
    if (m.type() !== "error") return;
    const t = m.text();
    if (t.includes("favicon")) return;
    errors.push(t);
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${PAGE}?${query}`, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => !!window.app?.renderer, { timeout: 20000 });
  await page.evaluate(
    (n) =>
      new Promise((res) => {
        let c = 0;
        const tick = () => (++c >= n ? res() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    FRAMES,
  );
  await new Promise((r) => setTimeout(r, 500));
  return { page, errors, glWarnings };
}

const short = (e) => {
  const u = [...new Set(e.map((s) => s.split("\n")[0].slice(0, 160)))];
  return `${e.length} err, first: ${u.slice(0, 2).join(" / ")}`;
};
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const fmt = (v) => (v ? `(${v.map((x) => x.toFixed(3)).join(", ")})` : "null");

async function normalsFor(browser, backend, auto = false) {
  const tag = auto ? `${backend} (auto)` : backend;
  const blocking = backend === "WEB_GL2";
  const q = `rendererType=${backend}${auto ? "" : "&nb=1"}${backend === "WEB_GL2" ? "&pp=1" : ""}`;
  const { page, errors } = await openProbe(browser, q);
  let res = null;
  try {
    if (backend === "WEB_GL2") {
      const glErr = await page.evaluate(() => window.app.renderer.gl.getError());
      if (glErr) errors.push(`GL error 0x${glErr.toString(16)}`);
    }
    const [floor, sky, probe] = await readNormals(page, backend, [FLOOR, SKY, PROBE]);
    res = { floor, sky, probe };
    log(
      !errors.length,
      blocking,
      `${tag}: no console/validation/GL errors${errors.length ? ` -> ${short(errors)}` : ""}`,
    );
    log(
      !floor.sentinel && near(floor.n, [0, 1, 0], 0.02),
      blocking,
      `${tag}: floor normal ${fmt(floor.n)} ~ (0,1,0)`,
    );
    log(sky.sentinel, blocking, `${tag}: sky is sentinel (enc ${fmt(sky.enc)})`);
    const p = probe.n;
    log(
      !!p && p[0] > 0.2 && p[0] < 0.6 && p[1] > 0.8 && p[1] < 0.97,
      blocking,
      `${tag}: NormalProbe ${fmt(p)} between floor and decal normal (x in (0.2,0.6), y in (0.8,0.97))`,
    );
  } catch (e) {
    log(false, blocking, `${tag}: normal readback threw: ${e.message}`);
  }
  await page.close();
  return res;
}

/** AO texture stats of the probe with HBAO on: share of texels below 0.9 and the open-floor mean. */
async function aoStats(page, backend) {
  return page.evaluate(async (be) => {
    const r = window.app.renderer;
    let px, w, h, rowStride, channelStride;
    if (be === "WEB_GPU") {
      const dev = r._device;
      const tex = r._hbaoPassGPU?._aoTexture;
      if (!tex) return null;
      w = tex.width;
      h = tex.height;
      rowStride = Math.ceil((w * 4) / 256) * 256;
      const buf = dev.createBuffer({
        size: rowStride * h,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const ce = dev.createCommandEncoder();
      ce.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: rowStride }, [w, h, 1]);
      dev.queue.submit([ce.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      px = new Uint8Array(buf.getMappedRange().slice(0));
      buf.unmap();
      channelStride = 4;
    } else {
      const gl = r.gl;
      const tex = r._hbaoPassGL?._target?.texture;
      if (!tex) return null;
      w = gl.canvas.width;
      h = gl.canvas.height;
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      rowStride = w * 4;
      channelStride = 4;
    }
    const topRow = (fy) => (be === "WEB_GPU" ? Math.floor(h * fy) : Math.floor(h * (1 - fy)));
    let below = 0;
    let n = 0;
    for (let y = 0; y < h; y += 5) {
      for (let x = 0; x < w; x += 5) {
        n++;
        if (px[y * rowStride + x * channelStride] < 230) below++;
      }
    }
    let floorSum = 0;
    let floorN = 0;
    for (let fy = 0.88; fy < 0.97; fy += 0.01) {
      for (let fx = 0.1; fx < 0.9; fx += 0.02) {
        floorSum += px[topRow(fy) * rowStride + Math.floor(w * fx) * channelStride] / 255;
        floorN++;
      }
    }
    return { fractionBelow: below / n, floorMean: floorSum / floorN };
  }, backend);
}

/** HBAO must not depend on the normal buffer: its AO has to be the same with the buffer forced on/off. */
async function hbaoIndependence(browser, backend) {
  const blocking = backend === "WEB_GL2";
  const pp = backend === "WEB_GL2" ? "&pp=1" : "";
  const stats = {};
  for (const nb of [0, 1]) {
    const { page, errors } = await openProbe(
      browser,
      `rendererType=${backend}&nb=${nb}&hbao=1${pp}`,
    );
    stats[nb] = await aoStats(page, backend);
    log(
      !errors.length,
      blocking,
      `${backend} hbao nb=${nb}: no console/validation/GL errors${errors.length ? ` -> ${short(errors)}` : ""}`,
    );
    await page.close();
  }
  const [off, on] = [stats[0], stats[1]];
  if (!off || !on) {
    log(false, blocking, `${backend} hbao: AO texture unavailable`);
    return;
  }
  log(
    off.floorMean > 0.97,
    blocking,
    `${backend} hbao: open floor stays unoccluded (mean ${off.floorMean.toFixed(3)} > 0.97)`,
  );
  log(
    off.fractionBelow > 0.005 && off.fractionBelow < 0.2,
    blocking,
    `${backend} hbao: contact occlusion present (${(off.fractionBelow * 100).toFixed(2)} % of texels below 0.9)`,
  );
  log(
    Math.abs(off.fractionBelow - on.fractionBelow) < 0.002 &&
      Math.abs(off.floorMean - on.floorMean) < 0.002,
    blocking,
    `${backend} hbao: identical with normal buffer off/on (below-0.9 share ${off.fractionBelow.toFixed(4)} vs ${on.fractionBelow.toFixed(4)})`,
  );
}

/** Normal-mapped floor (?bump=1): buffer must carry the map, decals must blend onto it, HBAO must ignore it. */
async function bumpChecks(browser, backend) {
  const blocking = backend === "WEB_GL2";
  const pp = backend === "WEB_GL2" ? "&pp=1" : "";
  const res = {};
  for (const bump of [0, 1]) {
    const { page, errors } = await openProbe(
      browser,
      `rendererType=${backend}&nb=1&bump=${bump}${pp}`,
    );
    try {
      const [floor, probe] = await readNormals(page, backend, [FLOOR, PROBE]);
      res[bump] = { floor: floor.n, probe: probe.n };
    } catch (e) {
      log(false, blocking, `${backend} bump=${bump}: normal readback threw: ${e.message}`);
    }
    log(
      !errors.length,
      blocking,
      `${backend} bump=${bump}: no console/validation/GL errors${errors.length ? ` -> ${short(errors)}` : ""}`,
    );
    await page.close();
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  if (res[0] && res[1] && res[0].floor && res[1].floor && res[0].probe && res[1].probe) {
    const d1 = dist(res[1].floor, [0, 1, 0]);
    log(
      d1 > 0.05,
      blocking,
      `${backend} bump: floor buffer normal ${fmt(res[1].floor)} differs from (0,1,0) by ${d1.toFixed(3)} (>0.05)`,
    );
    const d2 = dist(res[1].probe, res[0].probe);
    log(
      d2 > 0.03,
      blocking,
      `${backend} bump: NormalProbe over bumped ${fmt(res[1].probe)} vs flat ${fmt(res[0].probe)} differ by ${d2.toFixed(3)} (>0.03)`,
    );
  }
  const stats = {};
  for (const bump of [0, 1]) {
    const { page } = await openProbe(
      browser,
      `rendererType=${backend}&nb=1&hbao=1&bump=${bump}${pp}`,
    );
    stats[bump] = await aoStats(page, backend);
    await page.close();
  }
  if (stats[0] && stats[1]) {
    log(
      Math.abs(stats[0].fractionBelow - stats[1].fractionBelow) < 0.002 &&
        Math.abs(stats[0].floorMean - stats[1].floorMean) < 0.002,
      blocking,
      `${backend} bump: HBAO independent of receiver normal map (below-0.9 ${stats[0].fractionBelow.toFixed(4)} vs ${stats[1].fractionBelow.toFixed(4)}, floor mean ${stats[0].floorMean.toFixed(4)} vs ${stats[1].floorMean.toFixed(4)})`,
    );
  } else {
    log(false, blocking, `${backend} bump: AO texture unavailable`);
  }
  return res[1] ?? null;
}

/** ORM and emissive maps (?orm=1): AO darkens, a neutral ORM changes nothing, emission adds colour on lit decals only. */
async function ormChecks(browser, backend) {
  const blocking = backend === "WEB_GL2";
  const pp = backend === "WEB_GL2" ? "&pp=1" : "";
  const { page, errors } = await openProbe(browser, `rendererType=${backend}&orm=1&nb=0${pp}`);
  const rect = await page.evaluate(() => {
    const r = document.querySelector("canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const png = PNG.sync.read(Buffer.from(await page.screenshot({ clip: rect })));
  // Camera straight above the origin, 60 degree vertical fov, height 12; decal x positions as in ormScene.ts.
  const halfWidth = 12 * Math.tan(Math.PI / 6) * (png.width / png.height);
  const px = (worldX) => {
    const x = Math.floor((0.5 + worldX / (2 * halfWidth)) * png.width);
    const y = Math.floor(png.height / 2);
    const i = (png.width * y + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const [control, ao, neutral, smooth, emissive, unlitEmissive, metal, metalOff] = [
    -10.5, -7.5, -4.5, -1.5, 1.5, 4.5, 7.5, 10.5,
  ].map((x) => px(x === -1.5 ? -0.5 : x)); // the smooth decal is sampled near the centre, where the sun's peak points at the camera
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const tag = `${backend} orm`;
  console.log(
    `INFO  ${tag}: control ${control} ao ${ao} neutral ${neutral} smooth ${smooth} emissive ${emissive} unlit+emissive ${unlitEmissive} metal ${metal} metal-off ${metalOff}`,
  );
  log(
    !errors.length,
    blocking,
    `${tag}: no console/validation/GL errors${errors.length ? ` -> ${short(errors)}` : ""}`,
  );
  log(
    lum(ao) < lum(control) - 8,
    blocking,
    `${tag}: ORM with AO 0 is darker than the control (luma ${lum(ao).toFixed(0)} < ${lum(control).toFixed(0)} - 8)`,
  );
  log(
    Math.max(...neutral.map((v, i) => Math.abs(v - control[i]))) <= 3,
    blocking,
    `${tag}: neutral ORM equals the control (${neutral} vs ${control})`,
  );
  log(
    emissive[0] - control[0] >= 20 && Math.abs(emissive[1] - control[1]) <= 4,
    blocking,
    `${tag}: red emissive map adds red only (${emissive} vs ${control})`,
  );
  log(
    Math.abs(unlitEmissive[0] - unlitEmissive[1]) <= 4,
    blocking,
    `${tag}: unlit decal ignores the emissive map (${unlitEmissive})`,
  );
  log(
    Math.abs(lum(smooth) - lum(control)) > 5,
    blocking,
    `${tag}: ORM G = 0.4 changes the result against the rough control (luma ${lum(smooth).toFixed(0)} vs ${lum(control).toFixed(0)}); only the G channel differs, the direction is not asserted`,
  );
  log(
    Math.abs(lum(metal) - lum(control)) > 8,
    blocking,
    `${tag}: metallic 1 with a neutral ORM differs from the control (luma ${lum(metal).toFixed(0)} vs ${lum(control).toFixed(0)})`,
  );
  log(
    Math.max(...metalOff.map((v, i) => Math.abs(v - control[i]))) <= 3,
    blocking,
    `${tag}: ORM B = 0 switches metallic 1 off again (${metalOff} vs ${control})`,
  );
  await page.close();
}

/** The kit's wet-puddle preset (`?wet=1`): dark albedo plus ORM roughness against a dark-only twin and the bare floor. */
async function wetChecks(browser, backend, sun = 0.4) {
  const blocking = backend === "WEB_GL2";
  const pp = backend === "WEB_GL2" ? "&pp=1" : "";
  const { page, errors } = await openProbe(
    browser,
    `rendererType=${backend}&wet=1&sun=${sun}&nb=0${pp}`,
  );
  const rect = await page.evaluate(() => {
    const r = document.querySelector("canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const png = PNG.sync.read(Buffer.from(await page.screenshot({ clip: rect })));
  // Camera straight above the origin, 60 degree vertical fov, height 12, up = -Z (screen y grows with +Z); decal x as in wetScene.ts.
  const halfHeight = 12 * Math.tan(Math.PI / 6);
  const halfWidth = halfHeight * (png.width / png.height);
  const px = (worldX, worldZ) => {
    const x = Math.floor((0.5 + worldX / (2 * halfWidth)) * png.width);
    const y = Math.floor((0.5 + worldZ / (2 * halfHeight)) * png.height);
    const i = (png.width * y + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const wet = px(-0.8, 0);
  const dark = px(0.8, 0);
  const control = px(0.8, 4);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const tag = `${backend} wet (sun ${sun})`;
  console.log(`INFO  ${tag}: bare floor ${control} dark-only ${dark} wet preset ${wet}`);
  log(
    !errors.length,
    blocking,
    `${tag}: no console/validation/GL errors${errors.length ? ` -> ${short(errors)}` : ""}`,
  );
  log(
    lum(dark) < lum(control) - 8,
    blocking,
    `${tag}: the dark albedo darkens the floor (luma ${lum(dark).toFixed(0)} < ${lum(control).toFixed(0)} - 8)`,
  );
  log(
    lum(wet) > lum(dark) + 3,
    blocking,
    `${tag}: ORM roughness 0.05 adds a specular highlight on top of the darkening (luma ${lum(wet).toFixed(0)} > ${lum(dark).toFixed(0)} + 3)`,
  );
  log(
    lum(wet) < lum(control) + 40,
    false,
    `${tag}: the wet patch stays a dark overlay, not a bright glare (luma ${lum(wet).toFixed(0)} vs bare floor ${lum(control).toFixed(0)})`,
  );
  await page.close();
}

/** `DecalPool` (`?pool=1`): recycling, restacking and fading, read back from pixels. */
async function poolChecks(browser, backend) {
  const blocking = backend === "WEB_GL2";
  const pp = backend === "WEB_GL2" ? "&pp=1" : "";
  const { page, errors } = await openProbe(browser, `rendererType=${backend}&pool=1&nb=0${pp}`);
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((res) => {
          let c = 0;
          const tick = () => (++c >= 6 ? res() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
    );
  const centre = async () => {
    const rect = await page.evaluate(() => {
      const r = document.querySelector("canvas").getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const png = PNG.sync.read(Buffer.from(await page.screenshot({ clip: rect })));
    const i = (png.width * Math.floor(png.height / 2) + Math.floor(png.width / 2)) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const tag = `${backend} pool`;
  const floor = await centre();

  // Six spawns at one spot into a pool of four: slots 0 and 1 (red, green) get recycled, in that order.
  const counts = await page.evaluate(() => {
    const pool = window.__decalPool;
    for (let i = 0; i < 6; i++) {
      window.__decalPoolSpawn(0, 0);
      pool.update(0.1);
    }
    return { active: pool.activeCount, capacity: pool.capacity };
  });
  await settle();
  const top = await centre();
  log(
    counts.active === 4 && counts.capacity === 4,
    blocking,
    `${tag}: six spawns into four slots leave four alive (${counts.active}/${counts.capacity})`,
  );
  log(
    top[1] > 150 && top[0] < 60 && top[2] < 60,
    blocking,
    `${tag}: the newest decal (recycled green slot) is on top, not the highest-numbered slot (${top})`,
  );

  // A decal with a 4 s lifetime and the default 1 s fade: half faded at 3.5 s, gone at 4.1 s.
  await page.evaluate(() => {
    window.__decalPool.clear();
    window.__decalPoolSpawn(0, 0, 4);
    window.__decalPool.update(3.5);
  });
  await settle();
  const half = await centre();
  const redStrength = (c) => c[0] - c[1];
  log(
    redStrength(half) > redStrength(floor) + 40 && redStrength(half) < 235,
    blocking,
    `${tag}: a decal halfway through its fade is partly blended (red minus green ${redStrength(half)}, floor ${redStrength(floor)}, full 255)`,
  );
  await page.evaluate(() => window.__decalPool.update(0.6));
  await settle();
  const gone = await centre();
  log(
    Math.max(...gone.map((v, i) => Math.abs(v - floor[i]))) <= 3,
    blocking,
    `${tag}: the expired decal is gone and the floor shows again (${gone} vs ${floor})`,
  );
  log(
    !errors.length,
    blocking,
    `${tag}: no console/validation/GL errors${errors.length ? ` -> ${short(errors)}` : ""}`,
  );
  await page.close();
}

/**
 * `DecalPool` fed by the engine's real `Raycaster` (`?pool=1`): shots from above onto the floor, a slab tilted
 * 30 degrees and a box. Checks the hit normal, that the decal's up axis equals it, that the decal shows up on the
 * GPU at the hit point and nowhere near it, and that `attachTo` makes it follow a receiver that moves and turns.
 */
async function poolRaycastChecks(browser, backend) {
  const blocking = backend === "WEB_GL2";
  const pp = backend === "WEB_GL2" ? "&pp=1" : "";
  const { page, errors } = await openProbe(browser, `rendererType=${backend}&pool=1&nb=0${pp}`);
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((res) => {
          let c = 0;
          const tick = () => (++c >= 6 ? res() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
    );
  const shoot = (x, z, attach = false) =>
    page.evaluate((x, z, attach) => window.__decalPoolShoot(x, z, attach), x, z, attach);
  /** Pixel under a world point seen by the overhead camera (height 12, fov 60, up = -Z). */
  const pixelAt = async (wx, wy, wz) => {
    const rect = await page.evaluate(() => {
      const r = document.querySelector("canvas").getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const png = PNG.sync.read(Buffer.from(await page.screenshot({ clip: rect })));
    const halfHeight = (12 - wy) * Math.tan(Math.PI / 6);
    const halfWidth = halfHeight * (png.width / png.height);
    const x = Math.floor((0.5 + wx / (2 * halfWidth)) * png.width);
    const y = Math.floor((0.5 + wz / (2 * halfHeight)) * png.height);
    const i = (png.width * y + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const isRed = (c) => c[0] > 150 && c[1] < 80 && c[2] < 80;
  const isGreen = (c) => c[1] > 150 && c[0] < 80 && c[2] < 80;
  const close = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  const tag = `${backend} pool+raycaster`;
  const tilt = Math.PI / 6;

  // Shots onto a tilted slab and the floor: slot 0 (red) and slot 1 (green).
  await page.evaluate(() => window.__decalPool.clear());
  const slab = await shoot(6, 0);
  const floor = await shoot(0, 4);
  await settle();
  log(
    slab.hit &&
      slab.object === "Slab" &&
      close(slab.normal, [0, Math.cos(tilt), Math.sin(tilt)], 0.02),
    blocking,
    `${tag}: the Raycaster hits the tilted slab with its real normal (${slab.object} ${slab.normal.map((v) => v.toFixed(3))})`,
  );
  log(
    close(slab.decalUp, slab.normal, 0.02) &&
      floor.hit &&
      floor.object === "Floor" &&
      close(floor.decalUp, [0, 1, 0], 0.02),
    blocking,
    `${tag}: the spawned decals' up axes equal the hit normals (slab ${slab.decalUp.map((v) => v.toFixed(3))}, floor ${floor.decalUp.map((v) => v.toFixed(3))})`,
  );
  const onSlab = await pixelAt(...slab.point);
  const nearSlab = await pixelAt(slab.point[0] + 1.7, slab.point[1], slab.point[2]);
  const onFloor = await pixelAt(...floor.point);
  const nearFloor = await pixelAt(floor.point[0] + 1.7, floor.point[1], floor.point[2]);
  log(
    isRed(onSlab),
    blocking,
    `${tag}: the decal shows on the tilted slab at the hit point (${onSlab})`,
  );
  log(
    isGreen(onFloor),
    blocking,
    `${tag}: the decal shows on the floor at the hit point (${onFloor})`,
  );
  log(
    !isRed(nearSlab) && !isGreen(nearFloor),
    blocking,
    `${tag}: the decals stay inside their footprint (slab +1.7 m ${nearSlab}, floor +1.7 m ${nearFloor})`,
  );

  // attachTo: a decal on the box follows it when it moves and turns (the shot sits 1 m right of the box centre).
  await page.evaluate(() => window.__decalPool.clear());
  const box = await shoot(-5, 0, true);
  await settle();
  const before = await pixelAt(...box.point);
  await page.evaluate(() => window.__decalPoolMoveReceiver(-3, Math.PI / 2));
  await settle();
  // The offset (+1, 0, 0) from the box centre turns into (0, 0, -1) under a +90 degree yaw about Y.
  const followed = await pixelAt(-3, box.point[1], -1);
  const oldSpot = await pixelAt(box.point[0], box.point[1], box.point[2]);
  const unturned = await pixelAt(-2, box.point[1], 0);
  log(
    box.hit && box.object === "Receiver" && isRed(before),
    blocking,
    `${tag}: the decal on the box shows at the hit point before it moves (${box.object} ${before})`,
  );
  log(
    isRed(followed) && !isRed(oldSpot) && !isRed(unturned),
    blocking,
    `${tag}: attachTo makes the decal follow the box as it moves and turns (new spot ${followed}, old spot ${oldSpot}, un-turned spot ${unturned})`,
  );
  log(
    !errors.length,
    blocking,
    `${tag}: no console/validation/GL errors${errors.length ? ` -> ${short(errors)}` : ""}`,
  );
  await page.close();
}

/**
 * The pool driven by real pointer events (`?pool=1&shoot=1`): `page.mouse.click` fires a click, the page casts a camera
 * ray through that pixel with the engine's `Raycaster` and spawns a decal at the hit, which must show up under the
 * cursor on the GPU. The slab sits at a different height than the floor, so a wrong hit point would miss the pixel.
 */
async function poolClickChecks(browser, backend) {
  const blocking = backend === "WEB_GL2";
  const pp = backend === "WEB_GL2" ? "&pp=1" : "";
  const { page, errors } = await openProbe(
    browser,
    `rendererType=${backend}&pool=1&shoot=1&nb=0${pp}`,
  );
  const settle = () =>
    page.evaluate(
      () =>
        new Promise((res) => {
          let c = 0;
          const tick = () => (++c >= 6 ? res() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
    );
  const rect = await page.evaluate(() => {
    const r = document.querySelector("canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  // Pixels on the floor (left of centre, clear of the objects), on the 30 degree slab and on the box top.
  const spots = {
    floor: [0.5, 0.74],
    slab: [0.71, 0.5],
    box: [0.27, 0.5],
  };
  const colourAt = async (fx, fy) => {
    const png = PNG.sync.read(Buffer.from(await page.screenshot({ clip: rect })));
    const i = (png.width * Math.floor(fy * png.height) + Math.floor(fx * png.width)) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const tag = `${backend} pool+click`;
  const before = {};
  for (const [name, [fx, fy]] of Object.entries(spots)) before[name] = await colourAt(fx, fy);
  const slotColours = { floor: "red", slab: "green", box: "blue" };
  for (const [name, [fx, fy]] of Object.entries(spots)) {
    await page.mouse.click(rect.x + fx * rect.width, rect.y + fy * rect.height);
    await settle();
  }
  const after = {};
  for (const [name, [fx, fy]] of Object.entries(spots)) after[name] = await colourAt(fx, fy);
  const is = {
    red: (c) => c[0] > 150 && c[1] < 80 && c[2] < 80,
    green: (c) => c[1] > 150 && c[0] < 80 && c[2] < 80,
    blue: (c) => c[2] > 150 && c[0] < 80 && c[1] < 80,
  };
  for (const [name, colour] of Object.entries(slotColours)) {
    log(
      is[colour](after[name]) && !is[colour](before[name]),
      blocking,
      `${tag}: a real click on the ${name} spawns the ${colour} slot's decal under the cursor (${before[name]} -> ${after[name]})`,
    );
  }
  const count = await page.evaluate(() => window.__decalPool.activeCount);
  log(count === 3, blocking, `${tag}: three clicks leave three decals alive (${count})`);
  log(
    !errors.length,
    blocking,
    `${tag}: no console/validation/GL errors${errors.length ? ` -> ${short(errors)}` : ""}`,
  );
  await page.close();
}

/** WebGL1 has no decal pass: a scene with decals must render without errors and simply omit them. */
async function webGl1Check(browser) {
  const { page, errors } = await openProbe(browser, "rendererType=WEB_GL1");
  const type = await page.evaluate(() => window.app.renderer.type);
  const rect = await page.evaluate(() => {
    const r = document.querySelector("canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const png = PNG.sync.read(Buffer.from(await page.screenshot({ clip: rect })));
  const px = ([fx, fy]) => {
    const x = Math.floor(fx * png.width);
    const y = Math.floor(fy * png.height);
    const i = (png.width * y + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const a = px(STRIPE);
  const b = px(FLOOR);
  const diff = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  log(type === "WEB_GL1", true, `WEB_GL1: renderer is WebGL1 (${type})`);
  log(
    !errors.length,
    true,
    `WEB_GL1: no console errors${errors.length ? ` -> ${short(errors)}` : ""}`,
  );
  log(
    diff <= 20,
    true,
    `WEB_GL1: decals are omitted, stripe rgb(${a}) ~ floor rgb(${b}), max channel diff ${diff} (<=20)`,
  );
  await page.close();
}

/** Screenshot of the probe canvas decoded to a PNG. */
async function canvasPng(page) {
  const rect = await page.evaluate(() => {
    const r = document.querySelector("canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  return PNG.sync.read(Buffer.from(await page.screenshot({ clip: rect })));
}

const pngPixel = (png, [fx, fy]) => {
  const i = (png.width * Math.floor(fy * png.height) + Math.floor(fx * png.width)) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};

/** WebGL1 + `?bake=1`: the decals are baked into meshes, so the stripe must show where the plain WebGL1 run shows floor. */
async function bakeCheck(browser) {
  const { page, errors, glWarnings } = await openProbe(browser, "rendererType=WEB_GL1&bake=1");
  const type = await page.evaluate(() => window.app.renderer.type);
  const glErrors = await drainGlErrors(page);
  const png = await canvasPng(page);
  (await import("fs")).mkdirSync(".agents/scratches", { recursive: true });
  (await import("fs")).writeFileSync(
    ".agents/scratches/decal-check-WEB_GL1-bake.png",
    PNG.sync.write(png),
  );
  const a = pngPixel(png, STRIPE);
  const b = pngPixel(png, FLOOR);
  const diff = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  log(type === "WEB_GL1", true, `WEB_GL1 bake: renderer is WebGL1 (${type})`);
  log(
    !errors.length,
    true,
    `WEB_GL1 bake: no console errors${errors.length ? ` -> ${short(errors)}` : ""}`,
  );
  log(
    !glErrors.length && !glWarnings.length,
    true,
    `WEB_GL1 bake: no GL errors (getError ${glErrors.join(",") || "none"}, console ${glWarnings.length})${glWarnings.length ? ` -> ${short(glWarnings)}` : ""}`,
  );
  log(
    diff > 30,
    true,
    `WEB_GL1 bake: stripe rgb(${a}) vs floor rgb(${b}), max channel diff ${diff} (>30)`,
  );
  await page.close();

  // Informational: the baked stripe against the WebGL2 box decal at the same pixel (no fade, other lighting path).
  const gl2 = await openProbe(browser, "rendererType=WEB_GL2&nb=0");
  const ref = pngPixel(await canvasPng(gl2.page), STRIPE);
  await gl2.page.close();
  const refDiff = Math.max(...a.map((v, i) => Math.abs(v - ref[i])));
  console.log(
    `INFO  WEB_GL1 bake: stripe rgb(${a}) vs WebGL2 box decal rgb(${ref}), max channel diff ${refDiff}`,
  );
}

/** Unlit decals draw flat albedo and must not touch the normal buffer (they would otherwise blend a made-up normal). */
async function unlitCheck(browser, backend) {
  const blocking = backend === "WEB_GL2";
  const pp = backend === "WEB_GL2" ? "&pp=1" : "";
  const { page, errors } = await openProbe(browser, `rendererType=${backend}&unlit=1&nb=1${pp}`);
  const [floor, probe] = await readNormals(page, backend, [FLOOR, PROBE]);
  log(
    !errors.length,
    blocking,
    `${backend} unlit: no console/validation/GL errors${errors.length ? ` -> ${short(errors)}` : ""}`,
  );
  log(
    !!floor.n && !!probe.n && near(floor.n, probe.n, 0.03),
    blocking,
    `${backend} unlit: NormalProbe ${fmt(probe.n)} equals the floor normal ${fmt(floor.n)} (decal leaves the normal buffer alone)`,
  );
  await page.close();
}

async function colourCheck(browser, backend) {
  const blocking = backend === "WEB_GL2";
  const { page, errors } = await openProbe(browser, `rendererType=${backend}&nb=0`);
  const rect = await page.evaluate(() => {
    const r = document.querySelector("canvas").getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const shot = Buffer.from(await page.screenshot({ clip: rect }));
  (await import("fs")).mkdirSync(".agents/scratches", { recursive: true });
  (await import("fs")).writeFileSync(`.agents/scratches/decal-check-${backend}.png`, shot);
  const png = PNG.sync.read(shot);
  const px = ([fx, fy]) => {
    const x = Math.floor(fx * png.width),
      y = Math.floor(fy * png.height);
    const i = (png.width * y + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const a = px(STRIPE),
    b = px(FLOOR);
  const diff = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  log(
    diff > 30,
    blocking,
    `${backend} nb=0: stripe rgb(${a}) vs floor rgb(${b}), max channel diff ${diff} (>30)`,
  );
  log(
    !errors.length,
    blocking,
    `${backend} nb=0: no console errors${errors.length ? ` -> ${short(errors)}` : ""}`,
  );
  await page.close();
}

async function webGpuUsable(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(`${ORIGIN}/`, { waitUntil: "load", timeout: 20000 });
    return await page.evaluate(async () => {
      if (!navigator.gpu) return "navigator.gpu undefined";
      const a = await navigator.gpu.requestAdapter();
      if (!a) return "no adapter";
      await a.requestDevice();
      return "";
    });
  } catch (e) {
    return e.message;
  } finally {
    await page.close();
  }
}

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
let gl2, gpu, bumpGl2, bumpGpu;
try {
  gl2 = await normalsFor(browser, "WEB_GL2");
  await colourCheck(browser, "WEB_GL2");
  await normalsFor(browser, "WEB_GL2", true);
  await hbaoIndependence(browser, "WEB_GL2");
  bumpGl2 = await bumpChecks(browser, "WEB_GL2");
  await unlitCheck(browser, "WEB_GL2");
  await ormChecks(browser, "WEB_GL2");
  await wetChecks(browser, "WEB_GL2");
  await wetChecks(browser, "WEB_GL2", 3);
  await poolChecks(browser, "WEB_GL2");
  await poolRaycastChecks(browser, "WEB_GL2");
  await poolClickChecks(browser, "WEB_GL2");
  await webGl1Check(browser);
  await bakeCheck(browser);

  const why = await webGpuUsable(browser);
  if (why) {
    const req = !!process.env.DECAL_REQUIRE_WEBGPU;
    console.log(`SKIP  WEB_GPU: unusable (${why})${req ? " but DECAL_REQUIRE_WEBGPU set" : ""}`);
    if (req) failures.blocking++;
  } else {
    gpu = await normalsFor(browser, "WEB_GPU");
    await colourCheck(browser, "WEB_GPU");
    await normalsFor(browser, "WEB_GPU", true);
    await hbaoIndependence(browser, "WEB_GPU");
    await unlitCheck(browser, "WEB_GPU");
    await ormChecks(browser, "WEB_GPU");
    await wetChecks(browser, "WEB_GPU");
    await wetChecks(browser, "WEB_GPU", 3);
    await poolChecks(browser, "WEB_GPU");
    await poolRaycastChecks(browser, "WEB_GPU");
    await poolClickChecks(browser, "WEB_GPU");
    bumpGpu = await bumpChecks(browser, "WEB_GPU");
    if (bumpGl2?.floor && bumpGpu?.floor) {
      log(
        near(bumpGl2.floor, bumpGpu.floor, 0.03),
        false,
        `backends agree on bumped floor normal: GL2 ${fmt(bumpGl2.floor)} vs GPU ${fmt(bumpGpu.floor)} (0.03)`,
      );
    }
    if (gl2 && gpu) {
      for (const k of ["floor", "probe"]) {
        const ok = gl2[k].n && gpu[k].n && near(gl2[k].n, gpu[k].n, 0.02);
        log(
          !!ok,
          false,
          `backends agree on ${k} normal: GL2 ${fmt(gl2[k].n)} vs GPU ${fmt(gpu[k].n)}`,
        );
      }
      log(gl2.sky.sentinel === gpu.sky.sentinel, false, "backends agree on sky sentinel");
    }
  }
} finally {
  await browser.close();
}
console.log(`\nblocking failures: ${failures.blocking}, informational warnings: ${failures.info}`);
process.exit(failures.blocking ? 1 : 0);

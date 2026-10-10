/* global document */
// S1 "Probe == Shader" check: compiles the REAL OpenWater vertex shader (with the real Gerstner
// chunk) in headless Chrome, reads the displaced world position back through transform feedback
// and compares it with OpenWaterSurfaceProbe. Complements the unit tests, which can only prove
// the mirror against a hand-written copy of the math, not against shader execution.
//
// Needs the dev server (npm run dev, port 5173). Exit code 1 if any sample exceeds its bound.
//   node scripts/probe-gpu-parity.js                 # SwiftShader, like the golden captures
//   ANGLE=default node scripts/probe-gpu-parity.js   # the machine's real GPU
import puppeteer from "puppeteer";

const baseUrl = process.env.BASE_URL ?? "https://localhost:5173";
const useRealGpu = process.env.ANGLE === "default";

const browser = await puppeteer.launch({
  headless: true,
  acceptInsecureCerts: true,
  args: [
    "--no-sandbox",
    "--ignore-certificate-errors",
    "--ignore-gpu-blocklist",
    ...(useRealGpu
      ? []
      : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
  ],
});

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("[page error]", e.message));
  await page.goto(`${baseUrl}/scripts/probe-gpu-parity.html`, { waitUntil: "load" });

  // The first dynamic import can make Vite re-optimize dependencies and reload the page once.
  const evaluateWithRetry = async (fn) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await page.evaluate(fn);
      } catch (error) {
        if (attempt >= 4 || !String(error.message).includes("Execution context was destroyed"))
          throw error;
        await page.waitForNavigation({ waitUntil: "load", timeout: 30000 }).catch(() => {});
      }
    }
  };

  const report = await evaluateWithRetry(async () => {
    const vsRaw = (
      await import("/packages/engine/src/core/materials/liquid/shaders/OpenWater.vert.glsl?raw")
    ).default;
    const chunk = (
      await import("/packages/engine/src/core/materials/shaders/chunks/liquid_gerstner_wave.glsl?raw")
    ).default;
    const { OpenWaterMaterial } =
      await import("/packages/engine/src/core/materials/liquid/OpenWaterMaterial.ts");
    const { OpenWaterSurfaceProbe } =
      await import("/packages/engine/src/core/materials/liquid/OpenWaterSurfaceProbe.ts");

    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return { error: "no webgl2" };
    const stage = (label) => {
      const e = gl.getError();
      if (e !== 0) throw new Error("GL error 0x" + e.toString(16) + " at " + label);
    };

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(
      prog,
      compile(gl.VERTEX_SHADER, vsRaw.replace("[LIQUID_GERSTNER_WAVE]", chunk)),
    );
    gl.attachShader(
      prog,
      compile(
        gl.FRAGMENT_SHADER,
        "#version 300 es\nprecision highp float;\nout vec4 c;\nvoid main(){c=vec4(1.0);}",
      ),
    );
    gl.transformFeedbackVaryings(prog, ["v_worldPos"], gl.SEPARATE_ATTRIBS);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    stage("link/use");

    const blockIndex = gl.getUniformBlockIndex(prog, "GlobalUniforms");
    const ubo = gl.createBuffer();
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferData(
      gl.UNIFORM_BUFFER,
      gl.getActiveUniformBlockParameter(prog, blockIndex, gl.UNIFORM_BLOCK_DATA_SIZE),
      gl.STATIC_DRAW,
    );
    gl.uniformBlockBinding(prog, blockIndex, 0);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
    stage("ubo");

    const material = new OpenWaterMaterial();
    const laneSets = [
      {
        name: "OpenWaterMaterial defaults",
        wave1: material.wave1,
        wave2: material.wave2,
        wave3: material.wave3,
        speed: material.speed,
      },
      {
        name: "moderate",
        wave1: [1, 0.5, 0.35, 8],
        wave2: [0.2, 0.8, 0.3, 5],
        wave3: [-0.3, 0.7, 0.2, 3],
        speed: 1,
      },
      {
        name: "steep short (rest only)",
        worldQuery: false,
        wave1: [0.8, 0.6, 0.6, 2],
        wave2: [-0.5, 0.7, 0.5, 1.5],
        wave3: [0.2, -0.9, 0.4, 4],
        speed: 0.8,
      },
    ];
    const times = [0, 1.3, 7.7, 42];
    const rest = [];
    for (let x = -12; x <= 12; x += 4.7) for (let z = -12; z <= 12; z += 5.3) rest.push([x, z]);

    const positions = new Float32Array(rest.flatMap(([x, z]) => [x, 0, z]));
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_position");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    stage("attrib loc=" + loc);

    const tfBuf = gl.createBuffer();
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, tfBuf);
    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, positions.byteLength, gl.STATIC_READ);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, tfBuf);
    gl.enable(gl.RASTERIZER_DISCARD);
    stage("tf buffer");

    const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, "u_model"), false, identity);

    const F32_EPS = 1.1920928955078125e-7;
    // GPUs do not implement sin/cos exactly: the GLSL/Vulkan precision rules allow an absolute
    // error of 2^-11 (inside -PI..PI) per call, so each wave may add 2^-11 * amplitude on top of
    // the f32 rounding bound. Measured SwiftShader deviations (~1e-4 m) sit well inside it.
    const GPU_TRIG_ABS_ERROR = 2 ** -11;
    // w4..w6 are derived from w1/w2 exactly like the vertex shader does it (the probe keeps its own
    // copy private, so this is the single copy of the factors inside this script).
    const deriveWaves = (lanes) => {
      const [w1, w2, w3] = [lanes.wave1, lanes.wave2, lanes.wave3];
      const w4 = [w1[1], -w1[0], w1[2] * 0.45, w1[3] * 0.42];
      const w5 = [-w2[1], w2[0], w2[2] * 0.35, w2[3] * 0.35];
      const w6 = [
        w1[0] * 0.5 - w1[1] * 0.866,
        w1[0] * 0.866 + w1[1] * 0.5,
        w1[2] * 0.25,
        w1[3] * 0.22,
      ];
      return [w1, w2, w3, w4, w5, w6];
    };
    const bound = (lanes, x, z, time) => {
      const waves = deriveWaves(lanes);
      let sum = 0;
      for (const w of waves) {
        const k = 6.28318530718 / Math.max(w[3], 0.001);
        const a = Math.abs(w[2]) / Math.max(k, 0.001);
        const len = Math.hypot(w[0], w[1]);
        const kDot = Math.abs(k * ((w[0] / len) * x + (w[1] / len) * z));
        sum += a * 29 * F32_EPS * (1 + kDot + Math.abs(Math.sqrt(9.81 * k) * lanes.speed * time));
        sum += a * GPU_TRIG_ABS_ERROR;
      }
      return sum * 2;
    };

    // Where det(I + d(displacement)/d(rest)) approaches 0 the surface folds over itself: several
    // vertices sit above one world point and "the height above (x, z)" has no unique answer.
    // Such samples are excluded from the world-point comparison (the rest-position one stays).
    // Lane sets with `worldQuery: false` are so steep (summed steepness ~2.2) that the surface is not
    // injective even where det > 0: Newton may land on another vertex above the same point.
    const jacobianDet = (lanes, x, z, time) => {
      const waves = deriveWaves(lanes);
      let jxx = 1,
        jxz = 0,
        jzz = 1;
      for (const w of waves) {
        const k = 6.28318530718 / Math.max(w[3], 0.001);
        const len = Math.hypot(w[0], w[1]);
        const [nx, ny] = [w[0] / len, w[1] / len];
        const phase = k * (nx * x + ny * z) - Math.sqrt(9.81 * k) * lanes.speed * time;
        const slope = w[2] * Math.sin(phase); // a * k = steepness
        jxx -= slope * nx * nx;
        jxz -= slope * nx * ny;
        jzz -= slope * ny * ny;
      }
      return jxx * jzz - jxz * jxz;
    };
    const FOLD_DET = 0.1;

    const rows = [];
    let debug;
    const out = new Float32Array(positions.length);
    for (const lanes of laneSets) {
      const probe = new OpenWaterSurfaceProbe({
        wave1: lanes.wave1,
        wave2: lanes.wave2,
        wave3: lanes.wave3,
        speed: lanes.speed,
      });
      gl.uniform4fv(gl.getUniformLocation(prog, "u_extraParams"), lanes.wave1);
      gl.uniform4fv(gl.getUniformLocation(prog, "u_liquidParams"), lanes.wave2);
      gl.uniform4fv(gl.getUniformLocation(prog, "u_thresholds"), lanes.wave3);
      gl.uniform1f(gl.getUniformLocation(prog, "u_reflectivity"), lanes.speed);
      for (const time of times) {
        gl.uniform1f(gl.getUniformLocation(prog, "u_time"), time);
        gl.beginTransformFeedback(gl.POINTS);
        gl.drawArrays(gl.POINTS, 0, rest.length);
        gl.endTransformFeedback();
        const glError = gl.getError();
        if (glError !== 0)
          throw new Error("GL error 0x" + glError.toString(16) + " after transform feedback draw");
        // A transform feedback buffer may only be bound to the TF target, so read it from there.
        gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, out);

        let foldedSamples = 0;
        let worstRest = 0,
          worstWorld = 0,
          worstRestRatio = 0,
          worstWorldRatio = 0;
        for (let i = 0; i < rest.length; i++) {
          const [rx, rz] = rest[i];
          const [wx, wy, wz] = [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]];
          const b = bound(lanes, rx, rz, time);
          const dRest = Math.abs(probe.heightAt(rx, rz, time) - wy);
          const folded = lanes.worldQuery === false || jacobianDet(lanes, rx, rz, time) < FOLD_DET;
          if (folded) foldedSamples++;
          const dWorld = folded ? 0 : Math.abs(probe.surfaceHeightAt(wx, wz, time) - wy);
          worstRest = Math.max(worstRest, dRest);
          worstWorld = Math.max(worstWorld, dWorld);
          worstRestRatio = Math.max(worstRestRatio, dRest / b);
          worstWorldRatio = Math.max(worstWorldRatio, folded ? 0 : dWorld / b);
        }
        if (lanes.name === "moderate" && time === 0) {
          debug = [];
          for (let i = 0; i < 6; i++) {
            const [rx, rz] = rest[i];
            debug.push({
              rest: [rx, rz],
              gpu: [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]],
              probeY: probe.heightAt(rx, rz, time),
            });
          }
        }
        rows.push({
          foldedSamples,
          worldQuery: lanes.worldQuery,
          lanes: lanes.name,
          time,
          samples: rest.length,
          worstRest,
          worstWorld,
          worstRestRatio,
          worstWorldRatio,
        });
      }
    }
    return { renderer: gl.getParameter(gl.RENDERER), rows, debug };
  });

  if (report.error) throw new Error(report.error);
  if (process.env.DEBUG) console.log(JSON.stringify(report.debug, null, 1));
  console.log(`GL renderer: ${report.renderer}  |  Chrome: ${await browser.version()}`);
  console.log(
    "lanes".padEnd(28),
    "time".padStart(5),
    "max|dy| rest".padStart(14),
    "max|dy| world".padStart(15),
    " ratio rest/world (<=1 ok)",
  );
  // Folded samples are exempt from the world-point comparison; if too many are, a green run would
  // prove almost nothing about it.
  const MIN_WORLD_CHECKED_SHARE = 0.5;
  let failed = false;
  for (const r of report.rows) {
    const worldChecked = r.samples - r.foldedSamples;
    const coverageOk =
      r.worldQuery === false || worldChecked / r.samples >= MIN_WORLD_CHECKED_SHARE;
    const ok = r.worstRestRatio <= 1 && r.worstWorldRatio <= 1 && coverageOk;
    failed ||= !ok;
    console.log(
      r.lanes.padEnd(28),
      String(r.time).padStart(5),
      r.worstRest.toExponential(2).padStart(14),
      r.worstWorld.toExponential(2).padStart(15),
      ` ${r.worstRestRatio.toFixed(2)} / ${r.worstWorldRatio.toFixed(2)}  (${worldChecked}/${r.samples} world-checked)`,
      ok ? "" : "  <-- FAIL",
    );
  }
  console.log(
    failed
      ? "\nFAIL: probe and shader disagree beyond the derived bound."
      : "\nOK: probe matches the shader within the derived bound (f32 rounding + GPU trig accuracy).",
  );
  process.exitCode = failed ? 1 : 0;
} finally {
  await browser.close();
}

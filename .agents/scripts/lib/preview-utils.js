// Shared helpers for the headless Puppeteer scripts (check-showcases.js, goldens/capture.js).
import https from "https";
import net from "net";
import { PNG } from "pngjs";

/** Port of the `vite preview` server the scripts spawn and visit. Override via PREVIEW_PORT. */
export const PREVIEW_PORT = Number(process.env.PREVIEW_PORT) || 4173;
export const PREVIEW_ORIGIN = `https://localhost:${PREVIEW_PORT}`;

/** Returns the `https://localhost:<port>` origin for a given port. */
export function previewOriginForPort(port) {
  return `https://localhost:${port}`;
}

/** Extra `npm run preview` arguments pinning the server to a specific port. */
export function previewArgsForPort(port) {
  return ["run", "preview", "--", "--port", String(port), "--strictPort"];
}

/** Extra `npm run preview` arguments pinning the server to PREVIEW_PORT. */
export const PREVIEW_ARGS = previewArgsForPort(PREVIEW_PORT);

/**
 * Reserves and returns an available ephemeral TCP port on loopback so spawned preview servers
 * never collide with (or silently talk to) an already-running preview server on `:4173`.
 * @returns {Promise<number>}
 */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function probe(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { rejectUnauthorized: false, timeout: 2000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Polls until the server answers any HTTP response. When `serverProcess` is supplied, exits
 * immediately with an error if the spawned server terminates before answering (preventing a
 * silent fallback onto a foreign process listening on the same port).
 * @param {string} url
 * @param {number} timeoutMs
 * @param {import("child_process").ChildProcess | null} [serverProcess]
 */
export async function waitForServer(url, timeoutMs = 60000, serverProcess = null) {
  const deadline = Date.now() + timeoutMs;
  let exitedInfo = null;
  const onExit = (code, signal) => {
    exitedInfo = { code, signal };
  };
  if (serverProcess) {
    if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
      exitedInfo = { code: serverProcess.exitCode, signal: serverProcess.signalCode };
    } else {
      serverProcess.once("exit", onExit);
    }
  }
  try {
    while (Date.now() < deadline) {
      if (exitedInfo) {
        throw new Error(
          `Spawned preview server exited prematurely before ${url} was ready (code=${exitedInfo.code}, signal=${exitedInfo.signal})`,
        );
      }
      if (await probe(url)) {
        if (exitedInfo) {
          throw new Error(
            `Spawned preview server exited prematurely before ${url} was ready (code=${exitedInfo.code}, signal=${exitedInfo.signal})`,
          );
        }
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Preview server at ${url} did not become ready within ${timeoutMs} ms`);
  } finally {
    if (serverProcess) {
      serverProcess.off("exit", onExit);
    }
  }
}

/**
 * Decodes a screenshot PNG buffer and checks whether it looks like a blank/flat canvas: a luminance
 * standard deviation below `stddevThreshold` means nothing was rendered even though no error was
 * thrown. Only the CENTER 50% (both axes) is sampled, because the showcase layout always overlays
 * a title/nav header and footer that would mask a genuinely blank 3D viewport.
 * @param {Buffer} pngBuffer
 * @param {number} stddevThreshold
 * @returns {{ blank: boolean, stddev: number }}
 */
export function detectBlankCanvas(pngBuffer, stddevThreshold) {
  const { data, width, height } = PNG.sync.read(Buffer.from(pngBuffer));
  const sampleStep = 4;
  const xStart = Math.round(width * 0.25);
  const xEnd = Math.round(width * 0.75);
  const yStart = Math.round(height * 0.25);
  const yEnd = Math.round(height * 0.75);
  const luminances = [];
  let sum = 0;
  for (let y = yStart; y < yEnd; y += sampleStep) {
    for (let x = xStart; x < xEnd; x += sampleStep) {
      const idx = (width * y + x) * 4;
      const luminance = 0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2];
      luminances.push(luminance);
      sum += luminance;
    }
  }
  const mean = sum / luminances.length;
  let variance = 0;
  for (const l of luminances) variance += (l - mean) * (l - mean);
  const stddev = Math.sqrt(variance / luminances.length);
  return { blank: stddev < stddevThreshold, stddev };
}

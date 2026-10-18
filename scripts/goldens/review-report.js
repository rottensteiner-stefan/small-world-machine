// scripts/goldens/review-report.js (M4 der Goldens-Optimierung)
//
// Self-contained HTML review page for one goldens compare run. Only cells that actually
// diverged (DIFF/FAIL/ERR) carry side-by-side media; OK cells are listed as text so the
// file stays small and nobody has to open hundreds of images. All media is embedded as
// downscaled data-URIs, so the report is a single portable file.

import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const THUMB_WIDTH = 360;

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file));
}

/** Nearest-neighbour downscale; returns the input untouched when it is already small. */
function downscale(png, maxWidth) {
  if (png.width <= maxWidth) return png;
  const w = maxWidth;
  const h = Math.max(1, Math.round((png.height * maxWidth) / png.width));
  const scale = w / png.width;
  const out = new PNG({ width: w, height: h });
  const src = png.data;
  const dst = out.data;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(png.height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(png.width - 1, Math.floor(x / scale));
      const si = (sy * png.width + sx) * 4;
      const di = (y * w + x) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return out;
}

function toDataUri(png) {
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

function thumbDataUri(file) {
  if (!file) return null;
  if (!fs.existsSync(file)) return null;
  try {
    return toDataUri(downscale(readPng(file), THUMB_WIDTH));
  } catch {
    return null;
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @param {object} opts
 * @param {Array<{label:string,status:string,detail:string,diffRatio?:number}>} opts.rows
 * @param {string} opts.baselineDir
 * @param {string} opts.currentDir
 * @param {Map<string, import("pngjs").PNG>} opts.diffImages  label -> pixelmatch diff PNG
 * @param {string} opts.outPath
 * @param {number} opts.maxDiffRatio
 * @returns {{ report: string, mediaCells: number }}
 */
export function writeReviewHtml(opts) {
  const { rows, baselineDir, currentDir, diffImages, outPath, maxDiffRatio } = opts;

  const bodyRows = rows
    .map((row) => {
      const file = `${row.label}.png`;
      const statusClass = row.status === "OK" ? "ok" : row.status === "DIFF" ? "diff" : "fail";
      const ratio =
        typeof row.diffRatio === "number"
          ? `<span class="ratio">${(row.diffRatio * 100).toFixed(4)}%</span>`
          : "";
      const showMedia = row.status !== "OK";
      let mediaHtml = "";
      if (showMedia) {
        const b = thumbDataUri(path.join(baselineDir, file));
        const c = thumbDataUri(path.join(currentDir, file));
        const d = diffImages.has(row.label) ? toDataUri(diffImages.get(row.label)) : null;
        if (b || c || d) {
          const cell = (src, caption) =>
            src
              ? `<figure class="cell"><img src="${src}" alt="${escapeHtml(caption)}"/><figcaption>${escapeHtml(caption)}</figcaption></figure>`
              : `<figure class="cell empty"><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
          mediaHtml = `<td class="media">${cell(b, "baseline")}${cell(c, "current")}${cell(
            d,
            "diff",
          )}</td>`;
        }
      }
      return `<tr class="${statusClass}"><td class="label">${escapeHtml(row.label)}</td><td class="status">${escapeHtml(
        row.status,
      )}</td><td class="detail">${escapeHtml(row.detail)}</td>${ratio}${mediaHtml}</tr>`;
    })
    .join("\n");

  const mediaCells = rows.filter(
    (r) => r.status !== "OK" || diffImages.has(r.label),
  ).length;

  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8"/>
<title>Liquid Goldens — Review</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-monospace, Menlo, monospace; margin: 2rem; background: #101318; color: #d7dce3; }
  h1 { font-size: 1.1rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border: 1px solid #2a2f38; padding: .5rem; vertical-align: top; text-align: left; }
  th { background: #1a1f27; }
  .label { white-space: nowrap; }
  .status { font-weight: 700; }
  .ratio { display: block; color: #9aa4b2; }
  tr.ok .status { color: #4cd07d; }
  tr.diff .status { color: #e6c46a; }
  tr.fail .status { color: #e0606a; }
  td.media { }
  .cell { display: inline-block; margin: 0 .25rem .25rem 0; }
  .cell img { display: block; max-height: 140px; border: 1px solid #333a45; }
  .cell.empty::before { content: "—"; }
  .cell figcaption { font-size: .7rem; color: #87909d; }
  footer { margin-top: 1rem; font-size: .75rem; color: #87909d; }
</style>
</head>
<body>
<h1>Liquid Goldens Review — ${escapeHtml(rows.length)} Zellen, Toleranz ${(maxDiffRatio * 100).toFixed(2)}%</h1>
<p>Nur divergierende Zellen tragen Bilder (Baseline · Current · Diff); identische Zellen stehen als Text.</p>
<table>
<thead><tr><th>Zelle</th><th>Status</th><th>Detail</th><th>Diff</th><th>Medien</th></tr></thead>
<tbody>
${bodyRows}
</tbody>
</table>
<footer>Regen: <code>npm run goldens:compare -- --baseline .agents/goldens/liquid/baseline --current &lt;dir&gt; --accept</code> — übernimmt vergleichbare (OK/DIFF/FAIL) Zellen als neue Baseline.</footer>
</body>
</html>`;

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, html);
  return { report: outPath, mediaCells };
}

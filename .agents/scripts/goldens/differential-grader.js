// Differential Grader for Liquid Goldens (H4 of Liquid Roadmap).
// Evaluates quantitative quality metrics on captured pool images:
// 1. Floor Contrast Retention (ensuring pool floor is readable)
// 2. Clip Fraction (ensuring no blown-out whiteout regions)
// 3. Specular Lobe Bound (ensuring specular highlights remain tight and bounded)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PNG } from "pngjs";
import config from "./config.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..", "..", "..");

function parseArgs(argv) {
  const args = {
    dir: path.join(ROOT, ".agents", "goldens", "liquid", "baseline"),
    maxClipFraction: 0.06, // max 6% clipped pixels (e.g. valid spec/foam)
    minFloorContrast: 4.0,  // minimum luminance stddev in central pool region
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case "--dir":
        args.dir = value;
        i++;
        break;
      case "--max-clip":
        args.maxClipFraction = Number(value);
        i++;
        break;
      case "--min-contrast":
        args.minFloorContrast = Number(value);
        i++;
        break;
      case "--json":
        args.json = true;
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function analyzeImage(pngBuffer, maxClipFraction, minFloorContrast) {
  const png = PNG.sync.read(pngBuffer);
  const { width, height, data } = png;
  const totalPixels = width * height;

  let clippedPixels = 0;
  let highLumaPixels = 0;
  const centralLumas = [];

  // Central 50% ROI for floor contrast measurement
  const xStart = Math.round(width * 0.25);
  const xEnd = Math.round(width * 0.75);
  const yStart = Math.round(height * 0.25);
  const yEnd = Math.round(height * 0.75);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      // Clip detection (extreme whiteout)
      if (r >= 253 && g >= 253 && b >= 253) {
        clippedPixels++;
      }
      if (luma >= 240) {
        highLumaPixels++;
      }

      if (x >= xStart && x < xEnd && y >= yStart && y < yEnd) {
        centralLumas.push(luma);
      }
    }
  }

  // Floor contrast (standard deviation of central luma)
  const lumaSum = centralLumas.reduce((acc, v) => acc + v, 0);
  const lumaMean = lumaSum / (centralLumas.length || 1);
  let lumaVariance = 0;
  for (const l of centralLumas) {
    lumaVariance += (l - lumaMean) * (l - lumaMean);
  }
  const floorContrast = Math.sqrt(lumaVariance / (centralLumas.length || 1));

  const clipFraction = clippedPixels / totalPixels;
  const specLobeFraction = highLumaPixels / totalPixels;

  const clipOk = clipFraction <= maxClipFraction;
  const contrastOk = floorContrast >= minFloorContrast;
  const specOk = specLobeFraction <= 0.12; // Specular highlight <= 12% of frame

  return {
    clipFraction: Number((clipFraction * 100).toFixed(3)),
    floorContrast: Number(floorContrast.toFixed(2)),
    specLobeFraction: Number((specLobeFraction * 100).toFixed(3)),
    clipOk,
    contrastOk,
    specOk,
    ok: clipOk && contrastOk && specOk,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(args.dir)) {
    console.error(`Error: Baseline directory not found: ${args.dir}`);
    process.exit(1);
  }

  const results = [];
  let allOk = true;

  for (const poolKey of config.poolKeys) {
    for (const view of config.views) {
      const file = `${poolKey}__${view}.png`;
      const filePath = path.join(args.dir, file);

      if (!fs.existsSync(filePath)) {
        results.push({ poolKey, view, file, error: "File not found", ok: false });
        allOk = false;
        continue;
      }

      const buffer = fs.readFileSync(filePath);
      const metrics = analyzeImage(buffer, args.maxClipFraction, args.minFloorContrast);

      const cellResult = {
        poolKey,
        view,
        file,
        ...metrics,
      };
      results.push(cellResult);
      if (!cellResult.ok) allOk = false;
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ ok: allOk, results }, null, 2));
    process.exit(allOk ? 0 : 2);
  }

  console.log("\n🔬 ========================================================");
  console.log("🔬 Liquid Goldens Differential Grader (H4 Quality Gate)");
  console.log("🔬 ========================================================\n");

  const tableData = results.map((r) => {
    if (r.error) {
      return { Cell: `${r.poolKey}/${r.view}`, Status: "FAIL", Error: r.error };
    }
    return {
      Cell: `${r.poolKey}/${r.view}`,
      "Clip %": `${r.clipFraction}%`,
      "Contrast (StdDev)": r.floorContrast,
      "Spec %": `${r.specLobeFraction}%`,
      Grade: r.ok ? "PASS" : "FAIL",
    };
  });

  console.table(tableData);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nResult: ${passed}/${results.length} cells passed quantitative grading.`);

  if (!allOk) {
    console.error("\n❌ Differential grading failed for one or more cells.");
    process.exit(2);
  } else {
    console.log("✅ All liquid pool baseline images meet quantitative quality gates.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

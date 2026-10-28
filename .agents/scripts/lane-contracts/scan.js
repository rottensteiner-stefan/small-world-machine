// Lane-Contract-Registry scanner (T3).
//
// Reads .agents/scripts/lane-contracts/lane-contracts.json and statically checks the real engine +
// extension sources against the declared lanes. Catches: (a) a declared lane write going
// missing (silent delete, G3), (b) a lane carrying multiple meanings without a declared
// collision carve-out, (c) unresolved future registrations (S2/S3), (d) eviction policies
// weakening below "rehome-to-per-style-constant, never silent delete".
//
// Heuristics are intentional and documented: markers are substring matches against the
// comment-stripped source, so the gate proves a lane write is still PRESENT, not that it is
// correct or that the shader consumes it as declared (that is ShaderValidation's and the
// probe tests' job). Every registry meaning must have a marker mapping, otherwise the scan fails. Exit 0 = ok, 1 = violation,
// 2 = technical error (missing file, broken JSON).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", "..");

const REGISTRY_PATH = path.join(ROOT, ".agents", "scripts", "lane-contracts", "lane-contracts.json");
const SCAN_TARGETS = {
  stylizedTs: path.join(ROOT, "packages", "engine", "src", "core", "materials", "liquid", "StylizedWaterMaterial.ts"),
  fragGlsl300: path.join(ROOT, "packages", "engine", "src", "core", "materials", "liquid", "shaders", "StylizedWater.frag.glsl"),
  fragGlsl100: path.join(ROOT, "packages", "engine", "src", "core", "materials", "liquid", "shaders", "StylizedWater.frag.glsl100"),
  fragWgsl: path.join(ROOT, "packages", "engine", "src", "core", "materials", "liquid", "shaders", "StylizedWater.frag.wgsl"),
  layout: path.join(ROOT, "packages", "engine", "src", "renderers", "shaders", "StandardWebGPULayout.ts"),
  noir: path.join(ROOT, "packages", "liquid-extras", "src", "materials", "NoirWater", "NoirWaterMaterial.ts"),
  oil: path.join(ROOT, "packages", "liquid-extras", "src", "materials", "OilSlick", "OilSlickMaterial.ts"),
  openWaterTs: path.join(ROOT, "packages", "engine", "src", "core", "materials", "liquid", "OpenWaterMaterial.ts"),
  vertGlsl300: path.join(ROOT, "packages", "engine", "src", "core", "materials", "liquid", "shaders", "OpenWater.vert.glsl"),
  vertGlsl100: path.join(ROOT, "packages", "engine", "src", "core", "materials", "liquid", "shaders", "OpenWater.vert.glsl100"),
  vertWgsl: path.join(ROOT, "packages", "engine", "src", "core", "materials", "liquid", "shaders", "OpenWater.vert.wgsl"),
};

// meaning -> required source marker(s). Every registry lane with a known meaning must have all
// of its markers present in the corresponding source, otherwise the declared write is gone.
const MEANING_MARKERS = {
  rampSoftness: [
    [["stylizedTs"], "sA[0] = this.rampSoftness"],
    [["fragGlsl300"], "u_styleA.x"],
  ],
  washAmount: [
    [["stylizedTs"], "sA[1] = this.washAmount"],
    [["fragGlsl300"], "u_styleA.y"],
  ],
  lineDensity: [
    [["stylizedTs"], "sA[2] = this.lineDensity"],
    [["fragGlsl300"], "u_styleA.z"],
  ],
  lineWidth: [
    [["stylizedTs"], "sA[3] = this.lineWidth"],
    [["fragGlsl300"], "u_styleA.w"],
    [["fragGlsl100"], "u_styleA.w"],
    [["fragWgsl"], "styleA.w"],
  ],
  "styleId (float selector)": [[["stylizedTs"], "sB[3] = this.styleId"]],
  "posterizeSteps (extension carve-out)": [
    [["noir"], "[3] = this._posterizeSteps"],
    [["noir"], "inkSteps"],
    [["noir"], "u_styleA.w"],
  ],
  "iridescenceStrength (extension carve-out)": [
    [["oil"], "iridescenceStrength"],
    [["oil"], "u_styleA.w"],
  ],
  "splat (OpenWater impact ring)": [
    [["openWaterTs"], "styleA[3] = this._splat[3]"],
    [["vertGlsl300"], "u_styleA.w"],
    [["vertGlsl100"], "u_styleA.w"],
    [["vertWgsl"], "styleA.w"],
  ],
  "poolHalfExtent (OpenWater clapotis walls)": [
    [["openWaterTs"], "_matParam2Array[3] = this.poolHalfExtent"],
    [["vertGlsl300"], "u_matParam2.w"],
    [["vertGlsl100"], "u_matParam2.w"],
    [["vertWgsl"], "matParam2.w"],
  ],
};

const violations = [];
const warnings = [];
const sourceCache = {};

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function readSource(key) {
  if (key in sourceCache) return sourceCache[key];
  const file = SCAN_TARGETS[key];
  if (!file || !fs.existsSync(file)) {
    throw new Error(`scan target missing: ${key}`);
  }
  // Markers are matched against CODE only: a marker that survives solely in a comment (e.g. a
  // lane write that was deleted but still documented) must not satisfy the gate.
  sourceCache[key] = stripComments(fs.readFileSync(file, "utf8"));
  return sourceCache[key];
}

function main() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error(`Registry file missing: ${REGISTRY_PATH}`);
    process.exit(2);
  }

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  } catch (err) {
    console.error(`Registry JSON unreadable: ${err.message}`);
    process.exit(2);
  }

  const lanes = registry.lanes ?? [];
  if (!Array.isArray(lanes) || 0 === lanes.length) {
    violations.push("registry has no lanes array");
  }

  // 1. Every declared lane write must exist in the sources ("never silent delete", G3).
  for (const lane of lanes) {
    if (!lane.meaning || !lane.materialTypes || !Array.isArray(lane.materialTypes)) {
      violations.push(`lane ${lane.lane ?? "?"} missing meaning/materialTypes`);
      continue;
    }
    if (typeof lane.evictionPolicy !== "string" || 0 === lane.evictionPolicy.length) {
      violations.push(`lane ${lane.lane}/${lane.meaning} has empty evictionPolicy (G3 rule)`);
    } else if (!lane.evictionPolicy.includes("never silent delete") && !lane.evictionPolicy.includes("never evicted")) {
      violations.push(`lane ${lane.lane}/${lane.meaning} evictionPolicy weakens G3 ('never silent delete'/selector)`);
    }

    const markers = MEANING_MARKERS[lane.meaning];
    if (!markers) {
      violations.push(`meaning '${lane.meaning}' (${lane.lane}) has no marker mapping in scan.js - an unverified lane would pass silently`);
      continue;
    }
    for (const [fileKeys, marker] of markers) {
      const found = fileKeys.some((key) => readSource(key).includes(marker));
      if (!found) {
        violations.push(`lane write missing: ${lane.lane} = '${lane.meaning}' marker '${marker}' not found in ${fileKeys.join("/")}`);
      }
    }
  }

  // 2. Lane collisions: multiple meanings on one lane require a declared carve-out.
  const byLane = {};
  for (const lane of lanes) {
    (byLane[lane.lane] ??= []).push(lane);
  }
  for (const [laneName, entries] of Object.entries(byLane)) {
    if (entries.length <= 1) continue;
    // u_styleA.w: the registered triple-meaning (base + Noir + Oil carve-out) is expected.
    if (laneName === "u_styleA.w") {
      const hasBase = entries.some((e) => e.materialTypes.includes("StylizedWaterMaterial") && !e.styleIds.includes(3));
      const hasNoir = entries.some((e) => e.materialTypes.includes("NoirWaterMaterial") && e.styleIds.includes(3) && e.collision);
      const hasOil = entries.some((e) => e.materialTypes.includes("OilSlickMaterial") && e.styleIds.includes(3) && e.collision);
      if (!hasBase) violations.push("u_styleA.w: missing base (StylizedWaterMaterial) meaning");
      if (!hasNoir) violations.push("u_styleA.w: missing registered Noir carve-out (styleIds [3], collision field)");
      if (!hasOil) violations.push("u_styleA.w: missing registered Oil carve-out (styleIds [3], collision field)");
    } else {
      const uncollided = entries.filter((e) => !e.collision);
      if (uncollided.length > 1) {
        violations.push(`lane ${laneName}: ${uncollided.length} meanings without a declared collision carve-out`);
      }
    }
  }

  // 3. Future/Active registrations must exist (S2 splat lane, S3 wall contract).
  const registrations = registry.registration ?? [];
  for (const expected of ["s2-splat-lane", "s3-wall-contract"]) {
    if (!registrations.some((r) => r.id === expected && (r.status === "reserved" || r.status === "active"))) {
      violations.push(`required registration missing: ${expected} (status 'reserved' or 'active')`);
    }
  }

  // 4. Selector lane must cover all published styleIds 0..5.
  const selector = lanes.find((l) => l.lane === "u_styleB.w");
  if (!selector) {
    violations.push("u_styleB.w selector lane missing from registry");
  } else {
    const ids = (selector.styleIds ?? []).map((x) => Number(x));
    for (const id of [0, 1, 2, 3, 4, 5]) {
      if (!ids.includes(id)) violations.push(`u_styleB.w selector lane does not cover styleId ${id}`);
    }
  }

  // 5. Layout file must still declare the style lanes (registry would be stale otherwise).
  const layout = readSource("layout");
  if (!layout.includes("u_styleA") || !layout.includes("u_styleB")) {
    violations.push("StandardWebGPULayout.ts no longer declares u_styleA/u_styleB - registry stale");
  }

  for (const w of warnings) console.warn(`[WARN] ${w}`);
  for (const v of violations) console.error(`[VIOLATION] ${v}`);

  console.log(`\nLane-Contract scan: ${lanes.length} lanes declared, ${violations.length} violations, ${warnings.length} warnings.`);
  if (violations.length > 0) process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(`Lane-Contract scan crashed: ${err.message}`);
  process.exit(2);
}

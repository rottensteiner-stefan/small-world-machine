// T3 Lane-Contract-Registry (hard gate before Block S).
//
// Runs scripts/lane-contracts/scan.js against the real sources and asserts registry
// integrity. Mirrors the "engine <-> liquid-extras" boundary defined in
// .agents/collaborate/liquid-roadmap.md §8.2/T3 and §8.5 G3:
//   - every declared lane write must exist (never silent delete)
//   - multi-meaning lanes require a declared carve-out
//   - S2 splat lane + S3 wall contract are registered as reserved
//   - eviction policies never weaken below "rehome-to-per-style-constant"
// The scanner is a plain Node tool intentionally invoked as a child process so the test
// does not depend on cross-package TS imports.

import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const SCAN_JS = path.join(REPO_ROOT, "scripts", "lane-contracts", "scan.js");
const REGISTRY_JSON = path.join(REPO_ROOT, "scripts", "lane-contracts", "lane-contracts.json");

interface ContractLane {
  lane: string;
  meaning: string;
  materialTypes: string[];
  styleIds: number[];
  evictionPolicy: string;
  collision?: string;
}

interface LaneRegistryDoc {
  lanes: ContractLane[];
  registration: Array<{ id: string; status: string; purpose?: string; note?: string }>;
}

describe("Lane-Contract-Registry (T3)", () => {
  let registry: LaneRegistryDoc;

  beforeAll(() => {
    registry = JSON.parse(fs.readFileSync(REGISTRY_JSON, "utf8"));
  });

  it("scans the real engine + extension sources without violations (exit 0)", async () => {
    const { stdout, stderr } = await execFileAsync("node", [SCAN_JS], { cwd: REPO_ROOT });
    expect(stderr).toBe("");
    expect(stdout).toContain("0 violations");
  }, 30000);

  it("declares the complete base + extension lane set", () => {
    const lanes = registry.lanes;
    expect(Array.isArray(lanes)).toBe(true);
    expect(lanes.length).toBeGreaterThanOrEqual(7);

    const meanings = lanes.map((l) => l.meaning);
    for (const expected of [
      "rampSoftness",
      "washAmount",
      "lineDensity",
      "lineWidth",
      "styleId (float selector)",
      "posterizeSteps (extension carve-out)",
      "iridescenceStrength (extension carve-out)",
      "splat (OpenWater impact ring)",
      "poolHalfExtent (OpenWater clapotis walls)",
    ]) {
      expect(meanings).toContain(expected);
    }
  });

  it("keeps the u_styleA.w triple-meaning explicitly collision-registered", () => {
    const wLanes = registry.lanes.filter((l) => l.lane === "u_styleA.w");
    expect(wLanes.length).toBe(3);
    for (const lane of wLanes) {
      expect(lane.styleIds).toContain(lane.materialTypes.includes("StylizedWaterMaterial") ? 0 : 3);
      if (!lane.materialTypes.includes("StylizedWaterMaterial")) {
        expect(lane.collision).toBeDefined();
      }
    }
  });

  it("covers every published styleId in the selector lane", () => {
    const selector = registry.lanes.find((l) => l.lane === "u_styleB.w");
    expect(selector).toBeDefined();
    const ids = selector!.styleIds.map((n: number) => Number(n));
    for (const id of [0, 1, 2, 3, 4, 5]) expect(ids).toContain(id);
  });

  it("registers the S2 splat lane and S3 wall contract", () => {
    const reg = registry.registration ?? [];
    const ids = new Set(reg.map((r: { id: string }) => r.id));
    expect(ids.has("s2-splat-lane")).toBe(true);
    expect(ids.has("s3-wall-contract")).toBe(true);
    for (const r of reg.filter((x: { id: string }) =>
      ["s2-splat-lane", "s3-wall-contract"].includes(x.id),
    )) {
      expect(["reserved", "active"]).toContain(r.status);
    }
  });

  it("registers the OpenWater splat and wall lanes for OpenWaterMaterial only", () => {
    for (const lane of ["u_styleA.xyzw", "u_matParam2.w"]) {
      const entries = registry.lanes.filter((l) => l.lane === lane);
      expect(entries.length).toBe(1);
      expect(entries[0]!.materialTypes).toEqual(["OpenWaterMaterial"]);
    }
  });

  it("never weakens eviction policies below the G3 floor", () => {
    for (const lane of registry.lanes) {
      expect(typeof lane.evictionPolicy).toBe("string");
      const p = lane.evictionPolicy;
      expect(p.length).toBeGreaterThan(0);
      expect(p.includes("never silent delete") || p.includes("never evicted")).toBe(true);
    }
  });
});

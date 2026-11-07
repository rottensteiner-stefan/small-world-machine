import { describe, expect, it } from "vitest";
import { decide } from "../../.agents/scripts/goldens/skip-check.js";

describe("scripts/goldens/skip-check.js decide() (Diff-Gate, keine falsch-grünen Skips)", () => {
  const head = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const baseline = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  it("runs when the baseline commit cannot be resolved", () => {
    const r = decide({ baselineCommit: "", head, shallow: false, changed: [] });
    expect(r.shouldRun).toBe(true);
  });

  it("runs - never skips - in a shallow clone where history cannot distinguish HEAD from the baseline", () => {
    // Regressionsfall aus dem ersten realen CI-Lauf (2026-10-18): fetch-depth 1 liess git log
    // HEAD als Baseline melden -> falsches Grün trotz 538 geänderter Shader/Engine-Dateien.
    const r = decide({ baselineCommit: head, head, shallow: true, changed: [] });
    expect(r.shouldRun).toBe(true);
    expect(r.reason).toContain("shallow checkout");
  });

  it("skips in a shallow clone when a real (non-HEAD) baseline commit resolves", () => {
    const r = decide({ baselineCommit: baseline, head, shallow: true, changed: ["README.md"] });
    expect(r.shouldRun).toBe(false);
  });

  it("skips when HEAD is the baseline commit in a full clone (nothing after it)", () => {
    const r = decide({ baselineCommit: head, head, shallow: false, changed: [] });
    expect(r.shouldRun).toBe(false);
  });

  it("runs when a build-input path changed", () => {
    const r = decide({
      baselineCommit: baseline,
      head,
      shallow: false,
      changed: ["packages/engine/src/SmallWorldMachine.ts"],
    });
    expect(r.shouldRun).toBe(true);
  });

  it("skips when only non-build-input paths changed", () => {
    const r = decide({
      baselineCommit: baseline,
      head,
      shallow: false,
      changed: ["docs/guides/configuration.md"],
    });
    expect(r.shouldRun).toBe(false);
  });
});

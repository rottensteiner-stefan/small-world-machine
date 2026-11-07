import { describe, expect, it } from "vitest";
import { readSource } from "../math/_shaderScalar.js";

// Verifies docs/reference/tier-parity.json against the real sources. Presence cells must match,
// absence cells must NOT match: closing a documented gap (or regressing a present capability)
// turns this red until the matrix is updated, so the matrix cannot silently go stale.

type Tier = "webgpu" | "webgl2" | "webgl1";
interface Cell {
  state: "present" | "absent" | "na";
  file?: string;
  pattern?: string;
  class?: "gap" | "deliberate" | "undecided";
  finding?: string;
  reason?: string;
}
interface Matrix {
  features: Record<string, Record<Tier, Cell>>;
}

const matrix = JSON.parse(readSource("docs/reference/tier-parity.json")) as Matrix;
const TIERS: readonly Tier[] = ["webgpu", "webgl2", "webgl1"];

describe("tier parity matrix", () => {
  for (const [feature, cells] of Object.entries(matrix.features)) {
    for (const tier of TIERS) {
      const cell = cells[tier];
      it(`${feature} / ${tier}`, () => {
        expect(cell, "cell missing").toBeDefined();
        if (cell.state === "na") {
          expect(cell.reason, "na needs reason").toBeTruthy();
          return;
        }
        const src = readSource(cell.file as string);
        const re = new RegExp(cell.pattern as string);
        if (cell.state === "present") {
          expect(re.test(src), `${cell.file} lost /${cell.pattern}/`).toBe(true);
          return;
        }
        expect(cell.class, "absent needs class").toBeDefined();
        expect(cell.reason, "absent needs reason").toBeTruthy();
        if (cell.class === "gap") expect(cell.finding, "gap needs finding id").toBeTruthy();
        expect(
          re.test(src),
          `${feature}/${tier} now implemented (/${cell.pattern}/ found): update tier-parity.json`,
        ).toBe(false);
      });
    }
  }
});

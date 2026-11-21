import { describe, it, expect } from "vitest";
import { CubeLutParser } from "../../src/loaders/CubeLutParser.js";

describe("CubeLutParser", () => {
  it("parses a standard 2x2x2 .cube file correctly", () => {
    const cubeText = `
# Comment at top
TITLE "Test 2x2x2 LUT"
LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0

# 8 entries: r changes fastest, then g, then b
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;
    const res = CubeLutParser.parseDetailed(cubeText);
    expect(res.lut.size).toBe(2);
    expect(res.lut.title).toBe("Test 2x2x2 LUT");
    expect(res.lut.data.length).toBe(2 * 2 * 2 * 4);
    expect(res.domainMin).toEqual([0.0, 0.0, 0.0]);
    expect(res.domainMax).toEqual([1.0, 1.0, 1.0]);

    // Check first entry (0, 0, 0)
    expect(res.lut.data[0]).toBe(0.0);
    expect(res.lut.data[1]).toBe(0.0);
    expect(res.lut.data[2]).toBe(0.0);
    expect(res.lut.data[3]).toBe(1.0);

    // Check second entry (1, 0, 0)
    expect(res.lut.data[4]).toBe(1.0);
    expect(res.lut.data[5]).toBe(0.0);
    expect(res.lut.data[6]).toBe(0.0);
    expect(res.lut.data[7]).toBe(1.0);

    // Check last entry (1, 1, 1)
    const last = 7 * 4;
    expect(res.lut.data[last]).toBe(1.0);
    expect(res.lut.data[last + 1]).toBe(1.0);
    expect(res.lut.data[last + 2]).toBe(1.0);
    expect(res.lut.data[last + 3]).toBe(1.0);
  });

  it("throws when LUT_3D_SIZE is missing", () => {
    const invalidText = `
# No size
0.0 0.0 0.0
`;
    expect(() => CubeLutParser.parse(invalidText)).toThrow("missing LUT_3D_SIZE");
  });

  it("throws when data is truncated", () => {
    const truncatedText = `
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
`;
    expect(() => CubeLutParser.parse(truncatedText)).toThrow("truncated .cube data");
  });

  it("rejects 1D LUTs with a clean error message", () => {
    const oneD = `
LUT_1D_SIZE 1024
0.0 0.0 0.0
`;
    expect(() => CubeLutParser.parse(oneD)).toThrow("1D LUTs (LUT_1D_SIZE) are not supported");
  });
});

import { DepthMaterial } from "../../src/core/materials/DepthMaterial.js";

describe("DepthMaterial", () => {
  it("should properly map properties to RenderManifest", () => {
    const material = new DepthMaterial({
      alphaTest: 0.1,
    });

    const manifest = material.getRenderManifest();

    // Check alphaTest is mapped to u_extraParams.y
    const extraParams = manifest.properties["u_extraParams"] as number[];
    expect(extraParams[1]).toBeCloseTo(0.1, 5);

    // Depth material should ALWAYS write depth and NEVER be transparent
    expect(manifest.state?.depthWrite).toBe(true);
    expect(manifest.state?.depthTest).toBe(true);
    expect(manifest.state?.transparent).toBe(false);
  });
});

import { DepthMaterial } from "../../src/core/materials/DepthMaterial.js";
import { MaterialType } from "../../src/enums/index.js";
import { Texture } from "../../src/core/textures/Texture.js";

describe("DepthMaterial", () => {
  it("should initialize with default values", () => {
    const material = new DepthMaterial();

    expect(material.type).toBe(MaterialType.DEPTH);
    expect(material.alphaTest).toBe(0.0);
    expect(material.diffuseMap).toBeUndefined();
  });

  it("should initialize with custom options", () => {
    const texture = Texture.empty();
    const material = new DepthMaterial({
      alphaTest: 0.5,
      diffuseMap: texture,
    });

    expect(material.alphaTest).toBe(0.5);
    expect(material.diffuseMap).toBe(texture);
  });

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

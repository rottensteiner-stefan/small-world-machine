import type { StandardMaterialOptions } from "../../src/core/materials/surface/StandardMaterial.js";
import { StandardMaterial } from "../../src/core/materials/surface/StandardMaterial.js";
import { Color } from "../../src/core/colors/Color.js";
import { Texture } from "../../src/core/textures/Texture.js";
import { BlendingMode, MaterialType } from "../../src/enums/index.js";

describe("StandardMaterial", () => {
  it("should initialize with default values", () => {
    const material = new StandardMaterial();

    expect(material.type).toBe(MaterialType.STANDARD);
    expect(material.color.r).toBe(1.0);
    expect(material.color.g).toBe(1.0);
    expect(material.color.b).toBe(1.0);
    expect(material.metallic).toBe(0.0);
    expect(material.roughness).toBe(0.5);
    expect(material.ao).toBe(1.0);
    expect(material.emissiveColor.r).toBe(0.0);
    expect(material.emissiveIntensity).toBe(1.0);
    expect(material.transparent).toBe(false);
  });

  it("should initialize with custom values", () => {
    const customColor = new Color(0.1, 0.2, 0.3);
    const emissiveColor = new Color(1.0, 0.0, 0.0);
    const emissiveTexture = Texture.empty();

    const options: StandardMaterialOptions = {
      color: customColor,
      metallic: 0.8,
      roughness: 0.2,
      emissiveColor: emissiveColor,
      emissiveMap: emissiveTexture,
      emissiveIntensity: 2.5,
      transparent: true,
    };

    const material = new StandardMaterial(options);

    expect(material.color).toBe(customColor);
    expect(material.metallic).toBe(0.8);
    expect(material.roughness).toBe(0.2);
    expect(material.emissiveColor).toBe(emissiveColor);
    expect(material.emissiveMap).toBe(emissiveTexture);
    expect(material.emissiveIntensity).toBe(2.5);
    expect(material.transparent).toBe(true);
  });

  it("should ignore 'emissive' in options and require 'emissiveColor' (regression test)", () => {
    // This test ensures we don't accidentally pass 'emissive' to the constructor
    // which was a previous bug in Showcase 20.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const options: any = {
      emissive: new Color(1.0, 1.0, 1.0),
    };
    const material = new StandardMaterial(options);

    // 'emissiveColor' should remain the default (black) because 'emissive' is ignored
    expect(material.emissiveColor.r).toBe(0.0);
    expect(material.emissiveColor.g).toBe(0.0);
    expect(material.emissiveColor.b).toBe(0.0);
  });

  it("should properly map properties to RenderManifest", () => {
    const emissiveColor = new Color(0.5, 0.6, 0.7);
    const material = new StandardMaterial({
      emissiveColor,
      emissiveIntensity: 3.0,
      transparent: true,
    });

    const manifest = material.getRenderManifest();

    // Check specColor mapping
    const specColor = manifest.properties["u_specColor"] as Float32Array;
    expect(specColor[0]).toBeCloseTo(0.5, 5); // R
    expect(specColor[1]).toBeCloseTo(0.6, 5); // G
    expect(specColor[2]).toBeCloseTo(0.7, 5); // B
    expect(specColor[3]).toBeCloseTo(3.0, 5); // Intensity

    // Check state mapping
    expect(manifest.state?.transparent).toBe(true);
    expect(manifest.state?.blending).toBe(BlendingMode.ALPHA);
    expect(manifest.state?.depthWrite).toBe(false);
  });

  it("should disable depthWrite and enable ALPHA blending only when transparent is true", () => {
    const opaqueMaterial = new StandardMaterial({ transparent: false });
    const opaqueManifest = opaqueMaterial.getRenderManifest();

    expect(opaqueManifest.state?.transparent).toBe(false);
    expect(opaqueManifest.state?.blending).toBe(BlendingMode.OPAQUE);
    expect(opaqueManifest.state?.depthWrite).toBe(true);
  });

  it("should support Clearcoat, Sheen, Transmission, Volume, and IOR parameters and clone them correctly", () => {
    const mat = new StandardMaterial({
      clearcoat: 0.75,
      clearcoatRoughness: 0.1,
      sheenColor: new Color(0.9, 0.8, 0.7),
      sheenRoughness: 0.3,
      transmission: 0.95,
      ior: 1.45,
      thickness: 1.2,
      attenuationDistance: 5.0,
      attenuationColor: new Color(0.2, 0.5, 0.8),
    });

    expect(mat.clearcoat).toBe(0.75);
    expect(mat.clearcoatRoughness).toBe(0.1);
    expect(mat.sheenColor.r).toBeCloseTo(0.9);
    expect(mat.sheenRoughness).toBe(0.3);
    expect(mat.transmission).toBe(0.95);
    expect(mat.ior).toBe(1.45);
    expect(mat.thickness).toBe(1.2);
    expect(mat.attenuationDistance).toBe(5.0);
    expect(mat.attenuationColor.g).toBeCloseTo(0.5);

    const manifest = mat.getRenderManifest();
    expect(manifest.flags).toContain("USE_CLEARCOAT");
    expect(manifest.flags).toContain("USE_SHEEN");
    expect(manifest.flags).toContain("USE_TRANSMISSION");

    const liquidParams = manifest.properties["u_liquidParams"] as number[];
    expect(liquidParams[0]).toBe(1.45); // ior
    expect(liquidParams[1]).toBe(1.2); // thickness
    expect(liquidParams[2]).toBe(0.95); // transmission
    expect(liquidParams[3]).toBe(0.75); // clearcoat

    const thresholds = manifest.properties["u_thresholds"] as number[];
    expect(thresholds[0]).toBe(0.1); // clearcoatRoughness
    expect(thresholds[1]).toBe(0.3); // sheenRoughness
    expect(thresholds[2]).toBe(5.0); // attenuationDistance

    const copy = mat.clone();
    expect(copy.clearcoat).toBe(0.75);
    expect(copy.clearcoatRoughness).toBe(0.1);
    expect(copy.sheenRoughness).toBe(0.3);
    expect(copy.transmission).toBe(0.95);
    expect(copy.ior).toBe(1.45);
    expect(copy.thickness).toBe(1.2);
    expect(copy.attenuationDistance).toBe(5.0);
    expect(copy.attenuationColor.b).toBeCloseTo(0.8);
  });

  it("should keep u_specColor emissive-only and enable sheen only via the sheenColor setup (decoupling)", () => {
    // ADR 0039 sheen decision: an emissive-only material must no longer derive a sheen lobe on
    // WebGL1/WebGPU (which previously gated sheen on emissive.rgb > 0). The typed u_matParam10 lane
    // carries tint rgb + an enable w-flag that mirrors the USE_SHEEN push basis exactly.
    const material = new StandardMaterial({
      emissiveColor: new Color(1.0, 0.0, 0.0),
      emissiveIntensity: 2.0,
    });

    const manifest = material.getRenderManifest();
    const specColor = manifest.properties["u_specColor"] as Float32Array;
    expect(specColor[0]).toBeCloseTo(1.0, 5);
    expect(specColor[3]).toBeCloseTo(2.0, 5);

    const sheenLane = manifest.properties["u_matParam10"] as number[];
    expect(sheenLane[3]).toBe(0); // no sheen activation
    expect(manifest.flags).not.toContain("USE_SHEEN");
  });

  it("should pack sheenColor into the u_matParam10 lane and keep u_specColor emissive-only", () => {
    const material = new StandardMaterial({
      emissiveColor: new Color(1.0, 0.5, 0.2),
      sheenColor: new Color(0.9, 0.8, 0.7),
      sheenRoughness: 0.3,
    });

    const manifest = material.getRenderManifest();
    const sheenLane = manifest.properties["u_matParam10"] as number[];
    expect(sheenLane[0]).toBeCloseTo(0.9, 5);
    expect(sheenLane[1]).toBeCloseTo(0.8, 5);
    expect(sheenLane[2]).toBeCloseTo(0.7, 5);
    expect(sheenLane[3]).toBe(1); // enable
    expect(manifest.flags).toContain("USE_SHEEN");

    const specColor = manifest.properties["u_specColor"] as Float32Array;
    expect(specColor[0]).toBeCloseTo(1.0, 5);
    expect(specColor[1]).toBeCloseTo(0.5, 5);
    expect(specColor[2]).toBeCloseTo(0.2, 5);
  });

  it("should enable sheen from sheenColorMap alone even with sheenColor set to black", () => {
    const material = new StandardMaterial({
      sheenColorMap: Texture.empty(),
    });

    const manifest = material.getRenderManifest();
    const sheenLane = manifest.properties["u_matParam10"] as number[];
    expect(sheenLane[3]).toBe(1);
    expect(manifest.flags).toContain("USE_SHEEN");
    expect(manifest.flags).toContain("USE_SHEEN_COLOR_MAP");
    expect(manifest.flags).not.toContain("USE_COLOR_MAP");
  });
});

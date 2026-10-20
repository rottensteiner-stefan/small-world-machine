import { describe, it, expect } from "vitest";
import type { Texture } from "@small-world-machine/engine";
import { ImpastoStrokeMaterial } from "../src/materials/ImpastoStrokeMaterial.js";

function fakeTexture(width: number, height: number): Texture {
  return {
    image: { width, height },
    offset: { x: 0, y: 0 },
    repeat: { x: 1, y: 1 },
  } as unknown as Texture;
}

describe("ImpastoStrokeMaterial", () => {
  it("initializes with intended default parameters", () => {
    const mat = new ImpastoStrokeMaterial();

    expect(mat.type).toBe("ImpastoStrokeMaterial");
    expect(mat.brushRelief).toBe(1.0);
    expect(mat.smearDistance).toBe(0.28);
    expect(mat.edgeLift).toBe(0.9);
    expect(mat.paintOpacity).toBe(0.92);
    expect(mat.metallic).toBe(0.55);
    expect(mat.roughness).toBe(0.5);
  });

  it("reuses the fixed material texture slots for its three layers", () => {
    const paint = fakeTexture(512, 384);
    const dir = fakeTexture(512, 384);
    const base = fakeTexture(512, 384);
    const mat = new ImpastoStrokeMaterial({ paintMap: paint, dirMap: dir, baseMap: base });

    const manifest = mat.getRenderManifest();
    expect(manifest.shaderId).toBe("ImpastoStrokeMaterial");
    expect(manifest.textures["u_diffuseMap"]).toBe(paint);
    expect(manifest.textures["u_emissiveMap"]).toBe(dir);
    expect(manifest.textures["u_aoMap"]).toBe(base);
  });

  it("packs continuous parameters and the paint resolution reciprocal into manifest lanes", () => {
    const mat = new ImpastoStrokeMaterial({
      paintMap: fakeTexture(1024, 768),
      dirMap: fakeTexture(1024, 768),
      baseMap: fakeTexture(1024, 768),
      brushRelief: 1.4,
      smearDistance: 0.5,
      edgeLift: 1.2,
      paintOpacity: 0.8,
      metallic: 0.7,
      roughness: 0.35,
    });
    mat.time = 3.25;

    const manifest = mat.getRenderManifest();
    const styleA = manifest.properties["u_styleA"] as number[];
    expect(styleA[0]).toBe(1.4);
    expect(styleA[1]).toBe(0.5);
    expect(styleA[2]).toBe(1.2);
    expect(styleA[3]).toBe(0.8);

    const styleB = manifest.properties["u_styleB"] as number[];
    expect(styleB[0]).toBeCloseTo(1 / 1024, 9);
    expect(styleB[1]).toBeCloseTo(1 / 768, 9);

    expect(manifest.properties["u_metallic"]).toBe(0.7);
    expect(manifest.properties["u_roughness"]).toBe(0.35);
    expect(manifest.properties["u_time"]).toBe(3.25);
  });

  it("degrades the reciprocal lanes to 1.0 when no paint canvas is provided", () => {
    const mat = new ImpastoStrokeMaterial();
    const manifest = mat.getRenderManifest();
    const styleB = manifest.properties["u_styleB"] as number[];
    expect(styleB[0]).toBe(1.0);
    expect(styleB[1]).toBe(1.0);
  });

  it("provides valid shader definitions for all three API tiers", () => {
    const mat = new ImpastoStrokeMaterial();
    const def = mat.getShaderDefinition();

    expect(def.id).toBe("ImpastoStrokeMaterial");
    expect(def.sources.glsl300?.fs).toContain("u_emissiveMap");
    expect(def.sources.glsl100?.fs).toContain("u_emissiveMap");
    expect(def.sources.wgsl).toContain("u_emissiveMap");
    expect(def.layout.textures).toHaveProperty("u_diffuseMap");
    expect(def.layout.textures).toHaveProperty("u_emissiveMap");
    expect(def.layout.textures).toHaveProperty("u_aoMap");
  });
});

import { describe, it, expect } from "vitest";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { BasicMaterial } from "../../src/core/materials/surface/BasicMaterial.js";
import { CustomShaderMaterial } from "../../src/core/materials/CustomShaderMaterial.js";
import { MaterialType } from "../../src/enums/index.js";

describe("ShaderRegistry ownership (ADR 0032)", () => {
  it("does not learn about a material just because it was constructed", () => {
    new BasicMaterial();
    expect(new ShaderRegistry().get(MaterialType.BASIC)).toBeUndefined();
  });

  it("only knows the providers its own engine handed over", () => {
    const a = new ShaderRegistry();
    const b = new ShaderRegistry();
    a.ensureProvider(MaterialType.BASIC, new BasicMaterial());
    expect(a.get(MaterialType.BASIC)?.id).toBe(MaterialType.BASIC);
    expect(b.get(MaterialType.BASIC)).toBeUndefined();
  });

  it("keeps the first provider of an id and never overrides a registered definition", () => {
    const registry = new ShaderRegistry();
    const first = new BasicMaterial();
    registry.ensureProvider(MaterialType.BASIC, first);
    registry.ensureProvider(MaterialType.BASIC, new BasicMaterial());
    const def = registry.get(MaterialType.BASIC)!;
    expect(def).toEqual(first.getShaderDefinition());

    const other = new ShaderRegistry();
    other.register({ ...def, id: "custom-id" });
    other.ensureProvider("custom-id", new BasicMaterial());
    expect(other.get("custom-id")).toEqual({ ...def, id: "custom-id" });
  });

  it("does not retain per-instance custom shader materials process-wide", () => {
    const materials = Array.from(
      { length: 50 },
      () =>
        new CustomShaderMaterial({
          sources: { wgsl: "fn test() {}" },
          layout: { uniforms: {}, textures: {} },
        }),
    );
    const fresh = new ShaderRegistry();
    for (const m of materials) expect(fresh.get(m.type)).toBeUndefined();
  });
});

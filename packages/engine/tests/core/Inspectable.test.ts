import { describe, it, expect } from "vitest";
import { collectInspectorSchema } from "../../src/core/Inspectable.js";
import { Object3D } from "../../src/core/Object3D.js";
import { PointLight } from "../../src/core/lights/PointLight.js";
import { StandardMaterial } from "../../src/core/materials/surface/StandardMaterial.js";
import { PhongMaterial } from "../../src/core/materials/surface/PhongMaterial.js";

describe("collectInspectorSchema", () => {
  it("exposes Object3D's own base schema for a plain Object3D", () => {
    const schema = collectInspectorSchema(new Object3D("Plain"));

    expect(schema["isVisible"]).toEqual({ type: "boolean", label: "Visible" });
    expect(schema["position"]?.type).toBe("vec3");
    expect(schema["rotation"]?.type).toBe("vec3");
    expect(schema["scale"]?.type).toBe("vec3");
    expect(schema["castShadow"]?.row).toBe("shadows");
    expect(schema["receiveShadow"]?.row).toBe("shadows");
  });

  it("merges Object3D + AbstractLight + PointLight fields for a PointLight instance", () => {
    const schema = collectInspectorSchema(new PointLight());

    // Base Object3D fields still present.
    expect(schema["isVisible"]).toBeDefined();
    expect(schema["position"]).toBeDefined();
    // AbstractLight's own fields.
    expect(schema["color"]).toEqual({ type: "color", label: "Color" });
    expect(schema["intensity"]?.type).toBe("number");
    // PointLight's own fields, on top of both ancestors.
    expect(schema["distance"]?.type).toBe("number");
    expect(schema["decay"]?.type).toBe("number");
  });

  it("merges AbstractMaterial + StandardMaterial fields for a StandardMaterial instance", () => {
    const schema = collectInspectorSchema(new StandardMaterial());

    expect(schema["color"]).toEqual({ type: "color", label: "Color" });
    expect(schema["transparent"]?.type).toBe("boolean");
    expect(schema["metallic"]?.type).toBe("number");
    expect(schema["roughness"]?.type).toBe("number");
  });

  it("keeps sibling material subclasses' own fields distinct", () => {
    const phongSchema = collectInspectorSchema(new PhongMaterial());

    expect(phongSchema["shininess"]).toBeDefined();
    expect(phongSchema["specularColor"]).toEqual({ type: "color", label: "Specular" });
    // PhongMaterial never declared these -- they belong to StandardMaterial only.
    expect(phongSchema["metallic"]).toBeUndefined();
    expect(phongSchema["roughness"]).toBeUndefined();
  });
});

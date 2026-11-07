import "../../src/index.js";
import { describe, expect, it } from "vitest";
import { Color } from "../../src/core/colors/Color.js";
import { AmbientLight } from "../../src/core/lights/AmbientLight.js";
import { PointLight } from "../../src/core/lights/PointLight.js";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import { WebGL1Renderer } from "../../src/renderers/WebGL1/WebGL1Renderer.js";
import { WorldWriter } from "../../src/loaders/WorldWriter.js";
import { Object3D } from "../../src/core/Object3D.js";
import { StandardMaterial } from "../../src/core/materials/surface/StandardMaterial.js";
import type { LightDataInterface } from "../../src/interfaces/index.js";
import { Cube } from "../../src/geometry/index.js";

// ADR 0049 (Unity/Godot convention): every engine Color is sRGB-authored and converted to linear
// exactly once -- in the shader for material colours, on the CPU for lights, clear colour and the
// volumetric/post tints -- and glTF's linear factors are encoded once on import.

const lin = (c: number): number => Math.pow(c, 2.2);

type LaneInternals = {
  postProcessing: { enabled: boolean };
  _quality: { gamma: number };
  _clearColor: Color;
  readonly targetClearColor: Color;
  readonly outputGamma: number;
};

function rendererOf(proto: object, ppEnabled: boolean): LaneInternals {
  const r = Object.create(proto) as LaneInternals;
  r.postProcessing = { enabled: ppEnabled };
  r._quality = { gamma: 2.2 };
  r._clearColor = new Color(0.5, 0.25, 1.0, 0.75);
  Object.defineProperty(r, "_targetClearColor", { value: new Color() });
  return r;
}

describe("colour-space contract (ADR 0049)", () => {
  it("Color.toLinear decodes rgb with 2.2 and keeps alpha and HDR values", () => {
    const out = new Color(0.5, 2.0, 0.0, 0.3).toLinear(new Color());
    expect(out.r).toBeCloseTo(lin(0.5), 12);
    expect(out.g).toBeCloseTo(lin(2.0), 12);
    expect(out.b).toBe(0);
    expect(out.a).toBe(0.3);
  });

  it("Color.toTarget is linear for lane 1.0 and the identity for lane 2.2", () => {
    const c = new Color(0.4, 0.6, 0.8);
    const toLinearLane = c.toTarget(1.0, new Color());
    const toDisplayLane = c.toTarget(2.2, new Color());
    expect(toLinearLane.g).toBeCloseTo(lin(0.6), 12);
    expect(toDisplayLane.r).toBeCloseTo(0.4, 12);
    expect(toDisplayLane.b).toBeCloseTo(0.8, 12);
  });

  it("light.linearColor decodes, reuses its instance and follows colour edits", () => {
    const light = new PointLight({ color: new Color(1.0, 0.5, 0.25) });
    const first = light.linearColor;
    expect(first.g).toBeCloseTo(lin(0.5), 12);
    expect(light.linearColor).toBe(first);
    light.color.set(0.2, 0.2, 0.2);
    expect(light.linearColor).toBe(first);
    expect(first.r).toBeCloseTo(lin(0.2), 12);
  });

  it("ambient and directional lights hand the renderers their linear colour", () => {
    const data = { aCol: new Color(), aIntensity: 0 } as unknown as LightDataInterface;
    new AmbientLight({ color: new Color(0.5, 0.5, 0.5), intensity: 0.4 }).applyTo(data);
    expect(data.aCol.r).toBeCloseTo(lin(0.5), 12);
    expect(data.aIntensity).toBe(0.4);
  });

  it("the clear colour lands in the forward pass's output space on every tier", () => {
    const withPost = rendererOf(WebGL2Renderer.prototype, true);
    expect(withPost.outputGamma).toBe(1.0);
    expect(withPost.targetClearColor.r).toBeCloseTo(lin(0.5), 12);
    expect(withPost.targetClearColor.a).toBe(0.75);

    const withoutPost = rendererOf(WebGL2Renderer.prototype, false);
    expect(withoutPost.targetClearColor.g).toBeCloseTo(0.25, 12);

    // WebGL1 encodes with a fixed 2.2 and its post pass never re-encodes.
    const webgl1 = rendererOf(WebGL1Renderer.prototype, true);
    expect(webgl1.outputGamma).toBe(2.2);
    expect(webgl1.targetClearColor.r).toBeCloseTo(0.5, 12);
  });

  it("glTF export writes linear light and emissive factors (import encodes them back)", () => {
    const root = new Object3D("Root");
    root.add(new PointLight({ name: "Lamp", color: new Color(1.0, 0.5, 0.25) }));
    const mesh = new Object3D("Glow");
    mesh.geometry = new Cube({ size: 1 }).getGeometryData();
    const mat = new StandardMaterial({ emissiveColor: new Color(0.5, 0.25, 1.0) });
    mesh.material = mat;
    root.add(mesh);

    const doc = new WorldWriter().write(root);
    const light = doc.extensions?.KHR_lights_punctual?.lights[0];
    expect(light?.color?.[1]).toBeCloseTo(lin(0.5), 12);
    const emissive = doc.materials?.[0]?.emissiveFactor;
    expect(emissive?.[0]).toBeCloseTo(lin(0.5), 12);
    expect(emissive?.[2]).toBeCloseTo(1.0, 12);
  });
});

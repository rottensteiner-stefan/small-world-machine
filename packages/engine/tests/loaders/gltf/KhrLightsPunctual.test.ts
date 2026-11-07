import { describe, it, expect } from "vitest";
import { WorldWriter } from "../../../src/loaders/WorldWriter.js";
import { GltfLoader } from "../../../src/loaders/GltfLoader.js";
import type { GltfData } from "../../../src/loaders/gltf/index.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { PointLight } from "../../../src/core/lights/PointLight.js";
import { Color } from "../../../src/core/colors/Color.js";

describe("KHR_lights_punctual point light round trip", () => {
  it("keeps castShadow, shadowBias, shadowResolution and decay of a PointLight", async () => {
    const root = new Object3D("Root");
    root.add(
      new PointLight({
        name: "Lamp",
        castShadow: true,
        shadowBias: 0.0123,
        shadowResolution: 2048,
        decay: 1.5,
      }),
    );

    const doc = new WorldWriter().write(root);
    const json = JSON.parse(JSON.stringify(doc)) as GltfData["json"];
    const parsed = await new GltfLoader().parse({ json, buffers: [] }, "");

    const light = parsed.children[0] as PointLight;
    expect(light).toBeInstanceOf(PointLight);
    expect(light.castShadow).toBe(true);
    expect(light.shadowBias).toBeCloseTo(0.0123, 6);
    expect(light.shadowResolution).toBe(2048);
    expect(light.decay).toBeCloseTo(1.5, 6);
  });
});

describe("KHR_lights_punctual colour space marker", () => {
  const roundTrip = async (mutate: (json: GltfData["json"]) => void): Promise<PointLight> => {
    const root = new Object3D("Root");
    root.add(new PointLight({ name: "Lamp", color: new Color(0.8, 0.4, 0.2) }));
    const json = JSON.parse(JSON.stringify(new WorldWriter().write(root))) as GltfData["json"];
    mutate(json);
    const parsed = await new GltfLoader().parse({ json, buffers: [] }, "");
    return parsed.children[0] as PointLight;
  };

  it("the writer marks its light colours as linear", async () => {
    const json = JSON.parse(
      JSON.stringify(new WorldWriter().write(new Object3D("Root"))),
    ) as GltfData["json"];
    expect(json.asset?.extras).toEqual({ swmLightColorSpace: "linear" });
  });

  it("a marked file round-trips the authored sRGB colour", async () => {
    const light = await roundTrip(() => undefined);
    expect(light.color.r).toBeCloseTo(0.8, 4);
    expect(light.color.g).toBeCloseTo(0.4, 4);
    expect(light.color.b).toBeCloseTo(0.2, 4);
  });

  it("a legacy maker file (no marker) keeps its raw sRGB colour instead of brightening", async () => {
    const light = await roundTrip((json) => {
      delete json.asset?.extras;
      const lights = json.extensions?.KHR_lights_punctual?.lights;
      lights![0]!.color = [0.8, 0.4, 0.2]; // legacy writer: raw sRGB value
    });
    expect(light.color.r).toBeCloseTo(0.8, 6);
    expect(light.color.g).toBeCloseTo(0.4, 6);
    expect(light.color.b).toBeCloseTo(0.2, 6);
  });

  it("a third-party file without the marker follows the spec (linear)", async () => {
    const light = await roundTrip((json) => {
      json.asset = { version: "2.0", generator: "Blender" };
      const lights = json.extensions?.KHR_lights_punctual?.lights;
      lights![0]!.color = [0.5, 0.5, 0.5];
    });
    expect(light.color.r).toBeGreaterThan(0.7); // linear 0.5 -> sRGB ~0.735
  });
});

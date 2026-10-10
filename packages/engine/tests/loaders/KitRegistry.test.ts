import { describe, it, expect, vi } from "vitest";
import { KitRegistry } from "../../src/loaders/kit/KitRegistry.js";
import { AssetManager } from "../../src/loaders/AssetManager.js";
import { GltfLoader } from "../../src/loaders/GltfLoader.js";
import { Object3D } from "../../src/core/Object3D.js";
import { PointLight } from "../../src/core/lights/PointLight.js";
import { SpotLight } from "../../src/core/lights/SpotLight.js";
import { DirectionalLight } from "../../src/core/lights/DirectionalLight.js";
import { StandardMaterial } from "../../src/core/materials/StandardMaterial.js";
import { KitManifest, PropMeta } from "../../src/loaders/kit/KitTypes.js";

describe("KitRegistry", () => {
  const sampleManifest: KitManifest = {
    id: "bunker",
    name: "Bunker Kit",
    version: "1.0.0",
    description: "Bunker test kit",
    items: [
      {
        id: "bunker/kerosene_lantern",
        name: "Grandfather's Brass Kerosene Lantern",
        category: "lighting",
        path: "kerosene_lantern/model.glb",
        preview: "kerosene_lantern/preview.jpg",
        meta: "kerosene_lantern/meta.json",
      },
      {
        id: "bunker/metal_desk",
        name: "Heavy Metal Desk",
        category: "furniture",
        path: "metal_desk/model.glb",
        preview: "metal_desk/preview.jpg",
        meta: "metal_desk/meta.json",
      },
    ],
    author: "Small World Machine",
    license: "CC0-1.0",
  };

  const lanternMeta: PropMeta = {
    id: "bunker/kerosene_lantern",
    name: "Grandfather's Brass Kerosene Lantern",
    category: "lighting",
    kit: "bunker",
    version: "1.0.0",
    description: "Hurricane lantern",
    triangles: 12000,
    materials: 1,
    textures: ["diffuse", "normal"],
    dimensions: { width: 0.18, height: 0.36, depth: 0.18 },
    recommendedScale: 0.35,
    sockets: [
      {
        name: "FlameGlow",
        position: [0, 0.16, 0],
        recommendedLight: {
          type: "point",
          color: "#d49a3d",
          intensity: 3.5,
          distance: 8.0,
        },
      },
    ],
    author: "Small World Machine",
    license: "CC0-1.0",
  };

  const deskMeta: PropMeta = {
    id: "bunker/metal_desk",
    name: "Heavy Metal Desk",
    category: "furniture",
    kit: "bunker",
    version: "1.0.0",
    description: "Desk",
    triangles: 8000,
    materials: 1,
    textures: ["diffuse", "normal"],
    dimensions: { width: 1.2, height: 0.78, depth: 0.7 },
    recommendedScale: 0.75,
    author: "Small World Machine",
    license: "CC0-1.0",
  };

  const createMockRegistry = (): {
    registry: KitRegistry;
    assetManager: AssetManager;
    gltfLoader: GltfLoader;
  } => {
    const assetManager = new AssetManager();
    const gltfLoader = new GltfLoader({ assetManager });

    vi.spyOn(assetManager, "loadJson").mockImplementation(async (url: string) => {
      if (url.includes("bunker/kit.json")) return sampleManifest;
      if (url.includes("kerosene_lantern/meta.json")) return lanternMeta;
      if (url.includes("metal_desk/meta.json")) return deskMeta;
      throw new Error(`404: ${url}`);
    });

    vi.spyOn(gltfLoader, "load").mockImplementation(async (_url: string) => {
      const root = new Object3D("LoadedMesh");
      const mesh = new Object3D("SubMesh");
      mesh.material = new StandardMaterial({ roughness: 0.5, metallic: 0.2 });
      root.add(mesh);
      return root;
    });

    const registry = new KitRegistry({
      basePath: "/assets/kits/",
      assetManager,
      gltfLoader,
    });

    return { registry, assetManager, gltfLoader };
  };

  it("loads manifest and prop meta with caching", async () => {
    const { registry, assetManager } = createMockRegistry();

    const manifest = await registry.getKitManifest("bunker");
    expect(manifest.id).toBe("bunker");
    expect(manifest.items?.length).toBe(2);

    const meta = await registry.getPropMeta("bunker/kerosene_lantern");
    expect(meta.id).toBe("bunker/kerosene_lantern");
    expect(meta.recommendedScale).toBe(0.35);
    expect(meta.sockets?.length).toBe(1);

    // Call again to verify cache
    await registry.getKitManifest("bunker");
    await registry.getPropMeta("bunker/kerosene_lantern");
    expect(assetManager.loadJson).toHaveBeenCalledTimes(2);
  });

  it("loads a prop and automatically applies recommendedScale and socket lights", async () => {
    const { registry } = createMockRegistry();

    const instance = await registry.loadProp("bunker/kerosene_lantern");
    expect(instance.root).toBeDefined();
    expect(instance.root.scale.x).toBeCloseTo(0.35);
    expect(instance.root.scale.y).toBeCloseTo(0.35);
    expect(instance.root.scale.z).toBeCloseTo(0.35);

    // Check socket anchor
    const socket = instance.root.getObjectByName("Socket_FlameGlow");
    expect(socket).toBeDefined();
    expect(socket!.position.y).toBeCloseTo(0.16);

    // Check mounted light
    expect(instance.lights.has("FlameGlow")).toBe(true);
    const light = instance.lights.get("FlameGlow") as PointLight;
    expect(light).toBeDefined();
    expect(light.intensity).toBe(3.5);
    expect(light.distance).toBe(8.0);
    expect(light.color.r).toBeGreaterThan(0.7); // #d49a3d has high red
  });

  it("respects explicit scale, position, rotation, and light overrides", async () => {
    const { registry } = createMockRegistry();

    const instance = await registry.loadProp("bunker/kerosene_lantern", {
      position: [1.0, 2.0, 3.0],
      rotation: [0, Math.PI / 2, 0],
      scale: 0.5,
      lightOverrides: {
        FlameGlow: {
          intensity: 2.0,
          distance: 5.0,
          color: "#ffffff",
        },
      },
      materialOverrides: {
        roughness: 0.9,
        metallic: 0.1,
      },
    });

    expect(instance.root.position.x).toBe(1.0);
    expect(instance.root.position.y).toBe(2.0);
    expect(instance.root.position.z).toBe(3.0);
    expect(instance.root.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(instance.root.scale.x).toBe(0.5);

    const light = instance.lights.get("FlameGlow") as PointLight;
    expect(light.intensity).toBe(2.0);
    expect(light.distance).toBe(5.0);
    expect(light.color.r).toBeCloseTo(1.0);

    const submesh = instance.root.getObjectByName("SubMesh");
    const mat = submesh!.material as StandardMaterial;
    expect(mat.roughness).toBe(0.9);
    expect(mat.metallic).toBe(0.1);
  });

  it("can disable a socket light with override: false", async () => {
    const { registry } = createMockRegistry();

    const instance = await registry.loadProp("bunker/kerosene_lantern", {
      lightOverrides: {
        FlameGlow: false,
      },
    });

    expect(instance.lights.has("FlameGlow")).toBe(false);
    // Socket anchor still exists for attach points
    expect(instance.root.getObjectByName("Socket_FlameGlow")).toBeDefined();
  });

  it("loads a declarative level descriptor with props, free lights, and hotspots", async () => {
    const { registry } = createMockRegistry();

    const level = await registry.loadLevel({
      id: "test_bunker_level",
      name: "Test Bunker",
      version: "1.0.0",
      props: [
        {
          id: "Desk1",
          kitProp: "bunker/metal_desk",
          position: [-0.6, 0, -1.0],
        },
        {
          id: "Lantern1",
          kitProp: "bunker/kerosene_lantern",
          position: [-0.9, 0.78, -1.0],
          lightOverrides: {
            FlameGlow: { intensity: 2.5 },
          },
        },
      ],
      lights: [
        {
          name: "RoomSpot",
          type: "spot",
          color: "#ffeedd",
          intensity: 5.0,
          distance: 12.0,
          position: [0, 2.5, 0],
          target: [0, 0, 0],
        },
      ],
      hotspots: [
        {
          id: "desk_spot",
          name: "Desk",
          position: [-0.6, 0, -1.0],
          promptText: "Search desk",
        },
      ],
    });

    expect(level.descriptor.id).toBe("test_bunker_level");
    expect(level.root.children.length).toBe(3); // 2 props + 1 light
    expect(level.props.has("Desk1")).toBe(true);
    expect(level.props.has("Lantern1")).toBe(true);
    expect(level.lights.has("RoomSpot")).toBe(true);
    expect(level.hotspots.length).toBe(1);

    const deskProp = level.props.get("Desk1")!;
    expect(deskProp.root.position.x).toBe(-0.6);
    expect(deskProp.root.scale.x).toBeCloseTo(0.75); // deskMeta recommendedScale

    const spot = level.lights.get("RoomSpot") as SpotLight;
    expect(spot.intensity).toBe(5.0);
  });

  it("evicts rejected promises from cache so retries can succeed", async () => {
    const assetManager = new AssetManager();
    const gltfLoader = new GltfLoader({ assetManager });
    let attempts = 0;

    vi.spyOn(assetManager, "loadJson").mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("Network transient failure");
      }
      return sampleManifest;
    });

    const registry = new KitRegistry({ assetManager, gltfLoader });

    // First attempt fails
    await expect(registry.getKitManifest("bunker")).rejects.toThrow("Network transient failure");

    // Second attempt should not return the rejected promise from cache; it should retry and succeed
    const manifest = await registry.getKitManifest("bunker");
    expect(manifest.id).toBe("bunker");
    expect(attempts).toBe(2);
  });

  it("configures DirectionalLight direction and PointLight decay from level config", async () => {
    const { registry } = createMockRegistry();

    const level = await registry.loadLevel({
      id: "lights_test",
      name: "Lights Test",
      version: "1.0.0",
      props: [],
      lights: [
        {
          name: "Sun",
          type: "directional",
          color: "#ffffff",
          intensity: 1.2,
          direction: [0.5, -1.0, -0.2],
        },
        {
          name: "Bulb",
          type: "point",
          color: "#ffaa00",
          intensity: 2.0,
          distance: 6.0,
          decay: 1.5,
        },
      ],
    });

    const sun = level.lights.get("Sun") as DirectionalLight;
    expect(sun).toBeDefined();
    expect(sun.direction.x).toBeCloseTo(0.5);
    expect(sun.direction.y).toBeCloseTo(-1.0);
    expect(sun.direction.z).toBeCloseTo(-0.2);

    const bulb = level.lights.get("Bulb") as PointLight;
    expect(bulb).toBeDefined();
    expect(bulb.decay).toBeCloseTo(1.5);
    expect(bulb.distance).toBe(6.0);
  });
});

import { describe, it, expect, vi } from "vitest";
import { AssetManager } from "../../src/loaders/AssetManager.js";
import { KitRegistry } from "../../src/loaders/kit/KitRegistry.js";

describe("AssetManager customFetch & Scheme Resolution", () => {
  it("resolves custom URI schemes without mangling basePath", () => {
    const manager = new AssetManager();
    manager.setBaseUrl("/assets/kits/");

    expect(manager.resolveUrl("sw-asset://mount-123/kit.json")).toBe(
      "sw-asset://mount-123/kit.json",
    );
    expect(manager.resolveUrl("virtual://my-pack/model.gltf")).toBe("virtual://my-pack/model.gltf");
    expect(manager.resolveUrl("http://example.com/asset.png")).toBe("http://example.com/asset.png");
    expect(manager.resolveUrl("bunker/kit.json")).toBe("/assets/kits/bunker/kit.json");
  });

  it("routes requests through customFetch when provided", async () => {
    const manager = new AssetManager();
    const mockCustomFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "sw-asset://test/data.json") {
        return new Response(JSON.stringify({ hello: "world" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    });

    manager.customFetch = mockCustomFetch;

    const json = (await manager.loadJson("sw-asset://test/data.json")) as { hello: string };
    expect(json.hello).toBe("world");
    expect(mockCustomFetch).toHaveBeenCalledWith("sw-asset://test/data.json", expect.any(Object));
  });

  it("passes customFetch through KitRegistry options to AssetManager", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "sw-asset://kit/bunker/kit.json") {
        return new Response(
          JSON.stringify({
            id: "bunker",
            name: "Virtual Bunker",
            version: "1.0.0",
            author: "Tester",
            license: "MIT",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const registry = new KitRegistry({
      basePath: "sw-asset://kit/",
      customFetch: mockFetch,
    });

    const manifest = await registry.getKitManifest("bunker");
    expect(manifest.name).toBe("Virtual Bunker");
    expect(mockFetch).toHaveBeenCalledWith("sw-asset://kit/bunker/kit.json", expect.any(Object));
  });
});

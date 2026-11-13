import { describe, it, expect, vi } from "vitest";
import { AssetManager } from "../../src/loaders/AssetManager.js";

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
});

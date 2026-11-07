import { describe, it, expect, vi, beforeEach } from "vitest";
import { AssetManager } from "../../src/loaders/AssetManager.js";
import { TextLoader } from "../../src/loaders/TextLoader.js";
import { ObjLoader } from "../../src/loaders/ObjLoader.js";

function mockTextResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: null,
    blob: () => Promise.resolve(new Blob([body])),
  } as unknown as Response;
}

describe("Loader/AssetManager instance injection", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives each loader instance its own private AssetManager by default, not a shared singleton", () => {
    const a = new TextLoader() as unknown as { _assetManager: AssetManager };
    const b = new TextLoader() as unknown as { _assetManager: AssetManager };

    expect(a._assetManager).toBeInstanceOf(AssetManager);
    expect(a._assetManager).not.toBe(b._assetManager);
  });

  it("uses an explicitly injected AssetManager instance, including its configured baseUrl/headers", async () => {
    const shared = new AssetManager();
    shared.setBaseUrl("https://cdn.example.com/assets/");
    shared.setHeader("X-Test", "1");

    const fetchSpy = vi.fn().mockResolvedValue(mockTextResponse("hello"));
    vi.stubGlobal("fetch", fetchSpy);

    const loader = new TextLoader({ assetManager: shared }) as unknown as {
      _assetManager: AssetManager;
      load(url: string): Promise<string>;
    };

    expect(loader._assetManager).toBe(shared);

    const text = await loader.load("greeting.txt");
    expect(text).toBe("hello");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://cdn.example.com/assets/greeting.txt",
      expect.objectContaining({ headers: { "X-Test": "1" } }),
    );
  });

  it("forwards ObjLoader's AssetManager instance to the MtlLoader it constructs for `mtllib`", async () => {
    const shared = new AssetManager();
    shared.setHeader("X-Test", "obj-chain");

    const objText = ["mtllib materials.mtl", "usemtl Solid", "v 0 0 0", "v 1 0 0", "v 0 1 0"].join(
      "\n",
    );
    const mtlText = ["newmtl Solid", "Kd 1 0 0"].join("\n");

    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("model.obj")) return Promise.resolve(mockTextResponse(objText));
      if (url.endsWith("materials.mtl")) return Promise.resolve(mockTextResponse(mtlText));
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const loader = new ObjLoader({ assetManager: shared });
    await loader.load("model.obj");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ headers: { "X-Test": "obj-chain" } }));
    }
  });
});

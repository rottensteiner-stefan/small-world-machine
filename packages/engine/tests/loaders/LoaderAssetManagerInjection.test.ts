import { describe, it, expect, vi, beforeEach } from "vitest";
import { AssetManager } from "../../src/loaders/AssetManager.js";
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

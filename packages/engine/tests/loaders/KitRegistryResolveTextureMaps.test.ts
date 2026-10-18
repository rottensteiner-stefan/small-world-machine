import { describe, it, expect, vi } from "vitest";
import { KitRegistry } from "../../src/loaders/kit/KitRegistry.js";
import { AssetManager } from "../../src/loaders/AssetManager.js";

/**
 * Safety net for `KitRegistry.resolveTextureMaps` (thermo review wave 1,
 * item 18): exact-token map matching (never bare substring), metalness
 * resolution, parallel load via `Promise.all`, and fail-fast error
 * propagation — all against a fake loader, no network involved.
 */

function makeFakeLoader(): {
  assetManager: AssetManager;
  loadImage: ReturnType<typeof vi.fn>;
  maxInFlight: () => number;
} {
  const inFlight = new Set<string>();
  let peakInFlight = 0;
  const loadImage = vi.fn(async (url: string): Promise<HTMLImageElement> => {
    inFlight.add(url);
    peakInFlight = Math.max(peakInFlight, inFlight.size);
    await Promise.resolve();
    await Promise.resolve();
    inFlight.delete(url);
    return {} as HTMLImageElement;
  });
  const assetManager = new AssetManager();
  vi.spyOn(assetManager, "loadImage").mockImplementation(loadImage);
  return {
    assetManager,
    loadImage,
    maxInFlight: (): number => peakInFlight,
  };
}

describe("KitRegistry.resolveTextureMaps", () => {
  it("matches channels by exact token: m_albedo = albedo, _AO = ao, metalness resolved", async () => {
    const { assetManager, loadImage } = makeFakeLoader();
    const registry = new KitRegistry({ basePath: "/assets/kits/", assetManager });

    const result = await registry.resolveTextureMaps("flakturm", {
      id: "flakturm/travertine",
      maps: [
        "m_albedo.png",
        "wall_normal_dx.png",
        "concrete_AO.png",
        "roughness_2k.png",
        "metalness.png",
      ],
    });

    expect(result.albedo).toBeDefined();
    expect(result.normal).toBeDefined();
    expect(result.roughness).toBeDefined();
    expect(result.ao).toBeDefined();
    expect(result.metalness).toBeDefined();

    const urls = loadImage.mock.calls.map((c) => String(c[0]));
    // The trailing token wins: m_albedo.png is albedo, not metallic.
    expect(urls).toContain("/assets/kits/flakturm/textures/travertine/m_albedo.png");
    expect(urls).toContain("/assets/kits/flakturm/textures/travertine/metalness.png");
    // "_AO." is a full token -> perspective can only be AO.
    expect(urls).toContain("/assets/kits/flakturm/textures/travertine/concrete_AO.png");
    expect(urls).not.toContain("/assets/kits/flakturm/textures/travertine/saos.png");
  });

  it("never matches a bare substring: ao inside saos is not a channel", async () => {
    const { assetManager, loadImage } = makeFakeLoader();
    const registry = new KitRegistry({ basePath: "/", assetManager });

    const result = await registry.resolveTextureMaps("k", {
      id: "k/mat",
      maps: ["saos.png", "albedo.png"],
    });

    expect(result.ao).toBeUndefined();
    expect(result.albedo).toBeDefined();
    const urls = loadImage.mock.calls.map((c) => String(c[0]));
    expect(urls).not.toContain("/k/textures/mat/saos.png");
  });

  it("loads every found channel in parallel (all loads fire before any resolves)", async () => {
    const { assetManager, maxInFlight } = makeFakeLoader();
    const registry = new KitRegistry({ basePath: "/", assetManager });

    const result = await registry.resolveTextureMaps("k", {
      id: "brick",
      maps: ["albedo.png", "normal.png", "roughness.png", "ao.png", "metalness.png"],
    });

    // `Promise.all` starts every loader before the first one can resolve: the
    // in-flight peak must reach all five channels simultaneously.
    expect(maxInFlight()).toBe(5);
    expect(result.albedo).toBeDefined();
    expect(result.normal).toBeDefined();
    expect(result.roughness).toBeDefined();
    expect(result.ao).toBeDefined();
    expect(result.metalness).toBeDefined();
  });

  it("propagates a failing map load (fail fast)", async () => {
    const { assetManager, loadImage } = makeFakeLoader();
    loadImage.mockImplementation(async (url: string): Promise<HTMLImageElement> => {
      if (url.includes("normal")) throw new Error("normal map exploded");
      return {} as HTMLImageElement;
    });
    const registry = new KitRegistry({ basePath: "/", assetManager });

    await expect(
      registry.resolveTextureMaps("k", {
        id: "brick",
        maps: ["albedo.png", "normal.png", "roughness.png"],
      }),
    ).rejects.toThrow("normal map exploded");
  });

  it("resolves no channels for a texture item without matching filenames", async () => {
    const { assetManager, loadImage } = makeFakeLoader();
    const registry = new KitRegistry({ basePath: "/", assetManager });

    const result = await registry.resolveTextureMaps("k", {
      id: "k/flat",
      maps: ["identifier_only.png"],
    });

    expect(result).toEqual({});
    expect(loadImage).not.toHaveBeenCalled();
  });
});

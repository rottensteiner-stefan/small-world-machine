import { describe, it, expect, vi, afterEach } from "vitest";
import { WorldWriter, GltfDocument } from "../../src/loaders/WorldWriter.js";
import { GltfLoader } from "../../src/loaders/GltfLoader.js";
import { GltfData } from "../../src/loaders/gltf/index.js";
import { KitRegistry } from "../../src/loaders/kit/KitRegistry.js";
import { AssetManager } from "../../src/loaders/AssetManager.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Decal } from "../../src/core/objects/Decal.js";
import { DecalMaterial } from "../../src/core/materials/surface/DecalMaterial.js";
import { createDecalShell } from "../../src/loaders/kit/DecalShell.js";
import type { KitManifest } from "../../src/loaders/kit/KitTypes.js";

const manifest: KitManifest = {
  id: "bunker",
  name: "Bunker Kit",
  version: "1.0.0",
  description: "Decal test kit",
  items: [],
  decals: [
    { id: "bunker/sign", name: "Sign", file: "sign.png", normal: "sign_n.png", unlit: true },
  ],
  author: "t",
  license: "CC0-1.0",
};

async function parse(doc: GltfDocument): Promise<Object3D> {
  const json = JSON.parse(JSON.stringify(doc)) as GltfData["json"];
  return new GltfLoader().parse({ json, buffers: [] }, "");
}

function registry(): KitRegistry {
  const assetManager = new AssetManager();
  vi.spyOn(assetManager, "loadJson").mockImplementation(async (url: string) => {
    if (url.includes("bunker/kit.json")) return manifest;
    throw new Error(`404: ${url}`);
  });
  vi.spyOn(assetManager, "loadImage").mockImplementation(
    async () => ({ width: 4, height: 4 }) as unknown as ImageBitmap,
  );
  return new KitRegistry({ assetManager, gltfLoader: new GltfLoader({ assetManager }) });
}

function sampleDecal(name: string, kitDecal: string): Decal {
  const decal = createDecalShell({
    id: name,
    kitDecal,
    size: [2, 3, 0.4],
    fade: { angleStart: 40, angleEnd: 70, edge: 0.2 },
    opacity: 0.5,
    priority: 3,
    tags: ["dirt", "floor"],
  });
  decal.setPosition(1, 2, 3).setRotation(0.5, 0.25, 0);
  return decal;
}

afterEach(() => vi.restoreAllMocks());

describe("SWM_decal", () => {
  it("round-trips payload, transform and hierarchy", async () => {
    const root = new Object3D("Root");
    const group = new Object3D("Group");
    group.setPosition(10, 0, 0);
    const decal = sampleDecal("d1", "bunker/sign");
    group.add(decal);
    root.add(group);

    const doc = new WorldWriter().writeSingle(root);
    expect(doc.extensionsUsed).toContain("SWM_decal");
    expect(doc.meshes).toBeUndefined();

    const parsedRoot = await parse(doc);
    const parsed = parsedRoot.children[0]!.children[0]!.children[0]!;
    expect(parsed).toBeInstanceOf(Decal);
    const d = parsed as Decal;
    expect(d.name).toBe("d1");
    expect(d.kitDecal).toBe("bunker/sign");
    expect(d.position.x).toBeCloseTo(1);
    expect(d.position.z).toBeCloseTo(3);
    const written = doc.nodes.find((n) => n.name === "d1")!.rotation;
    const q = d.quaternion!;
    [q.x, q.y, q.z, q.w].forEach((v, i) => expect(v).toBeCloseTo(written[i]!, 5));
    expect(Math.abs(q.x) + Math.abs(q.y)).toBeGreaterThan(0.1);
    expect([d.scale.x, d.scale.y, d.scale.z]).toEqual([2, 0.4, 3]);
    expect(d.priority).toBe(3);
    expect(d.userData["tags"]).toEqual(["dirt", "floor"]);
    const m = d.material as DecalMaterial;
    expect(m.color.a).toBeCloseTo(0.5);
    expect(m.angleFadeStart).toBe(40);
    expect(m.angleFadeEnd).toBe(70);
    expect(m.edgeFade).toBeCloseTo(0.2);
    expect(m.diffuseMap).toBeUndefined();
  });

  it("treats the payload size as authoritative over the node scale", async () => {
    const doc = new WorldWriter().writeSingle(sampleDecal("d1", "bunker/sign"));
    doc.nodes[0]!.scale = [9, 9, 9];
    const parsed = (await parse(doc)).children[0] as Decal;
    expect([parsed.scale.x, parsed.scale.y, parsed.scale.z]).toEqual([2, 0.4, 3]);
  });

  it("does not write a decal without kitDecal", () => {
    const decal = sampleDecal("d1", "bunker/sign");
    decal.kitDecal = undefined;
    const doc = new WorldWriter().writeSingle(decal);
    expect(doc.extensionsUsed ?? []).not.toContain("SWM_decal");
  });

  it("rejects invalid payloads on read", async () => {
    const make = (patch: Record<string, unknown>): GltfDocument => {
      const doc = new WorldWriter().writeSingle(sampleDecal("d1", "bunker/sign"));
      const ext = doc.nodes[0]!.extensions as Record<string, Record<string, unknown>>;
      Object.assign(ext["SWM_decal"]!, patch);
      return doc;
    };
    await expect(parse(make({ size: [1, 0, 1] }))).rejects.toThrow(/size/);
    await expect(parse(make({ size: [1, 1] }))).rejects.toThrow(/size/);
    await expect(parse(make({ kitDecal: "" }))).rejects.toThrow(/kitDecal/);
    await expect(parse(make({ opacity: 2 }))).rejects.toThrow(/opacity/);
    await expect(parse(make({ tags: [1] }))).rejects.toThrow(/tags/);
  });

  it("hydrates maps and unlit from the kit decal", async () => {
    const parsedRoot = await parse(new WorldWriter().writeSingle(sampleDecal("d1", "bunker/sign")));
    const decal = parsedRoot.children[0] as Decal;
    expect(await registry().resolveLevelDecals(parsedRoot)).toBe(1);
    const m = decal.material as DecalMaterial;
    expect(m.diffuseMap).toBeDefined();
    expect(m.normalMap).toBeDefined();
    expect(m.unlit).toBe(true);
    expect(decal.scale.y).toBeCloseTo(0.4);
    expect(m.color.a).toBeCloseTo(0.5);
  });

  it("warns and skips unknown kit decals and unknown kits", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const reg = registry();
    const unknown = sampleDecal("a", "bunker/missing");
    const noKit = sampleDecal("b", "nokit/sign");
    const bare = sampleDecal("c", "bunker/sign");
    bare.kitDecal = undefined;
    expect(await reg.hydrateDecal(unknown)).toBe(false);
    expect(await reg.hydrateDecal(noKit)).toBe(false);
    expect(await reg.hydrateDecal(bare)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(3);
    expect((unknown.material as DecalMaterial).diffuseMap).toBeUndefined();
  });
});

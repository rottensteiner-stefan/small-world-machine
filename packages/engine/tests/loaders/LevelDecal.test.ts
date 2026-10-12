import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { KitRegistry } from "../../src/loaders/kit/KitRegistry.js";
import { AssetManager } from "../../src/loaders/AssetManager.js";
import { GltfLoader } from "../../src/loaders/GltfLoader.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Decal } from "../../src/core/objects/Decal.js";
import { DecalMaterial } from "../../src/core/materials/surface/DecalMaterial.js";
import type {
  KitManifest,
  LevelDecalPlacement,
  LevelDescriptor,
  PropMeta,
} from "../../src/loaders/kit/KitTypes.js";

const manifest: KitManifest = {
  id: "bunker",
  name: "Bunker Kit",
  version: "1.0.0",
  description: "Decal test kit",
  items: [
    {
      id: "bunker/metal_desk",
      name: "Desk",
      category: "furniture",
      path: "metal_desk/model.glb",
      preview: "metal_desk/preview.jpg",
      meta: "metal_desk/meta.json",
    },
  ],
  decals: [
    { id: "bunker/sign", name: "Sign", file: "sign.png", size: [0.5, 0.25, 0.2] },
    {
      id: "bunker/stain",
      name: "Stain",
      file: "stain.png",
      normal: "stain_n.png",
      orm: "stain_orm.png",
      emission: "stain_e.png",
      unlit: true,
    },
  ],
  author: "t",
  license: "CC0-1.0",
};

const deskMeta: PropMeta = {
  id: "bunker/metal_desk",
  name: "Desk",
  category: "furniture",
  kit: "bunker",
  version: "1.0.0",
  description: "Desk",
  triangles: 1,
  materials: 1,
  textures: [],
  dimensions: { width: 1, height: 1, depth: 1 },
  recommendedScale: 1,
  author: "t",
  license: "CC0-1.0",
};

function createRegistry(): { registry: KitRegistry; loadImage: ReturnType<typeof vi.fn> } {
  const assetManager = new AssetManager();
  const gltfLoader = new GltfLoader({ assetManager });
  vi.spyOn(assetManager, "loadJson").mockImplementation(async (url: string) => {
    if (url.includes("bunker/kit.json")) return manifest;
    if (url.includes("metal_desk/meta.json")) return deskMeta;
    throw new Error(`404: ${url}`);
  });
  const loadImage = vi.fn(async () => ({ width: 4, height: 4 }) as unknown as ImageBitmap);
  vi.spyOn(assetManager, "loadImage").mockImplementation(loadImage);
  vi.spyOn(gltfLoader, "load").mockImplementation(async () => new Object3D("Loaded"));
  return { registry: new KitRegistry({ assetManager, gltfLoader }), loadImage };
}

function level(decals: LevelDecalPlacement[]): LevelDescriptor {
  return {
    id: "decal_level",
    name: "Decal Level",
    version: "1.0.0",
    props: [{ id: "Desk1", kitProp: "bunker/metal_desk" }],
    decals,
  };
}

describe("KitRegistry level decals (ADR 0029)", () => {
  it("instantiates a decal with kit defaults", async () => {
    const { registry, loadImage } = createRegistry();
    const inst = await registry.loadLevel(level([{ id: "d1", kitDecal: "bunker/sign" }]));
    const decal = inst.decals.get("d1");
    expect(decal).toBeInstanceOf(Decal);
    expect(decal?.parent).toBe(inst.root);
    expect(decal?.scale.x).toBeCloseTo(0.5);
    expect(decal?.scale.y).toBeCloseTo(0.2);
    expect(decal?.scale.z).toBeCloseTo(0.25);
    expect(decal?.userData["tags"]).toEqual([]);
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(loadImage.mock.calls[0]?.[0]).toBe("/assets/kits/bunker/decals/sign.png");
    const mat = decal?.material as DecalMaterial;
    expect(mat.diffuseMap).toBeDefined();
    expect(mat.normalMap).toBeUndefined();
    expect(mat.unlit).toBe(false);
  });

  it("applies placement overrides and loads all kit maps", async () => {
    const { registry, loadImage } = createRegistry();
    const inst = await registry.loadLevel(
      level([
        {
          id: "d1",
          kitDecal: "bunker/stain",
          position: [1, 2, 3],
          rotation: [0.5, 0, 0],
          size: [2, 3, 0.4],
          fade: { angleStart: 40, angleEnd: 70, edge: 0.2 },
          opacity: 0.5,
          priority: 3,
          tags: ["dirt"],
        },
      ]),
    );
    const decal = inst.decals.get("d1") as Decal;
    expect(loadImage).toHaveBeenCalledTimes(4);
    expect(decal.position.y).toBeCloseTo(2);
    expect(decal.rotation.x).toBeCloseTo(0.5);
    expect(decal.scale.y).toBeCloseTo(0.4);
    expect(decal.scale.z).toBeCloseTo(3);
    expect(decal.priority).toBe(3);
    expect(decal.userData["tags"]).toEqual(["dirt"]);
    const mat = decal.material as DecalMaterial;
    expect(mat.angleFadeStart).toBe(40);
    expect(mat.angleFadeEnd).toBe(70);
    expect(mat.edgeFade).toBeCloseTo(0.2);
    expect(mat.color.a).toBeCloseTo(0.5);
    expect(mat.unlit).toBe(true);
    expect(mat.normalMap).toBeDefined();
  });

  it("parents a decal to a prop instance root", async () => {
    const { registry } = createRegistry();
    const inst = await registry.loadLevel(
      level([{ id: "d1", kitDecal: "bunker/sign", parent: "Desk1" }]),
    );
    expect(inst.decals.get("d1")?.parent).toBe(inst.props.get("Desk1")?.root);
  });

  it("loads levels without decals", async () => {
    const { registry } = createRegistry();
    const { decals: _omit, ...withoutDecals } = level([]);
    const inst = await registry.loadLevel(withoutDecals);
    expect(inst.decals.size).toBe(0);
  });

  it("skips a decal with an unknown kit decal or a failed parent prop with a warning", async () => {
    const { registry } = createRegistry();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const inst = await registry.loadLevel({
      ...level([
        { id: "bad", kitDecal: "bunker/nope" },
        { id: "orphan", kitDecal: "bunker/sign", parent: "Broken" },
        { id: "ok", kitDecal: "bunker/sign" },
      ]),
      props: [
        { id: "Desk1", kitProp: "bunker/metal_desk" },
        { id: "Broken", kitProp: "bunker/does_not_exist" },
      ],
    });
    expect([...inst.decals.keys()]).toEqual(["ok"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects bad size, unknown parent and duplicate ids", async () => {
    const { registry } = createRegistry();
    await expect(
      registry.loadLevel(level([{ id: "d1", kitDecal: "bunker/sign", size: [1, 0, 1] }])),
    ).rejects.toThrow(/size/);
    await expect(
      registry.loadLevel(level([{ id: "d1", kitDecal: "bunker/sign", size: [1, -1, 1] }])),
    ).rejects.toThrow(/size/);
    await expect(
      registry.loadLevel(level([{ id: "d1", kitDecal: "bunker/sign", parent: "Ghost" }])),
    ).rejects.toThrow(/unknown parent/);
    await expect(
      registry.loadLevel(
        level([
          { id: "d1", kitDecal: "bunker/sign" },
          { id: "d1", kitDecal: "bunker/sign" },
        ]),
      ),
    ).rejects.toThrow(/Duplicate/);
  });
});

describe("level.schema.json decals", () => {
  const schemaPath = path.resolve(__dirname, "../../../../public/schemas/level.schema.json");
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(fs.readFileSync(schemaPath, "utf8")) as Record<string, unknown>,
  );
  const base = { id: "l", name: "L", version: "1.0.0", props: [] };

  it("accepts a full placement", () => {
    expect(
      validate({
        ...base,
        decals: [
          {
            id: "d",
            kitDecal: "flakturm/sign_koje42",
            position: [0, 1, 2],
            rotation: [0, 0, 0],
            size: [1, 1, 0.5],
            fade: { angleStart: 60, angleEnd: 85, edge: 0.1 },
            opacity: 0.8,
            priority: 1,
            tags: ["sign"],
            parent: "Desk1",
          },
        ],
      }),
    ).toBe(true);
  });

  it.each([
    ["unknown field", { id: "d", kitDecal: "a/b", foo: 1 }],
    ["missing kitDecal", { id: "d" }],
    ["zero size", { id: "d", kitDecal: "a/b", size: [1, 0, 1] }],
    ["opacity > 1", { id: "d", kitDecal: "a/b", opacity: 2 }],
    ["edge > 0.5", { id: "d", kitDecal: "a/b", fade: { edge: 0.9 } }],
    ["bad kitDecal id", { id: "d", kitDecal: "nonamespace" }],
  ])("rejects %s", (_name, decal) => {
    expect(validate({ ...base, decals: [decal] })).toBe(false);
  });
});

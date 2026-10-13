import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  Object3D,
  Cube,
  StandardMaterial,
  PointLight,
  DirectionalLight,
  AmbientLight,
} from "@small-world-machine/engine";
import {
  ProjectBinding,
  FileSystemDirectoryHandleLike,
  FileSystemFileHandleLike,
} from "../../src/maker/ProjectBinding.js";

/** A minimal in-memory fake of the File System Access API surface `ProjectBinding` actually
 * uses -- lets these tests run under Node/vitest without a real browser. */
function fakeDirectory(): { directory: FileSystemDirectoryHandleLike; writes: string[] } {
  const writes: string[] = [];
  const fileHandle = {
    createWritable: async (): Promise<{
      write: (data: string) => Promise<void>;
      close: () => Promise<void>;
    }> => ({
      write: async (data: string): Promise<void> => {
        writes.push(data);
      },
      close: async (): Promise<void> => undefined,
    }),
    getFile: async (): Promise<{ text: () => Promise<string> }> => ({
      text: async (): Promise<string> => writes[writes.length - 1] ?? "{}",
    }),
  };
  const directory: FileSystemDirectoryHandleLike = {
    getFileHandle: async () => fileHandle,
  };
  return { directory, writes };
}

/** A minimal in-memory fake filesystem supporting subdirectories, for the prefab tests --
 * `fakeDirectory()` above deliberately stays flat/simple since it's all the plain scene-autosave
 * tests need. */
function fakeFileSystem(): { directory: FileSystemDirectoryHandleLike } {
  const files = new Map<string, string>();

  function makeDir(prefix: string): FileSystemDirectoryHandleLike {
    const subdirs = new Map<string, FileSystemDirectoryHandleLike>();
    return {
      getFileHandle: async (name, options): Promise<FileSystemFileHandleLike> => {
        const key = prefix + name;
        if (!files.has(key)) {
          if (!options?.create) throw new Error("NotFoundError");
          files.set(key, "{}");
        }
        return {
          createWritable: async () => ({
            write: async (data: string): Promise<void> => {
              files.set(key, data);
            },
            close: async (): Promise<void> => undefined,
          }),
          getFile: async () => ({ text: async (): Promise<string> => files.get(key) ?? "{}" }),
        };
      },
      getDirectoryHandle: async (name, options): Promise<FileSystemDirectoryHandleLike> => {
        const key = `${prefix}${name}/`;
        let dir = subdirs.get(key);
        if (!dir) {
          if (!options?.create) throw new Error("NotFoundError");
          dir = makeDir(key);
          subdirs.set(key, dir);
        }
        return dir;
      },
      entries: async function* (): AsyncGenerator<[string, unknown]> {
        for (const key of files.keys()) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          if (!rest.includes("/")) yield [rest, { kind: "file" }];
        }
      },
    };
  }

  return { directory: makeDir("") };
}

describe("ProjectBinding", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is not bound until bindTo()/bind() succeeds", () => {
    const binding = new ProjectBinding();
    expect(binding.isBound).toBe(false);
    binding.bindTo(fakeDirectory().directory);
    expect(binding.isBound).toBe(true);
  });

  it("does nothing when scheduleAutosave() is called while unbound", () => {
    const binding = new ProjectBinding();
    const dirtyStates: boolean[] = [];
    binding.onDirtyChange((dirty) => dirtyStates.push(dirty));

    binding.scheduleAutosave(() => new Object3D("Root"));
    vi.advanceTimersByTime(10_000);

    expect(dirtyStates).toHaveLength(0);
  });

  it("debounces a burst of scheduleAutosave() calls into a single write", async () => {
    const { directory, writes } = fakeDirectory();
    const binding = new ProjectBinding();
    binding.bindTo(directory);
    const dirtyStates: boolean[] = [];
    binding.onDirtyChange((dirty) => dirtyStates.push(dirty));

    const root = new Object3D("Root");
    binding.scheduleAutosave(() => root);
    vi.advanceTimersByTime(100);
    binding.scheduleAutosave(() => root);
    vi.advanceTimersByTime(100);
    binding.scheduleAutosave(() => root);

    // Not yet past the debounce window since the last call.
    await vi.advanceTimersByTimeAsync(499);
    expect(writes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(50);
    expect(writes).toHaveLength(1);
    expect(dirtyStates).toEqual([true, true, true, false]);
  });

  it("returns undefined from load() when the scene file doesn't exist yet", async () => {
    const directory: FileSystemDirectoryHandleLike = {
      getFileHandle: async () => {
        throw new Error("NotFoundError");
      },
    };
    const binding = new ProjectBinding();
    binding.bindTo(directory);

    await expect(binding.load()).resolves.toBeUndefined();
  });

  it("regression: load() preserves a saved mesh's geometry, not just the empty node", async () => {
    // Bug found live-testing Phase 2's prefab instantiate: `_parse()` was always called with
    // `buffers: []`, so `GltfLoader` silently found no vertex data for any mesh and attached
    // nothing -- every reload of a real scene lost all its meshes, not just prefabs.
    const { directory, writes } = fakeDirectory();
    const binding = new ProjectBinding();
    binding.bindTo(directory);

    const cube = new Object3D("Cube");
    cube.geometry = new Cube({ size: 1 }).getGeometryData();
    cube.material = new StandardMaterial();
    const root = new Object3D("Root");
    root.add(cube);

    binding.scheduleAutosave(() => root);
    await vi.advanceTimersByTimeAsync(600);
    expect(writes).toHaveLength(1);

    const loaded = await binding.load();
    expect(loaded?.children).toHaveLength(1);
    const loadedCube = loaded!.children[0]!;
    expect(loadedCube.name).toBe("Cube");
    // GltfLoader attaches geometry to a synthetic "<name>_mesh" child, not the node itself.
    expect(loadedCube.children).toHaveLength(1);
    expect(loadedCube.children[0]!.geometry?.vertices.length).toBeGreaterThan(0);
  });

  it("load() keeps scene lights but drops editor helper nodes from older scene files", async () => {
    const { directory, writes } = fakeDirectory();
    const binding = new ProjectBinding();
    binding.bindTo(directory);

    const root = new Object3D("Root");
    root.add(new PointLight({ name: "Lamp" }));
    root.add(new DirectionalLight({ name: "SunLight", intensity: 2 }));
    root.add(new AmbientLight({ name: "Fill", intensity: 0.3 }));
    root.add(new Object3D("MakerGizmo"));
    root.add(new Object3D("Helper_Lamp"));
    root.add(new Object3D("Crate"));

    binding.scheduleAutosave(() => root);
    await vi.advanceTimersByTimeAsync(600);
    expect(writes).toHaveLength(1);

    const loaded = await binding.load();
    expect(loaded!.children.map((c) => c.name)).toEqual(["Lamp", "SunLight", "Fill", "Crate"]);
    expect(loaded!.children[0]).toBeInstanceOf(PointLight);
    expect((loaded!.children[1] as DirectionalLight).intensity).toBe(2);
    expect(loaded!.children[2]).toBeInstanceOf(AmbientLight);
  });

  describe("prefabs", () => {
    it("returns false/[] when the directory handle doesn't support subfolders", async () => {
      const binding = new ProjectBinding();
      binding.bindTo(fakeDirectory().directory); // no getDirectoryHandle
      await expect(binding.savePrefab("Foo", new Object3D("Foo"))).resolves.toBe(false);
      await expect(binding.listPrefabs()).resolves.toEqual([]);
    });

    it("saves a prefab and lists it back by name", async () => {
      const { directory } = fakeFileSystem();
      const binding = new ProjectBinding();
      binding.bindTo(directory);

      const obj = new Object3D("Barrel");
      await expect(binding.savePrefab("OilBarrel", obj)).resolves.toBe(true);
      await expect(binding.listPrefabs()).resolves.toEqual(["OilBarrel"]);
    });

    it("loadPrefab() yields an independent copy each time, tagged with prefabSource", async () => {
      const { directory } = fakeFileSystem();
      const binding = new ProjectBinding();
      binding.bindTo(directory);

      const obj = new Object3D("Barrel");
      obj.position.set(1, 2, 3);
      await binding.savePrefab("OilBarrel", obj);

      const first = await binding.loadPrefab("OilBarrel");
      const second = await binding.loadPrefab("OilBarrel");

      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(first).not.toBe(second); // independent copies, not the same instance
      expect(first!.prefabSource).toBe("OilBarrel");
      expect(second!.prefabSource).toBe("OilBarrel");
      expect(first!.position.x).toBeCloseTo(1);

      // Mutating one instance must not affect the other -- true stamped-copy independence.
      first!.position.x = 999;
      expect(second!.position.x).toBeCloseTo(1);
    });

    it("regression: loadPrefab() preserves the prefab's own geometry", async () => {
      const { directory } = fakeFileSystem();
      const binding = new ProjectBinding();
      binding.bindTo(directory);

      const cube = new Object3D("Cube");
      cube.geometry = new Cube({ size: 1 }).getGeometryData();
      cube.material = new StandardMaterial();
      await binding.savePrefab("CubePrefab", cube);

      const instance = await binding.loadPrefab("CubePrefab");
      expect(instance?.children).toHaveLength(1);
      expect(instance!.children[0]!.geometry?.vertices.length).toBeGreaterThan(0);
    });

    it("loadPrefab() returns undefined for a name that was never saved", async () => {
      const { directory } = fakeFileSystem();
      const binding = new ProjectBinding();
      binding.bindTo(directory);

      await expect(binding.loadPrefab("Nonexistent")).resolves.toBeUndefined();
    });

    it("saves and loads a prefab thumbnail as a sidecar, independent of the .gltf itself", async () => {
      const { directory } = fakeFileSystem();
      const binding = new ProjectBinding();
      binding.bindTo(directory);

      await binding.savePrefab("OilBarrel", new Object3D("Barrel"));
      await binding.savePrefabThumbnail("OilBarrel", "data:image/png;base64,AAA");

      await expect(binding.loadPrefabThumbnail("OilBarrel")).resolves.toBe(
        "data:image/png;base64,AAA",
      );
      // The sidecar isn't itself a prefab -- listPrefabs() must still only report the real one.
      await expect(binding.listPrefabs()).resolves.toEqual(["OilBarrel"]);
    });

    it("loadPrefabThumbnail() returns undefined when no thumbnail was ever saved", async () => {
      const { directory } = fakeFileSystem();
      const binding = new ProjectBinding();
      binding.bindTo(directory);

      await binding.savePrefab("OilBarrel", new Object3D("Barrel"));
      await expect(binding.loadPrefabThumbnail("OilBarrel")).resolves.toBeUndefined();
    });

    it("savePrefabThumbnail() is a no-op when the directory handle doesn't support subfolders", async () => {
      const binding = new ProjectBinding();
      binding.bindTo(fakeDirectory().directory); // no getDirectoryHandle
      await expect(binding.savePrefabThumbnail("Foo", "data:x")).resolves.toBeUndefined();
    });
  });
});

import { describe, it, expect, vi } from "vitest";
import {
  Decal,
  KitRegistry,
  Object3D,
  Vector3D,
  createDecalShell,
} from "@small-world-machine/engine";
import type { FileSystemDirectoryHandleLike } from "../../src/maker/ProjectBinding.js";
import { ProjectBinding } from "../../src/maker/ProjectBinding.js";
import { decalEulerFromNormal } from "../../src/maker/DecalStampTool.js";

function fakeDirectory(): FileSystemDirectoryHandleLike {
  let text = "{}";
  const fileHandle = {
    createWritable: async (): Promise<{
      write: (data: string) => Promise<void>;
      close: () => Promise<void>;
    }> => ({
      write: async (data: string): Promise<void> => {
        text = data;
      },
      close: async (): Promise<void> => undefined,
    }),
    getFile: async (): Promise<{ text: () => Promise<string> }> => ({ text: async () => text }),
  };
  return { getFileHandle: async () => fileHandle };
}

describe("stamped decal persistence (stamp -> autosave -> reload)", () => {
  it("round-trips kitDecal, size and orientation, and leaves the ghost out of the file", async () => {
    vi.useFakeTimers();
    try {
      const root = new Object3D("Root");
      const normal = new Vector3D(1, 0, 0);
      const rotation = decalEulerFromNormal(normal, Math.PI / 12);
      const stamped = createDecalShell({
        id: "Sign_1",
        kitDecal: "flakturm/sign",
        size: [2, 1, 0.5],
        position: [3, 1, -2],
        rotation: [rotation.x, rotation.y, rotation.z],
        opacity: 0.8,
      });
      const ghost = createDecalShell({
        id: "DecalStampGhost",
        kitDecal: "flakturm/sign",
        size: [2, 1, 0.5],
        opacity: 0.5,
      });
      root.add(stamped, ghost);

      const binding = new ProjectBinding();
      binding.bindTo(fakeDirectory());
      binding.excludeFromSave = (obj): boolean => obj === ghost;
      binding.scheduleAutosave(() => root);
      await vi.advanceTimersByTimeAsync(600);

      expect(root.children).toEqual([stamped, ghost]); // restored after the write

      const loaded = await binding.load();
      expect(loaded?.children).toHaveLength(1);
      const decal = loaded!.children[0]! as Decal;
      expect(decal).toBeInstanceOf(Decal);
      expect(decal.name).toBe("Sign_1");
      expect(decal.kitDecal).toBe("flakturm/sign");
      expect(decal.scale.x).toBeCloseTo(2);
      expect(decal.scale.y).toBeCloseTo(0.5);
      expect(decal.scale.z).toBeCloseTo(1);
      expect(decal.position.x).toBeCloseTo(3);

      decal.updateMatrixWorld(true);
      const m = decal.worldMatrix.data;
      const len = Math.hypot(m[4]!, m[5]!, m[6]!); // local +Y scaled by the depth (0.5)
      expect(m[4]! / len).toBeCloseTo(normal.x, 4);
      expect(m[5]! / len).toBeCloseTo(normal.y, 4);
      expect(m[6]! / len).toBeCloseTo(normal.z, 4);

      // Maker calls this on the freshly loaded root; an unknown kit decal must only warn.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await expect(new KitRegistry().resolveLevelDecals(loaded!)).resolves.toBe(0);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

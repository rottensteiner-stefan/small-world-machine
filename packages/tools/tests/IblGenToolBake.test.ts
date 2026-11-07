// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ instances: [] as unknown[], gate: null as null | Promise<void> }));

vi.mock("../src/ibl-gen/ibl-gen.js", () => {
  class IBLBaker {
    public deleted: unknown[] = [];
    public disposed = false;
    public n = 0;
    constructor() {
      h.instances.push(this);
    }
    public async generateBRDF(): Promise<void> {
      if (h.gate) await h.gate;
    }
    public async loadEquirectangularImage(): Promise<object> {
      if (this.disposed) throw new Error("disposed baker used");
      return { t: "equi" };
    }
    public async generateEnvironmentCubemap(): Promise<object> {
      return { t: "env" + ++this.n };
    }
    public async generateIrradianceCubemap(): Promise<object> {
      return { t: "irr" + this.n };
    }
    public async generatePrefilteredCubemap(): Promise<object> {
      return { t: "pre" + this.n };
    }
    public deleteTexture(t: unknown): void {
      this.deleted.push(t);
    }
    public dispose(): void {
      this.disposed = true;
    }
  }
  return { IBLBaker };
});

import { IblGenTool } from "../src/ibl-gen/IblGenTool.js";

interface FakeBaker {
  deleted: { t: string }[];
  disposed: boolean;
}
interface Priv {
  _panorama: Blob;
  _bake(): Promise<void>;
}

function make(): { tool: IblGenTool; priv: Priv; parent: HTMLElement } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const tool = new IblGenTool({ parent });
  const priv = tool as unknown as Priv;
  priv._panorama = new Blob(["x"]);
  return { tool, priv, parent };
}

describe("IblGenTool bake lifecycle", () => {
  it("frees the previous bake's textures (and the equirect) before/after rebaking", async () => {
    const { priv } = make();
    await priv._bake();
    await priv._bake();
    const baker = h.instances[h.instances.length - 1] as FakeBaker;
    const names = baker.deleted.map((d) => d.t);
    expect(names).toContain("equi");
    expect(names).toEqual(expect.arrayContaining(["env1", "irr1", "pre1"]));
  });

  it("aborts quietly (no console.error, no GL use) when unmounted mid-bake", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { tool, priv } = make();
    let release!: () => void;
    h.gate = new Promise<void>((r) => (release = r));
    const bake = priv._bake();
    tool.unmount();
    h.gate = null;
    release();
    await bake;
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

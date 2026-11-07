// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { cloneCanvas } from "../../src/maker/cloneCanvas.js";

describe("cloneCanvas", () => {
  it("returns a new canvas of the same size and draws the source into it", () => {
    const drawImage = vi.fn();
    // jsdom has no 2D context without the canvas package: stub it on the prototype.
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ drawImage } as unknown as GPUCanvasContext);
    const source = document.createElement("canvas");
    source.width = 32;
    source.height = 16;

    const copy = cloneCanvas(source);

    expect(copy).not.toBe(source);
    expect(copy.width).toBe(32);
    expect(copy.height).toBe(16);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0);
    spy.mockRestore();
  });

  it("MaterialStudioController sends clones, never the live canvases (source pin; wiring is browser-only)", () => {
    const src = readFileSync(
      "packages/tools/src/material-studio/MaterialStudioController.ts",
      "utf8",
    );
    expect(src).toContain("diffuseMap: cloneCanvas(canvases.original)");
    expect(src).toContain("normalMap: cloneCanvas(canvases.normal)");
    expect(src).toContain("roughnessMap: cloneCanvas(canvases.roughness)");
  });
});

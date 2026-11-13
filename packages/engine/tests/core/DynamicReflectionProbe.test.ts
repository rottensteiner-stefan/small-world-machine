import { describe, it, expect, vi } from "vitest";
import type { RenderTargetCube } from "../../src/index.js";
import { DynamicReflectionProbe, Scene, Object3D } from "../../src/index.js";
import type { Renderer } from "../../src/interfaces/Renderer.js";

describe("DynamicReflectionProbe", (): void => {
  it("does not hide scene.root when probe is added directly to scene", (): void => {
    const probe = new DynamicReflectionProbe();
    const scene = new Scene();
    scene.add(probe);

    let sceneRootVisibleDuringRender = false;
    const mockRenderer = {
      setRenderTarget: vi.fn(),
      render: vi.fn(() => {
        sceneRootVisibleDuringRender = scene.root.isVisible;
      }),
    } as unknown as Renderer;

    probe.updateReflection(scene, mockRenderer);
    expect(sceneRootVisibleDuringRender).toBe(true);
    expect(scene.root.isVisible).toBe(true);
    expect(probe.isVisible).toBe(true);
  });

  it("restores visibility and render target safely even when render throws", (): void => {
    const probe = new DynamicReflectionProbe();
    const scene = new Scene();
    const parentMesh = new Object3D("CarMesh");
    scene.add(parentMesh);
    parentMesh.add(probe);

    const prevTarget = {} as unknown as RenderTargetCube;
    const mockRenderer = {
      activeRenderTarget: prevTarget,
      activeCubeFace: 2,
      setRenderTarget: vi.fn(),
      render: vi.fn(() => {
        throw new Error("GPU validation failure during probe rendering");
      }),
    } as unknown as Renderer;

    expect(() => probe.updateReflection(scene, mockRenderer)).toThrow(
      "GPU validation failure during probe rendering",
    );

    // Visibility and target must be restored
    expect(probe.isVisible).toBe(true);
    expect(parentMesh.isVisible).toBe(true);
    expect(mockRenderer.setRenderTarget).toHaveBeenLastCalledWith(prevTarget, 2);
  });
});

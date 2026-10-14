import { describe, it, expect, vi } from "vitest";
import { DynamicReflectionProbe, Scene, Object3D, RenderTargetCube } from "../../src/index.js";
import { Renderer } from "../../src/interfaces/Renderer.js";

describe("DynamicReflectionProbe", (): void => {
  it("initializes with 1 face per frame by default", (): void => {
    const probe = new DynamicReflectionProbe("TestProbe", 128);
    expect(probe.facesPerFrame).toBe(1);
    expect(probe.renderTarget.width).toBe(128);
    expect(probe.renderTarget.height).toBe(128);
  });

  it("updates correct number of faces and cycles through them", (): void => {
    const probe = new DynamicReflectionProbe();
    probe.facesPerFrame = 2;

    const scene = new Scene();
    const mockRenderer = {
      setRenderTarget: vi.fn(),
      render: vi.fn(),
    } as unknown as Renderer;

    // First update (should do faces 0, 1)
    probe.updateReflection(scene, mockRenderer);
    expect(mockRenderer.setRenderTarget).toHaveBeenCalledTimes(3); // 2 faces + 1 null at end
    expect(mockRenderer.render).toHaveBeenCalledTimes(2);

    // Second update (should do faces 2, 3)
    probe.updateReflection(scene, mockRenderer);
    expect(mockRenderer.render).toHaveBeenCalledTimes(4);

    // Third update (should do faces 4, 5)
    probe.updateReflection(scene, mockRenderer);
    expect(mockRenderer.render).toHaveBeenCalledTimes(6);

    // Fourth update (should cycle back to faces 0, 1)
    probe.updateReflection(scene, mockRenderer);
    expect(mockRenderer.render).toHaveBeenCalledTimes(8);
  });

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

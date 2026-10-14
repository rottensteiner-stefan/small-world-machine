import { describe, expect, it } from "vitest";
import { Camera } from "../../src/core/cameras/Camera.js";
import { Object3D } from "../../src/core/Object3D.js";
import { PerspectiveProjection } from "../../src/math/index.js";
import { PlanarReflectionNode } from "../../src/core/reflection/PlanarReflectionNode.js";
import { Scene } from "../../src/core/Scene.js";
import { Renderer } from "../../src/interfaces/Renderer.js";
import { RenderTarget } from "../../src/core/textures/index.js";

class MockRenderer {
  public renderTargetParams: unknown[] = [];
  public renderCalls = 0;
  /** Set by the test right before calling `updateReflection()`, so `render()` can capture
   * visibility state exactly as it stood during the reflection sub-render. */
  public onRender?: () => void;

  public setRenderTarget(target: unknown): void {
    this.renderTargetParams.push(target);
  }

  public render(): void {
    this.renderCalls++;
    this.onRender?.();
  }
}

describe("PlanarReflectionNode", () => {
  it("should initialize a RenderTarget and mirrored camera", () => {
    const reflectionNode = new PlanarReflectionNode("TestReflection", 512, 512);

    expect(reflectionNode.renderTarget).toBeDefined();
    expect(reflectionNode.renderTarget.width).toBe(512);
    expect(reflectionNode.renderTarget.height).toBe(512);

    // Internal camera should exist
    expect(reflectionNode.mirrorCamera).toBeDefined();
  });

  it("should properly mirror camera positions across its plane", () => {
    const reflectionNode = new PlanarReflectionNode("Mirror", 512, 512);
    // Node sits at Y=0 (XZ plane)
    reflectionNode.position.set(0, 0, 0);
    reflectionNode.updateMatrixWorld();

    const mainCamera = new Camera(new PerspectiveProjection());
    // Camera is 5 units above the floor looking down a bit
    mainCamera.position.set(0, 5, 10);
    mainCamera.updateViewMatrix();

    const scene = new Scene();
    const renderer = new MockRenderer();

    // Trigger update
    reflectionNode.updateReflection(scene, mainCamera, renderer as unknown as Renderer);

    // After updateReflection, the internal mirrored camera should be mirrored across Y=0
    const mirroredCamera = reflectionNode.mirrorCamera;

    expect(mirroredCamera.position.x).toBeCloseTo(0, 3);
    expect(mirroredCamera.position.y).toBeCloseTo(-5, 3); // Mirrored across Y=0!
    expect(mirroredCamera.position.z).toBeCloseTo(10, 3);

    // Renderer should have been asked to render to the render target, then null
    expect(renderer.renderTargetParams[0]).toBe(reflectionNode.renderTarget);
    expect(renderer.renderTargetParams[1]).toBeNull();
    expect(renderer.renderCalls).toBe(1);
  });

  it("should update mirrored camera UP vector before computing viewMatrix", () => {
    const reflectionNode = new PlanarReflectionNode("Mirror", 512, 512);
    reflectionNode.position.set(0, 0, 0);
    reflectionNode.updateMatrixWorld();

    const mainCamera = new Camera(new PerspectiveProjection());
    mainCamera.position.set(0, 5, 10);
    mainCamera.target.set(0, 0, 0);
    mainCamera.up.set(0, 1, 0);

    const scene = new Scene();
    const renderer = new MockRenderer();

    reflectionNode.updateReflection(scene, mainCamera, renderer as unknown as Renderer);

    // With ground plane normal (0, 1, 0) and camera up (0, 1, 0), mirrored up is (0, -1, 0)
    expect(reflectionNode.mirrorCamera.up.y).toBeCloseTo(-1, 3);

    // The view matrix must reflect this mirrored up vector immediately
    const viewMatrixData = Array.from(reflectionNode.mirrorCamera.viewMatrix);
    expect(viewMatrixData.some((v) => Number.isNaN(v))).toBe(false);
  });

  describe("excludedObjects (WebGPU RenderAttachment/TextureBinding hazard fix)", () => {
    it("hides every excluded object during the reflection render and restores visibility after", () => {
      const reflectionNode = new PlanarReflectionNode("Mirror", 512, 512);
      reflectionNode.updateMatrixWorld();

      const floor = new Object3D("Floor"); // e.g. a mirror surface sampling `renderTarget`
      floor.isVisible = true;
      reflectionNode.excludedObjects.push(floor);

      const mainCamera = new Camera(new PerspectiveProjection());
      mainCamera.position.set(0, 5, 10);
      const scene = new Scene();
      const renderer = new MockRenderer();

      let floorVisibleDuringRender: boolean | undefined;
      renderer.onRender = (): void => {
        floorVisibleDuringRender = floor.isVisible;
      };

      reflectionNode.updateReflection(scene, mainCamera, renderer as unknown as Renderer);

      expect(floorVisibleDuringRender).toBe(false);
      expect(floor.isVisible).toBe(true); // restored afterward
    });

    it("restores each excluded object's own prior visibility, not just `true`", () => {
      const reflectionNode = new PlanarReflectionNode("Mirror", 512, 512);
      reflectionNode.updateMatrixWorld();

      const alreadyHidden = new Object3D("AlreadyHidden");
      alreadyHidden.isVisible = false;
      reflectionNode.excludedObjects.push(alreadyHidden);

      const mainCamera = new Camera(new PerspectiveProjection());
      mainCamera.position.set(0, 5, 10);
      const scene = new Scene();
      const renderer = new MockRenderer();

      reflectionNode.updateReflection(scene, mainCamera, renderer as unknown as Renderer);

      expect(alreadyHidden.isVisible).toBe(false);
    });

    it("is a no-op when excludedObjects is empty (default), matching prior behavior", () => {
      const reflectionNode = new PlanarReflectionNode("Mirror", 512, 512);
      reflectionNode.updateMatrixWorld();

      const mainCamera = new Camera(new PerspectiveProjection());
      mainCamera.position.set(0, 5, 10);
      const scene = new Scene();
      const renderer = new MockRenderer();

      expect(() =>
        reflectionNode.updateReflection(scene, mainCamera, renderer as unknown as Renderer),
      ).not.toThrow();
      expect(renderer.renderCalls).toBe(1);
    });

    it("restores visibility and render target in finally block when renderer.render throws", () => {
      const reflectionNode = new PlanarReflectionNode("Mirror", 512, 512);
      reflectionNode.updateMatrixWorld();

      const floor = new Object3D("Floor");
      floor.isVisible = true;
      reflectionNode.excludedObjects.push(floor);

      const mainCamera = new Camera(new PerspectiveProjection());
      const scene = new Scene();
      const prevTarget = {} as unknown as RenderTarget;
      const renderer = {
        activeRenderTarget: prevTarget,
        activeCubeFace: undefined,
        setRenderTarget: vi.fn(),
        render: vi.fn(() => {
          throw new Error("Render pipeline error");
        }),
      } as unknown as Renderer;

      expect(() => reflectionNode.updateReflection(scene, mainCamera, renderer)).toThrow(
        "Render pipeline error",
      );

      expect(reflectionNode.isVisible).toBe(true);
      expect(floor.isVisible).toBe(true);
      expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(prevTarget, undefined);
    });
  });
});

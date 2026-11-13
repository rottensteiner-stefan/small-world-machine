import { describe, expect, it, vi } from "vitest";
import { Camera } from "../../src/core/cameras/Camera.js";
import { Object3D } from "../../src/core/Object3D.js";
import { PerspectiveProjection, Vector3D } from "../../src/math/index.js";
import { PlanarReflectionNode } from "../../src/core/reflection/PlanarReflectionNode.js";
import { Scene } from "../../src/core/Scene.js";
import type { Renderer } from "../../src/interfaces/Renderer.js";
import type { RenderTarget } from "../../src/core/textures/index.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";

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

  it("treats the plane as two-sided: camera below the plane keeps the camera-side half-space", () => {
    // Probe a world point on each side of the Y=0 plane through the oblique view-projection the
    // renderer receives. The clip plane is the near plane: `z + w >= 0` means "kept" (GL clip z).
    const keptSide = (camY: number, probeY: number): boolean => {
      const node = new PlanarReflectionNode("M", 64, 64);
      node.updateMatrixWorld();
      const cam = new Camera(new PerspectiveProjection());
      cam.position.set(0, camY, 10);
      cam.target.set(0, camY, 0);
      cam.updateViewMatrix();
      let vp: Float32Array | undefined;
      const renderer = {
        setRenderTarget(): void {},
        render(_scene: unknown, viewProjection: Float32Array): void {
          vp = viewProjection.slice();
        },
      };
      node.updateReflection(new Scene(), cam, renderer as unknown as Renderer);
      const d = vp!;
      const z = -5;
      const clipZ = d[8 + 2]! * z + d[4 + 2]! * probeY + d[12 + 2]!;
      const clipW = d[8 + 3]! * z + d[4 + 3]! * probeY + d[12 + 3]!;
      return clipZ + clipW >= 0;
    };

    // Camera above: keeps the half-space above the plane.
    expect(keptSide(5, 3)).toBe(true);
    expect(keptSide(5, -3)).toBe(false);
    // Camera below: normal is flipped, so it keeps the half-space below the plane.
    expect(keptSide(-5, -3)).toBe(true);
    expect(keptSide(-5, 3)).toBe(false);
  });

  it("mirrors a camera below the plane to the upper side", () => {
    const node = new PlanarReflectionNode("M", 64, 64);
    node.updateMatrixWorld();
    const cam = new Camera(new PerspectiveProjection());
    cam.position.set(0, -5, 10);
    cam.updateViewMatrix();
    const renderer = new MockRenderer();
    node.updateReflection(new Scene(), cam, renderer as unknown as Renderer);
    expect(node.mirrorCamera.position.y).toBeCloseTo(5, 3);
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

describe("PlanarReflectionNode oblique clipping", () => {
  /** Distance of `p` from the near plane in the view-projection `vp` (clip z + w): >= 0 is kept. */
  function nearDistance(vp: Float32Array, p: [number, number, number]): number {
    const row = (r: number): number =>
      vp[r]! * p[0] + vp[4 + r]! * p[1] + vp[8 + r]! * p[2] + vp[12 + r]!;
    return row(2) + row(3);
  }

  function reflect(clipBelowPlane: boolean, clipPlaneOffset = 0): Float32Array {
    const node = new PlanarReflectionNode("Water", 64, 64);
    node.clipBelowPlane = clipBelowPlane;
    node.clipPlaneOffset = clipPlaneOffset;
    node.updateMatrixWorld();
    const camera = new Camera(new PerspectiveProjection());
    camera.position.set(0, 5, 10);
    camera.updateViewMatrix();
    let captured = new Float32Array(16);
    const renderer = {
      activeRenderTarget: null,
      activeCubeFace: undefined,
      setRenderTarget: vi.fn(),
      render: vi.fn((_scene: Scene, vp: Float32Array) => {
        captured = Float32Array.from(vp);
      }),
    } as unknown as Renderer;
    node.updateReflection(new Scene(), camera, renderer);
    return captured;
  }

  it("keeps geometry above the plane and cuts geometry below it", () => {
    const vp = reflect(true);
    expect(nearDistance(vp, [0, 1, 0])).toBeGreaterThan(0);
    expect(nearDistance(vp, [0, -1, 0])).toBeLessThan(0);
  });

  it("puts a point on the plane on the near plane", () => {
    expect(nearDistance(reflect(true), [2, 0, -3])).toBeCloseTo(0, 4);
  });

  it("clipPlaneOffset moves the clip plane along the normal", () => {
    const vp = reflect(true, -0.5);
    expect(nearDistance(vp, [0, -0.25, 0])).toBeGreaterThan(0);
    expect(nearDistance(vp, [0, -0.75, 0])).toBeLessThan(0);
  });

  it("renders the unclipped scene when clipBelowPlane is false", () => {
    expect(nearDistance(reflect(false), [0, -1, 0])).toBeGreaterThan(0);
  });

  it("leaves the (shared) projection of the main camera untouched", () => {
    const node = new PlanarReflectionNode("Water", 64, 64);
    node.updateMatrixWorld();
    const projection = new PerspectiveProjection();
    const camera = new Camera(projection);
    camera.position.set(0, 5, 10);
    camera.updateViewMatrix();
    const before = Float32Array.from(projection.getMatrix().data);
    node.updateReflection(new Scene(), camera, {
      activeRenderTarget: null,
      setRenderTarget: vi.fn(),
      render: vi.fn(),
    } as unknown as Renderer);
    expect(Array.from(projection.getMatrix().data)).toEqual(Array.from(before));
  });

  describe("PlanarReflectionNodeOptions & Frustum Culling", () => {
    it("skips rendering and returns false when reflective surface is outside main camera frustum", () => {
      const node = new PlanarReflectionNode({ width: 256, height: 256 });
      node.updateMatrixWorld();

      // Reflective water surface far behind the camera
      const surface = new Object3D("WaterSurface");
      surface.position.set(0, 0, 500); // Camera will look towards -Z
      surface.bounds = new BoundingBox(new Vector3D(-10, -1, 490), new Vector3D(10, 1, 510));
      node.reflectiveSurfaces.push(surface);

      const camera = new Camera(new PerspectiveProjection());
      camera.position.set(0, 5, 10);
      camera.target.set(0, 0, 0); // Looking towards -Z
      camera.updateViewMatrix();

      const renderer = new MockRenderer();
      const rendered = node.updateReflection(new Scene(), camera, renderer as unknown as Renderer);

      expect(rendered).toBe(false);
      expect(renderer.renderCalls).toBe(0);
    });

    it("renders and returns true when reflective surface is inside main camera frustum", () => {
      const node = new PlanarReflectionNode({ width: 256, height: 256 });
      node.updateMatrixWorld();

      // Reflective water surface directly in front of the camera
      const surface = new Object3D("WaterSurface");
      surface.position.set(0, 0, 0);
      surface.bounds = new BoundingBox(new Vector3D(-10, -1, -10), new Vector3D(10, 1, 10));
      node.reflectiveSurfaces.push(surface);

      const camera = new Camera(new PerspectiveProjection());
      camera.position.set(0, 5, 10);
      camera.target.set(0, 0, 0);
      camera.updateViewMatrix();

      const renderer = new MockRenderer();
      const rendered = node.updateReflection(new Scene(), camera, renderer as unknown as Renderer);

      expect(rendered).toBe(true);
      expect(renderer.renderCalls).toBe(1);
    });

    it("renders unconditionally when cullAgainstFrustum is disabled", () => {
      const node = new PlanarReflectionNode({
        width: 256,
        height: 256,
        cullAgainstFrustum: false,
      });
      node.updateMatrixWorld();

      const surface = new Object3D("WaterSurface");
      surface.position.set(0, 0, 500);
      surface.bounds = new BoundingBox(new Vector3D(-10, -1, 490), new Vector3D(10, 1, 510));
      node.reflectiveSurfaces.push(surface);

      const camera = new Camera(new PerspectiveProjection());
      camera.position.set(0, 5, 10);
      camera.target.set(0, 0, 0);
      camera.updateViewMatrix();

      const renderer = new MockRenderer();
      const rendered = node.updateReflection(new Scene(), camera, renderer as unknown as Renderer);

      expect(rendered).toBe(true);
      expect(renderer.renderCalls).toBe(1);
    });
  });

  describe("resolutionScale (mirror-pass resolution, low performance tiers)", () => {
    it("downscales the render target at construction to scale × base (not accumulated)", () => {
      const node = new PlanarReflectionNode({
        width: 512,
        height: 512,
        resolutionScale: 0.5,
      });

      expect(node.resolutionScale).toBe(0.5);
      expect(node.renderTarget.width).toBe(256);
      expect(node.renderTarget.height).toBe(256);

      node.resolutionScale = 0.5; // same value: no-op, must not half it again
      expect(node.renderTarget.width).toBe(256);
    });

    it("defaults to full configured resolution when no scale is given", () => {
      const node = new PlanarReflectionNode({ width: 512, height: 512 });
      expect(node.resolutionScale).toBe(1);
      expect(node.renderTarget.width).toBe(512);
      expect(node.renderTarget.height).toBe(512);
      // The positional constructor stays backwards compatible (no options object).
      const legacy = new PlanarReflectionNode("Mirror", 512, 512);
      expect(legacy.resolutionScale).toBe(1);
      expect(legacy.renderTarget.width).toBe(512);
    });

    it("setter resizes relative to the configured base, restoring full resolution on 1", () => {
      const node = new PlanarReflectionNode({ width: 512, height: 256 });
      node.resolutionScale = 0.5;
      expect(node.renderTarget.width).toBe(256);
      expect(node.renderTarget.height).toBe(128);

      node.resolutionScale = 1;
      expect(node.renderTarget.width).toBe(512);
      expect(node.renderTarget.height).toBe(256);
    });

    it("clamps values outside (0,1] to full resolution (never upscale, never zero pixels)", () => {
      const node = new PlanarReflectionNode({ width: 512, height: 512 });

      node.resolutionScale = 2;
      expect(node.resolutionScale).toBe(1);
      expect(node.renderTarget.width).toBe(512);

      node.resolutionScale = 0;
      expect(node.resolutionScale).toBe(1);
      expect(node.renderTarget.width).toBe(512);

      expect(
        new PlanarReflectionNode({ width: 512, height: 512, resolutionScale: 1.5 }).resolutionScale,
      ).toBe(1);
    });

    it("rounds fractional sizes and never produces a zero-width target", () => {
      const node = new PlanarReflectionNode({ width: 400, height: 3, resolutionScale: 0.5 });
      expect(node.renderTarget.width).toBe(200);
      const tiny = new PlanarReflectionNode({ width: 1, height: 1, resolutionScale: 0.5 });
      expect(tiny.renderTarget.width).toBe(1);
      expect(tiny.renderTarget.height).toBe(1);
    });
  });
});

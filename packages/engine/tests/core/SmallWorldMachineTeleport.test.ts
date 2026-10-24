// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SmallWorldMachine, Scene, Object3D } from "../../src/core/index.js";
import { RendererType } from "../../src/enums/index.js";
import { createFrameInfo, type Renderer } from "../../src/interfaces/index.js";
import { PostProcessingGroup } from "../../src/renderers/post/index.js";
import { WebGL1Renderer } from "../../src/renderers/WebGL1/WebGL1Renderer.js";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import { makeMockAudioContext } from "../audio/mockAudioContext.js";

/**
 * S3 DP-4A: `SmallWorldMachine.notifyCameraTeleport()` is the synchronous, idempotent, void,
 * scalar-free fan-out that invalidates ALL temporal/occlusion state on a camera cut (TAA + fog +
 * occlusion = 3 semantic consumers; ADR 0008 extension, E5). WebGL1 keeps the honest no-op
 * (ADR 0043 -- no temporal/occlusion state there). Renderer-internal history drops are covered by
 * the pass-level tests; this suite pins the ENGINE-level contract: the scene-wide
 * `occlusionCulled` reset walk runs unconditionally, the renderer delegate is invoked with the
 * scene, and the call is idempotent and tier-safe.
 */

class TestSmallWorldMachine extends SmallWorldMachine {
  constructor() {
    super();
  }
  protected override async setupScene(): Promise<void> {}
  protected override update(_deltaTime: number): void {}
}

const attachedCanvases: HTMLCanvasElement[] = [];
let origAudioContext: unknown;

function attachRuntime(app: TestSmallWorldMachine): Renderer {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 320 });
  Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 200 });
  attachedCanvases.push(canvas);
  app.canvas = canvas;

  const renderer = {
    type: RendererType.WEB_GL2,
    postProcessing: new PostProcessingGroup(),
    frameInfo: createFrameInfo(),
    render: (): void => {},
    setSize: (): void => {},
  } as unknown as Renderer;
  app.renderer = renderer;
  return renderer;
}

function makeDeepTree(): Scene {
  const scene = new Scene();
  const a = new Object3D("a");
  const b = new Object3D("b");
  const c = new Object3D("c");
  a.occlusionCulled = true;
  b.occlusionCulled = true;
  c.occlusionCulled = true;
  scene.add(a);
  a.add(b);
  b.add(c);
  return scene;
}

describe("SmallWorldMachine.notifyCameraTeleport (S3 DP-4A)", () => {
  beforeEach(() => {
    origAudioContext = (window as unknown as { AudioContext: unknown }).AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = class {
      constructor() {
        return makeMockAudioContext();
      }
    };
  });

  afterEach(() => {
    (window as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
    for (const canvas of attachedCanvases.splice(0)) {
      document.body.removeChild(canvas);
    }
  });

  it("resets occlusionCulled scene-wide (including nested descendants) on a camera teleport", () => {
    const app = new TestSmallWorldMachine();
    attachRuntime(app); // stub renderer WITHOUT notifyCameraTeleport -> optional fan-out skipped
    app.scene = makeDeepTree();

    const grandchildren = app.scene.objects[0]!.children[0]!.children[0]!;
    app.notifyCameraTeleport();

    for (const obj of [app.scene.objects[0]!, app.scene.objects[0]!.children[0]!, grandchildren]) {
      expect(obj.occlusionCulled).toBe(false);
    }
  });

  it("fans out to the renderer's tier-honest notifyCameraTeleport with this scene, then walks occlusion", () => {
    const app = new TestSmallWorldMachine();
    const renderer = attachRuntime(app);
    const teleport = vi.fn((_scene: Scene): void => {});
    (renderer as unknown as { notifyCameraTeleport: (s: Scene) => void }).notifyCameraTeleport =
      teleport;
    app.scene = makeDeepTree();

    app.notifyCameraTeleport();

    expect(teleport).toHaveBeenCalledTimes(1);
    expect(teleport).toHaveBeenCalledWith(app.scene);
    expect(app.scene.objects[0]!.occlusionCulled).toBe(false);
  });

  it("is synchronous, void, idempotent and safe to call before start()", () => {
    const app = new TestSmallWorldMachine();
    const renderer = attachRuntime(app);
    const teleport = vi.fn((): void => {});
    (renderer as unknown as { notifyCameraTeleport: () => void }).notifyCameraTeleport = teleport;
    app.scene = makeDeepTree();

    expect(app.notifyCameraTeleport()).toBeUndefined();
    expect(() => app.notifyCameraTeleport()).not.toThrow();

    expect(teleport).toHaveBeenCalledTimes(2);
  });

  it("WebGL1 keeps the honest tier no-op (ADR 0043): no temporal/occlusion state to invalidate", () => {
    const renderer = new WebGL1Renderer();
    expect(() => renderer.notifyCameraTeleport(new Scene())).not.toThrow();
  });

  it("WebGL2 no-ops cleanly when no post chain was ever created (post-processing off)", () => {
    const renderer = new WebGL2Renderer();
    expect(() => renderer.notifyCameraTeleport(new Scene())).not.toThrow();
  });
});

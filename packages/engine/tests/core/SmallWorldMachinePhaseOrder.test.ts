// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SmallWorldMachine } from "../../src/core/index.js";
import { RendererType } from "../../src/enums/index.js";
import { createFrameInfo, type Renderer } from "../../src/interfaces/index.js";
import { PostProcessingGroup } from "../../src/renderers/post/index.js";
import { makeMockAudioContext } from "../audio/mockAudioContext.js";

/**
 * S3 DP-1 / DP-7 (S3-now): the per-frame phase order of `SmallWorldMachine.step()` is a pinned
 * contract (registry ID FRAME-ORDER, ADR 0047). A future reorder of the phases breaks loudly here:
 *
 *   physics -> render-interpolation -> camera (update/updateViewMatrix) -> lights (cascades from
 *   the CURRENT camera pose) -> frustum cull (on interpolated render bounds) -> render.
 *
 * Rationale (dossier M1/M2/M3/M4): cascades must follow this frame's camera pose (not last
 * frame's), the follow-camera must not lag one frame behind, and culling must test the
 * interpolated render pose instead of the discrete simulated pose.
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

// Copied from `SmallWorldMachineCaptureStepping.test.ts`: jsdom has no GPU, so the loop body is
// exercised against a stubbed canvas + renderer (real size so the render path stays active).
function attachTestRuntime(app: TestSmallWorldMachine): void {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 320 });
  Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 200 });
  attachedCanvases.push(canvas);
  app.canvas = canvas;

  app.renderer = {
    type: RendererType.WEB_GL2,
    postProcessing: new PostProcessingGroup(),
    frameInfo: createFrameInfo(),
    render: (): void => {},
    setSize: (): void => {},
  } as unknown as Renderer;
}

describe("SmallWorldMachine.step phase order oracle (S3 DP-1A, FRAME-ORDER)", () => {
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

  it("pins physics -> interp -> camera -> lights -> cull -> render call ordering", () => {
    const app = new TestSmallWorldMachine();
    attachTestRuntime(app);
    app.config.enablePhysics = true;

    const order: string[] = [];
    vi.spyOn(app.physics, "step").mockImplementation((): void => {
      order.push("physics.step");
    });
    vi.spyOn(app.physics, "applyRenderInterpolation").mockImplementation((): void => {
      order.push("applyRenderInterpolation");
    });
    vi.spyOn(app.camera, "update").mockImplementation((): void => {
      order.push("camera.update");
    });
    vi.spyOn(app.scene, "updateLights").mockImplementation((): void => {
      order.push("updateLights");
    });
    // `_frustumCuller` is a private readonly field; replacing the instance at runtime is exactly
    // how the order of the culling phase can be observed without touching internals elsewhere.
    (app as unknown as { _frustumCuller: { cull: () => number } })._frustumCuller = {
      cull: (): number => {
        order.push("cull");
        return 0;
      },
    };
    vi.spyOn(app.renderer, "render").mockImplementation((): void => {
      order.push("render");
    });

    app.step(1 / 60);

    expect(order).toEqual([
      "physics.step",
      "applyRenderInterpolation",
      "camera.update",
      "updateLights",
      "cull",
      "render",
    ]);
  });
});

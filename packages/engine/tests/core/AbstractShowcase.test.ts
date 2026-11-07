// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AbstractShowcase,
  SHOWCASE_READY_EVENT,
} from "../../src/core/showcase/AbstractShowcase.js";
import { SmallWorldMachine } from "../../src/core/index.js";
import { ProjectionType, RendererType } from "../../src/enums/index.js";
import type { PerspectiveProjection } from "../../src/math/index.js";
import { OrthographicProjection } from "../../src/math/index.js";
import { makeMockAudioContext } from "../audio/mockAudioContext.js";

class TestShowcase extends AbstractShowcase {
  public debugToggled = false;

  protected override async setupScene(): Promise<void> {
    // Test implementation
  }

  protected override onKeyDown(event: KeyboardEvent): void {
    super.onKeyDown(event);
    if (event.code === "KeyB") {
      this.debugToggled = true;
    }
  }
}

/** Exposes the protected camera-configuration surface for unit tests. */
class CameraShowcase extends TestShowcase {
  public configure(): void {
    this.configureCamera();
  }

  public setFov(value: number): void {
    this.defaultFov = value;
  }

  public setNear(value: number): void {
    this.defaultNear = value;
  }

  public setFar(value: number): void {
    this.defaultFar = value;
  }
}

describe("AbstractShowcase Lifecycle & Event Listener Cleanup", () => {
  let origAudioContext: unknown;

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
  });

  it("removes keydown listener and navigation buttons upon destroy()", () => {
    const showcase = new TestShowcase();

    // Trigger keydown while alive
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyB" }));
    expect(showcase.debugToggled).toBe(true);

    showcase.debugToggled = false;

    // Destroy showcase
    showcase.destroy();

    // Trigger keydown after destroy
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyB" }));
    expect(showcase.debugToggled).toBe(false);
  });
});

describe("AbstractShowcase Scene-Ready Signal", () => {
  let origAudioContext: unknown;
  let origRaf: unknown;
  let startSpy: ReturnType<typeof vi.spyOn>;

  const setRaf = (impl: ((cb: FrameRequestCallback) => number) | undefined): void => {
    const w = window as unknown as { requestAnimationFrame?: (cb: FrameRequestCallback) => number };
    if (impl === undefined) {
      delete w.requestAnimationFrame;
    } else {
      w.requestAnimationFrame = impl;
    }
  };

  beforeEach(() => {
    origAudioContext = (window as unknown as { AudioContext: unknown }).AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = class {
      constructor() {
        return makeMockAudioContext();
      }
    };

    // jsdom does not implement requestAnimationFrame; emulate it by invoking the callback
    // synchronously (twice, matching the two-frame wait in `_waitForStableFrame`).
    origRaf = (
      window as unknown as { requestAnimationFrame?: (cb: FrameRequestCallback) => number }
    ).requestAnimationFrame;
    setRaf((cb: FrameRequestCallback): number => {
      cb(Date.now());
      return 1;
    });

    // Avoid spinning up a real renderer (needs a WebGL context): the base `start()` only needs
    // to resolve so the showcase-level readiness logic runs.
    startSpy = vi.spyOn(SmallWorldMachine.prototype, "start").mockResolvedValue(undefined);
  });

  afterEach(() => {
    (window as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
    setRaf(origRaf as ((cb: FrameRequestCallback) => number) | undefined);
    startSpy.mockRestore();
  });

  it("dispatches a scene-ready event after start() completes", async () => {
    const showcase = new TestShowcase();
    const listener = vi.fn();
    window.addEventListener(SHOWCASE_READY_EVENT, listener);

    await showcase.start();
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(SHOWCASE_READY_EVENT, listener);
    showcase.destroy();
  });

  it("resolves even when requestAnimationFrame is unavailable", async () => {
    setRaf(undefined);
    const showcase = new TestShowcase();
    const listener = vi.fn();
    window.addEventListener(SHOWCASE_READY_EVENT, listener);

    await showcase.start();
    await new Promise((r) => setTimeout(r, 1700));

    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(SHOWCASE_READY_EVENT, listener);
    showcase.destroy();
  });
});

describe("AbstractShowcase Renderer-Switch Hotkeys (Option/Alt+1/2/3)", () => {
  let origAudioContext: unknown;
  let showcase: TestShowcase;
  let switchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    origAudioContext = (window as unknown as { AudioContext: unknown }).AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = class {
      constructor() {
        return makeMockAudioContext();
      }
    };
    showcase = new TestShowcase();
    switchSpy = vi
      .spyOn(
        TestShowcase.prototype as unknown as { _switchRenderer(type: RendererType): void },
        "_switchRenderer",
      )
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    (window as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
    switchSpy.mockRestore();
    showcase.destroy();
  });

  it("Option/Alt+1 switches to WebGL1", () => {
    const ev = new KeyboardEvent("keydown", { code: "Digit1", altKey: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(switchSpy).toHaveBeenCalledWith(RendererType.WEB_GL1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Option/Alt+2 switches to WebGL2", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", altKey: true }));
    expect(switchSpy).toHaveBeenCalledWith(RendererType.WEB_GL2);
  });

  it("Option/Alt+3 switches to WebGPU", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", altKey: true }));
    expect(switchSpy).toHaveBeenCalledWith(RendererType.WEB_GPU);
  });

  it("does not switch without the exclusive Option/Alt modifier", () => {
    // Bare digit, Shift+digit, and AltGr (ctrl+alt) must all stay inert.
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", shiftKey: true }));
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Digit3", altKey: true, ctrlKey: true }),
    );
    expect(switchSpy).not.toHaveBeenCalled();
  });

  it("still routes existing showcase keys through to subclass handlers", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyB" }));
    expect(showcase.debugToggled).toBe(true);
  });
});

describe("AbstractShowcase Renderer URL Override", () => {
  let origAudioContext: unknown;

  beforeEach(() => {
    origAudioContext = (window as unknown as { AudioContext: unknown }).AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = class {
      constructor() {
        return makeMockAudioContext();
      }
    };
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    (window as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
    window.history.replaceState({}, "", "/");
  });

  it("honors the rendererType query parameter", () => {
    window.history.replaceState({}, "", "/?rendererType=WEB_GL2");
    const showcase = new TestShowcase();
    expect(showcase.config.rendererType).toBe(RendererType.WEB_GL2);
    showcase.destroy();
  });

  it("ignores the removed api query parameter alias", () => {
    window.history.replaceState({}, "", "/?api=webgl2");
    const showcase = new TestShowcase();
    expect(showcase.config.rendererType).not.toBe(RendererType.WEB_GL2);
    showcase.destroy();
  });

  it("writes the rendererType override into the URL preserving other params", () => {
    window.history.replaceState({}, "", "/apps/showcases/35/index.html?param=keep");
    const parsed = new URL(window.location.href);
    const locStub = {
      href: window.location.href,
      pathname: parsed.pathname,
      search: parsed.search,
    };
    const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
    Object.defineProperty(window, "location", { configurable: true, value: locStub });

    const showcase = new TestShowcase();
    (showcase as unknown as { _switchRenderer(type: RendererType): void })._switchRenderer(
      RendererType.WEB_GPU,
    );

    expect(locStub.href).toContain("rendererType=WEB_GPU");
    expect(locStub.href).toContain("param=keep");

    if (originalLocation) Object.defineProperty(window, "location", originalLocation);
    showcase.destroy();
  });
});

describe("AbstractShowcase Camera Configuration (aspect from canvas size)", () => {
  const setCanvasSize = (canvas: HTMLCanvasElement, w: number, h: number): void => {
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: w });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: h });
  };

  let origAudioContext: unknown;
  let showcase: CameraShowcase;

  beforeEach(() => {
    origAudioContext = (window as unknown as { AudioContext: unknown }).AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = class {
      constructor() {
        return makeMockAudioContext();
      }
    };
    showcase = new CameraShowcase();
    showcase.canvas = document.createElement("canvas");
    setCanvasSize(showcase.canvas, 1600, 900);
  });

  afterEach(() => {
    (window as unknown as { AudioContext: unknown }).AudioContext = origAudioContext;
    showcase.destroy();
  });

  it("builds a perspective projection from the canvas size and the showcase defaults", () => {
    showcase.configure();

    const proj = showcase.camera.projection as PerspectiveProjection;
    expect(proj.type).toBe(ProjectionType.PERSPECTIVE);
    expect(proj.fov).toBeCloseTo((65 * Math.PI) / 180, 10);
    expect(proj.aspect).toBeCloseTo(1600 / 900, 10);
    expect(proj.near).toBeCloseTo(0.1, 10);
    expect(proj.far).toBeCloseTo(1000, 10);
  });

  it("keeps the showcase's own fov/near/far when the fields are overridden", () => {
    showcase.setFov((48 * Math.PI) / 180);
    showcase.setNear(0.5);
    showcase.setFar(150);
    showcase.configure();

    const proj = showcase.camera.projection as PerspectiveProjection;
    expect(proj.fov).toBeCloseTo((48 * Math.PI) / 180, 10);
    expect(proj.near).toBeCloseTo(0.5, 10);
    expect(proj.far).toBeCloseTo(150, 10);
    expect(proj.aspect).toBeCloseTo(1600 / 900, 10);
  });

  it("keeps a finite aspect when the canvas is hidden (clientHeight 0)", () => {
    showcase.configure();
    setCanvasSize(showcase.canvas!, 0, 0);
    showcase.configure();

    const proj = showcase.camera.projection as PerspectiveProjection;
    expect(Number.isFinite(proj.aspect)).toBe(true);
    expect(proj.aspect).toBeCloseTo(1600 / 900, 10);
  });

  it("derives the aspect from the canvas, not the window", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 640 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 480 });
    showcase.configure();

    const proj = showcase.camera.projection as PerspectiveProjection;
    expect(proj.aspect).toBeCloseTo(1600 / 900, 10);
    delete (window as { innerWidth?: unknown }).innerWidth;
    delete (window as { innerHeight?: unknown }).innerHeight;
  });

  it("leaves a non-perspective projection untouched", () => {
    showcase.camera.projection = new OrthographicProjection({ near: -1000, far: 1000 });
    showcase.configure();

    expect(showcase.camera.projection.type).not.toBe(ProjectionType.PERSPECTIVE);
    expect(showcase.camera.projection.near).toBe(-1000);
    expect(showcase.camera.projection.far).toBe(1000);
  });

  it("is a no-op when no canvas is present yet", () => {
    showcase.canvas = undefined!;
    expect(() => showcase.configure()).not.toThrow();
  });
});

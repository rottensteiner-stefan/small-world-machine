// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AbstractShowcase,
  SHOWCASE_READY_EVENT,
} from "../../src/core/showcase/AbstractShowcase.js";
import { SmallWorldMachine } from "../../src/core/index.js";
import { RendererType } from "../../src/enums/index.js";
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

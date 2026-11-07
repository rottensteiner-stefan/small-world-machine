// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { ToolModeHost } from "../../src/maker/ToolModeHost.js";
import { ModeHashRouter, writeModeHash } from "../../src/maker/ModeHashRouter.js";
import type { ToolMode } from "../../src/maker/ToolMode.js";

function mode(
  id: string,
  opts: { failMount?: boolean; failInit?: boolean } = {},
): ToolMode & { unmounts: number; inits: number } {
  const m = {
    modeId: id,
    unmounts: 0,
    inits: 0,
    initialize(): void {
      m.inits++;
      if (opts.failInit) throw new Error("init boom");
    },
    mount(): void {
      if (opts.failMount) throw new Error("mount boom");
    },
    unmount(): void {
      m.unmounts++;
    },
    getState: (): unknown => undefined,
    setState: (): void => {},
  };
  return m;
}

describe("ToolModeHost robustness", () => {
  it("a failing mount leaves NO active mode (not the already-unmounted old one)", () => {
    const host = new ToolModeHost(document.createElement("div"));
    const a = mode("a");
    host.register(a);
    host.register(mode("b", { failMount: true }));
    host.activate("a");
    expect(() => host.activate("b")).toThrow("mount boom");
    expect(a.unmounts).toBe(1);
    expect(host.activeModeId).toBeUndefined();
    // the old mode can be re-activated afterwards (it would be a no-op if the id were stale)
    host.activate("a");
    expect(host.activeModeId).toBe("a");
  });

  it("a failing initialize is retried on the next activation", () => {
    const host = new ToolModeHost(document.createElement("div"));
    const b = mode("b", { failInit: true });
    host.register(b);
    expect(() => host.activate("b")).toThrow();
    expect(() => host.activate("b")).toThrow();
    expect(b.inits).toBe(2);
  });

  it("dispose unmounts the active mode and clears it", () => {
    const host = new ToolModeHost(document.createElement("div"));
    const a = mode("a");
    host.register(a);
    host.activate("a");
    host.dispose();
    expect(a.unmounts).toBe(1);
    expect(host.activeModeId).toBeUndefined();
    host.dispose();
    expect(a.unmounts).toBe(1);
  });
});

describe("ModeHashRouter history hygiene", () => {
  it("correcting an unknown hash replaces instead of pushing a history entry", () => {
    const host = new ToolModeHost(document.createElement("div"));
    host.register(mode("world"));
    window.location.hash = "#nope";
    const before = window.history.length;
    const router = new ModeHashRouter(host);
    router.start();
    expect(window.location.hash).toBe("#world");
    expect(window.history.length).toBe(before);
    router.stop();
  });

  it("writeModeHash(replace) does not grow history", () => {
    const before = window.history.length;
    writeModeHash("pixler", true);
    expect(window.location.hash).toBe("#pixler");
    expect(window.history.length).toBe(before);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolModeHost } from "../../src/maker/ToolModeHost.js";
import { ModeHashRouter, readModeHash, writeModeHash } from "../../src/maker/ModeHashRouter.js";
import type { ToolMode } from "../../src/maker/ToolMode.js";

function stubMode(id: string): ToolMode {
  return {
    modeId: id,
    initialize(): void {},
    mount(_hostEl: HTMLElement): void {},
    unmount(): void {},
    getState(): unknown {
      return undefined;
    },
    setState(_state: unknown): void {},
  };
}

describe("ModeHashRouter", () => {
  let hostEl: HTMLElement;
  let host: ToolModeHost;
  let writeCalls: string[];

  beforeEach(() => {
    hostEl = document.createElement("div");
    host = new ToolModeHost(hostEl);
    host.register(stubMode("world"));
    host.register(stubMode("pixler"));
    writeCalls = [];
  });

  it("boots into the mode selected by the initial hash", () => {
    const router = new ModeHashRouter(host, {
      readHash: (): string => "#pixler",
      writeHash: (id: string): void => {
        writeCalls.push(id);
      },
    });
    router.start();

    expect(router.activeModeId).toBe("pixler");
    expect(writeCalls).toEqual([]);
    router.stop();
  });

  it("falls back to the default world mode on an unknown hash and normalises it", () => {
    const router = new ModeHashRouter(host, {
      readHash: (): string => "#nope",
      writeHash: (id: string): void => {
        writeCalls.push(id);
      },
    });
    router.start();

    expect(router.activeModeId).toBe("world");
    expect(writeCalls).toEqual(["world"]);
    router.stop();
  });

  it("falls back to the default world mode when the hash is absent or empty", () => {
    for (const empty of ["", "#"]) {
      const h = new ToolModeHost(document.createElement("div"));
      h.register(stubMode("world"));
      h.register(stubMode("pixler"));
      const router = new ModeHashRouter(h, {
        readHash: (): string => empty,
        writeHash: (id: string): void => {
          writeCalls.push(id);
        },
      });
      router.start();
      expect(router.activeModeId).toBe("world");
      router.stop();
    }
  });

  it("navigate performs an in-app view swap and writes the target hash", () => {
    const router = new ModeHashRouter(host, {
      readHash: (): string => "#world",
      writeHash: (id: string): void => {
        writeCalls.push(id);
      },
    });
    router.start();
    router.navigate("pixler");

    expect(router.activeModeId).toBe("pixler");
    expect(writeCalls).toEqual(["pixler"]);
    router.stop();
  });

  it("navigate to an unknown mode falls back to the default and writes it", () => {
    const router = new ModeHashRouter(host, {
      readHash: (): string => "#world",
      writeHash: (id: string): void => {
        writeCalls.push(id);
      },
    });
    router.start();
    router.navigate("nope");

    expect(router.activeModeId).toBe("world");
    expect(writeCalls).toEqual(["world"]);
    router.stop();
  });

  it("internal switching never navigates the document", () => {
    const unloaded = vi.fn();
    window.addEventListener("beforeunload", unloaded);
    const pathBefore = window.location.pathname;
    const searchBefore = window.location.search;
    const documentBefore = document.documentElement;

    const router = new ModeHashRouter(host, {
      readHash: (): string => "#world",
      writeHash: (id: string): void => {
        writeCalls.push(id);
      },
    });
    router.start();
    router.navigate("pixler");

    expect(router.activeModeId).toBe("pixler");
    expect(unloaded).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(pathBefore);
    expect(window.location.search).toBe(searchBefore);
    expect(document.documentElement).toBe(documentBefore);

    window.removeEventListener("beforeunload", unloaded);
    router.stop();
  });

  it("readModeHash/writeModeHash round-trip against the real location in jsdom", () => {
    writeModeHash("world");
    expect(readModeHash()).toBe("#world");
    expect(window.location.hash).toBe("#world");

    writeModeHash("pixler");
    expect(readModeHash()).toBe("#pixler");

    const realRouter = new ModeHashRouter(host);
    realRouter.start();
    expect(realRouter.activeModeId).toBe("pixler");

    realRouter.navigate("world");
    expect(realRouter.activeModeId).toBe("world");
    expect(window.location.hash).toBe("#world");
    realRouter.stop();
  });

  it("stop detaches the hashchange listener", () => {
    let currentHash = "#world";
    const router = new ModeHashRouter(host, {
      readHash: (): string => currentHash,
      writeHash: (id: string): void => {
        writeCalls.push(id);
      },
    });
    router.start();
    router.stop();

    currentHash = "#pixler";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(host.activeModeId).toBe("world");
    expect(writeCalls).toEqual([]);
  });
});

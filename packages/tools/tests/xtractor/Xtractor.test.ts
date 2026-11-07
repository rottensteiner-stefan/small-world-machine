// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventDispatcherImpl } from "@small-world-machine/engine";
import { Xtractor } from "../../src/Xtractor.js";

const SOURCES = [
  "../../src/Xtractor.ts",
  "../../src/xtractor/AiChatPanel.ts",
  "../../src/xtractor/CanvasSelection.ts",
  "../../src/xtractor/CanvasViewport.ts",
];

function queriedIds(): string[] {
  const ids = new Set<string>();
  for (const file of SOURCES) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const match of text.matchAll(/(?:querySelector|_query)(?:<[^>]*>)?\("#([\w-]+)"\)/g)) {
      ids.add(match[1]!);
    }
  }
  return [...ids];
}

describe("Xtractor mount", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
  });

  it("builds markup containing every id the logic queries", () => {
    const tool = new Xtractor(new EventDispatcherImpl());
    const container = (tool as unknown as { _container: HTMLElement })._container;
    const ids = queriedIds();
    expect(ids.length).toBeGreaterThan(30);
    const missing = ids.filter((id) => null === container.querySelector(`#${id}`));
    expect(missing).toEqual([]);
  });

  it("removes its document splitter listeners and resets the cursor when unmounted mid-drag", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const tool = new Xtractor(new EventDispatcherImpl());
    const container = (tool as unknown as { _container: HTMLElement })._container;
    const splitter = container.querySelector<HTMLElement>("#splitter")!;

    const docListeners = addSpy.mock.calls.filter(
      ([type]) => type === "mousemove" || type === "mouseup",
    );
    expect(docListeners).toHaveLength(2);

    splitter.dispatchEvent(new MouseEvent("mousedown"));
    expect(document.body.style.cursor).toBe("col-resize");
    container.getBoundingClientRect = (): DOMRect =>
      ({ right: 1000, width: 1000 }) as unknown as DOMRect;
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400 }));
    expect(container.querySelector<HTMLElement>("#sidebar")!.style.width).toBe("600px");
    container.querySelector<HTMLElement>("#sidebar")!.style.width = "";

    tool.unmount();
    expect(document.body.style.cursor).toBe("");
    const sidebar = container.querySelector<HTMLElement>("#sidebar")!;
    container.getBoundingClientRect = (): DOMRect =>
      ({ right: 1000, width: 1000 }) as unknown as DOMRect;
    // Listener is gone: a further move must not resize (dragging flag was reset as well).
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 400 }));
    expect(sidebar.style.width).toBe("");
    addSpy.mockRestore();
  });
});

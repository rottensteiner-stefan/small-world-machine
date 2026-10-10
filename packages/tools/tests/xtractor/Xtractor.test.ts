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
});

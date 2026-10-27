// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { KitValidatorTool } from "../../src/kit-inspector/KitValidatorTool.js";
import { ZipAssetSink } from "../../src/common/io/sinks/ZipAssetSink.js";
import { ZipAssetSource } from "../../src/common/io/sources/ZipAssetSource.js";
import type { IngestResult } from "../../src/common/io/UniversalIngestTypes.js";

interface IngestTarget {
  _onIngest(result: IngestResult): Promise<void>;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const manifest = {
  id: "dungeon",
  name: "Dungeon Kit",
  version: "1.0.0",
  description: "Modular dungeon props",
  author: "Test",
  license: "CC0",
  items: [
    {
      id: "dungeon/wall_01",
      name: "Stone Wall",
      category: "walls",
      path: "models/wall.glb",
      preview: "previews/wall.png",
      meta: "meta/wall.json",
    },
  ],
};

async function ingestOf(files: Record<string, string>): Promise<IngestResult> {
  const sink = new ZipAssetSink();
  for (const [path, text] of Object.entries(files)) {
    await sink.write(path, new TextEncoder().encode(text));
  }
  const source = await ZipAssetSource.fromBytes(await sink.build());
  return { kind: "gltf", source, mainFile: "kit.json", name: "kit.zip" };
}

function mount(): { host: HTMLElement; tool: KitValidatorTool } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return { host, tool: new KitValidatorTool({ parent: host }) };
}

describe("KitValidatorTool", () => {
  it("shows the verdict, kit meta and counts for a valid kit", async () => {
    const { host, tool } = mount();
    const ingest = await ingestOf({
      "kit.json": JSON.stringify(manifest),
      "models/wall.glb": "glb",
      "previews/wall.png": "png",
      "meta/wall.json": "{}",
    });

    await (tool as unknown as IngestTarget)._onIngest(ingest);

    expect(host.querySelector("h2")?.textContent).toContain("Dungeon Kit");
    expect(host.querySelector<HTMLElement>(".kitval-verdict")?.dataset["valid"]).toBe("true");
    expect(host.querySelector(".kitval-meta")?.textContent).toContain("items: 1");
    expect(host.querySelectorAll(".kitval-issues li").length).toBe(0);
    tool.unmount();
  });

  it("lists errors before warnings for a kit without a valid manifest and missing files", async () => {
    const { host, tool } = mount();
    const broken = await ingestOf({ "kit.json": JSON.stringify({ ...manifest, version: "x" }) });

    await (tool as unknown as IngestTarget)._onIngest(broken);

    expect(host.querySelector<HTMLElement>(".kitval-verdict")?.dataset["valid"]).toBe("false");
    const severities = [...host.querySelectorAll<HTMLElement>(".kitval-issues li")].map(
      (li) => li.dataset["severity"],
    );
    expect(severities.length).toBeGreaterThan(0);
    expect(severities).toEqual([...severities].sort((a, b) => rank(a) - rank(b)));
    tool.unmount();
  });

  it("reports a missing kit.json as an error", async () => {
    const { host, tool } = mount();

    await (tool as unknown as IngestTarget)._onIngest(await ingestOf({ "readme.txt": "none" }));

    expect(host.querySelector<HTMLElement>(".kitval-verdict")?.dataset["valid"]).toBe("false");
    expect(host.querySelector(".kitval-issues")?.textContent).toContain("kit.json");
    tool.unmount();
  });

  it("ignores ingest kinds that are not a kit", async () => {
    const { host, tool } = mount();

    await (tool as unknown as IngestTarget)._onIngest({ kind: "text", text: "x", name: "a.txt" });

    expect(host.querySelector(".kitval-verdict")).toBeNull();
    tool.unmount();
  });

  it("removes its DOM and the dropzone's window listeners on unmount", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");

    const tool = new KitValidatorTool({ parent: host });
    const registered = added.mock.calls.filter(([type]) => type === "drop" || type === "paste");
    expect(registered.length).toBeGreaterThan(0);

    tool.unmount();

    expect(host.children.length).toBe(0);
    for (const [type, handler] of registered) {
      expect(removed).toHaveBeenCalledWith(type, handler);
    }
  });
});

function rank(severity: string | undefined): number {
  return ["error", "warning", "info"].indexOf(severity ?? "");
}

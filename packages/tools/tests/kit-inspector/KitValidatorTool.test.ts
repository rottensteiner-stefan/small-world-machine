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

  describe("copying the report", () => {
    const brokenKit = (): Promise<IngestResult> =>
      ingestOf({ "kit.json": JSON.stringify({ ...manifest, version: "x" }) });

    /** A `copy` event whose `clipboardData` collects what the handler writes. */
    function copyEvent(): { event: Event; written: Map<string, string> } {
      const written = new Map<string, string>();
      const event = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { setData: (type: string, data: string): void => void written.set(type, data) },
      });
      return { event, written };
    }

    it("copies the report text from the button, in the shape swm kit validate prints", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      const { host, tool } = mount();
      await (tool as unknown as IngestTarget)._onIngest(await brokenKit());

      host.querySelector<HTMLButtonElement>('[data-kitval="copy"]')!.click();
      await Promise.resolve();

      const text = writeText.mock.calls[0]![0] as string;
      expect(text).toMatch(/^\[error\] .+\n?/);
      expect(text.split("\n").at(-1)).toMatch(/^INVALID \(Dungeon Kit, \d+ issues?\)$/);
      tool.unmount();
    });

    it("answers Cmd/Ctrl+C with the report while nothing is selected", async () => {
      const { tool } = mount();
      await (tool as unknown as IngestTarget)._onIngest(await brokenKit());
      const { event, written } = copyEvent();

      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(written.get("text/plain")).toContain("INVALID");
      tool.unmount();
    });

    it("leaves a real text selection and text fields alone", async () => {
      const { host, tool } = mount();
      await (tool as unknown as IngestTarget)._onIngest(await brokenKit());

      const field = document.createElement("input");
      host.appendChild(field);
      const inField = copyEvent();
      field.dispatchEvent(inField.event);
      expect(inField.event.defaultPrevented).toBe(false);

      const selected = host.querySelector(".kitval-issues li")!;
      document.getSelection()!.selectAllChildren(selected);
      const withSelection = copyEvent();
      document.dispatchEvent(withSelection.event);
      expect(withSelection.event.defaultPrevented).toBe(false);
      expect(withSelection.written.size).toBe(0);
      tool.unmount();
    });

    it("has nothing to copy before a kit was checked, and stops answering after unmount", async () => {
      const { tool } = mount();
      const early = copyEvent();
      document.dispatchEvent(early.event);
      expect(early.event.defaultPrevented).toBe(false);

      await (tool as unknown as IngestTarget)._onIngest(await brokenKit());
      tool.unmount();
      const late = copyEvent();
      document.dispatchEvent(late.event);
      expect(late.event.defaultPrevented).toBe(false);
    });
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

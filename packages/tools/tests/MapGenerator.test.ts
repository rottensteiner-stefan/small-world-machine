// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MapGenerator } from "../src/MapGenerator.js";
import type { IngestResult } from "../src/common/io/UniversalIngestTypes.js";

describe("MapGenerator Tool & Universal IO Ingest", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("initializes with default grid and UI elements", () => {
    const mapGen = new MapGenerator({ parent: container });

    expect(mapGen.getMapString()).toBeDefined();
    const rows = mapGen.getMapString().split("\n");
    expect(rows.length).toBe(25);
    expect(rows[0]!.length).toBe(40);

    // Verify Dropzone container is mounted
    const dropzone = container.querySelector(".sw-universal-dropzone");
    expect(dropzone).not.toBeNull();

    mapGen.dispose();
  });

  it("clears only on the second click and never opens a blocking confirm dialog", () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    vi.useFakeTimers();
    const mapGen = new MapGenerator({ parent: container });
    mapGen.loadMapString("WWWW\nW..W\nWWWW");
    const button = container.querySelector<HTMLButtonElement>("#mapgen-btn-clear")!;

    button.click();
    expect(button.textContent).toContain("nochmal");
    expect(mapGen.getMapString()).toBe("WWWW\nW..W\nWWWW");

    button.click();
    expect(button.textContent).toBe("Clear Map");
    expect(mapGen.getMapString()).not.toContain("W");
    expect(confirmSpy).not.toHaveBeenCalled();

    mapGen.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("disarms the clear button when the second click does not come in time", () => {
    vi.useFakeTimers();
    const mapGen = new MapGenerator({ parent: container });
    mapGen.loadMapString("WWWW\nW..W\nWWWW");
    const button = container.querySelector<HTMLButtonElement>("#mapgen-btn-clear")!;

    button.click();
    vi.advanceTimersByTime(3100);
    expect(button.textContent).toBe("Clear Map");
    button.click(); // arms again instead of clearing
    expect(mapGen.getMapString()).toBe("WWWW\nW..W\nWWWW");

    mapGen.dispose();
    vi.useRealTimers();
  });

  it("loads raw ASCII map text", () => {
    const mapGen = new MapGenerator({ parent: container });
    const testMap = `WWWW\nW..W\nWWWW`;

    mapGen.loadMapString(testMap);
    expect(mapGen.getMapString()).toBe(testMap);

    mapGen.dispose();
  });

  it("handles Universal Ingest with kind: 'text'", async () => {
    const mapGen = new MapGenerator({ parent: container });
    const testMap = `WWWWW\nW.P.W\nWWWWW`;

    const ingestResult: IngestResult = {
      kind: "text",
      text: testMap,
      name: "level1.map",
    };

    // Call internal ingest handler directly
    // @ts-expect-error - testing private ingest handler
    await mapGen._handleIngestResult(ingestResult);

    expect(mapGen.getMapString()).toBe(testMap);
    mapGen.dispose();
  });

  it("handles Universal Ingest with kind: 'json' (array of strings)", async () => {
    const mapGen = new MapGenerator({ parent: container });
    const jsonRows = ["WWWWWW", "W.E..W", "WWWWWW"];

    const ingestResult: IngestResult = {
      kind: "json",
      data: jsonRows,
      rawText: JSON.stringify(jsonRows),
      name: "level.json",
    };

    // @ts-expect-error - testing private ingest handler
    await mapGen._handleIngestResult(ingestResult);

    expect(mapGen.getMapString()).toBe(jsonRows.join("\n"));
    mapGen.dispose();
  });

  it("handles Universal Ingest with kind: 'json' (object with map/grid property)", async () => {
    const mapGen = new MapGenerator({ parent: container });
    const jsonMap = {
      name: "Dungeon 1",
      map: "WWWW\nW+OW\nWWWW",
    };

    const ingestResult: IngestResult = {
      kind: "json",
      data: jsonMap,
      rawText: JSON.stringify(jsonMap),
      name: "dungeon.json",
    };

    // @ts-expect-error - testing private ingest handler
    await mapGen._handleIngestResult(ingestResult);

    expect(mapGen.getMapString()).toBe(jsonMap.map);
    mapGen.dispose();
  });

  it("handles Universal Ingest with kind: 'archive'", async () => {
    const mapGen = new MapGenerator({ parent: container });
    const testMap = "WWWWWW\nW.T~.W\nWWWWWW";
    const textData = new TextEncoder().encode(testMap);

    const ingestResult: IngestResult = {
      kind: "archive",
      name: "level_bundle.zip",
      files: [
        {
          name: "dungeon.map",
          path: "dungeon.map",
          size: textData.byteLength,
          mimeType: "text/plain",
          data: textData,
          blob: new Blob([textData]),
        },
      ],
    };

    // @ts-expect-error - testing private ingest handler
    await mapGen._handleIngestResult(ingestResult);

    expect(mapGen.getMapString()).toBe(testMap);
    mapGen.dispose();
  });

  it("handles Universal Ingest with kind: 'files'", async () => {
    const mapGen = new MapGenerator({ parent: container });
    const testMap = "WWWW\nWbbW\nWWWW";
    const file = new File([testMap], "custom_room.txt", { type: "text/plain" });

    const ingestResult: IngestResult = {
      kind: "files",
      name: "1 Dateien",
      files: [file],
    };

    // @ts-expect-error - testing private ingest handler
    await mapGen._handleIngestResult(ingestResult);

    expect(mapGen.getMapString()).toBe(testMap);
    mapGen.dispose();
  });

  it("getState and setState round-trip correctly", () => {
    const mapGen = new MapGenerator({ parent: container });
    const map = "WWWW\nW..W\nWWWW";

    mapGen.setState(map);
    expect(mapGen.getState()).toBe(map);

    mapGen.dispose();
  });
});

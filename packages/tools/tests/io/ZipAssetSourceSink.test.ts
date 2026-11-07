import { describe, it, expect } from "vitest";
import { ZipAssetSink } from "../../src/common/io/sinks/ZipAssetSink.js";
import { ZipAssetSource } from "../../src/common/io/sources/ZipAssetSource.js";

describe("ZipAssetSource & ZipAssetSink Roundtrip", () => {
  it("writes files into ZipAssetSink and reads them back via ZipAssetSource", async () => {
    const sink = new ZipAssetSink({ id: "test-sink" });

    await sink.write("kit.json", JSON.stringify({ name: "Test Kit", version: "1.0.0" }));
    await sink.write("props/test.txt", "Hello 3D World!");
    await sink.write("data/binary.bin", new Uint8Array([1, 2, 3, 4, 5]));

    const zipBlob = await sink.finalize();
    expect(zipBlob).toBeDefined();
    expect(zipBlob.size).toBeGreaterThan(0);

    const source = await ZipAssetSource.fromBuffer(zipBlob, { id: "test-source" });

    const files = await source.list();
    expect(files.sort()).toEqual(["data/binary.bin", "kit.json", "props/test.txt"]);

    expect(await source.has("kit.json")).toBe(true);
    expect(await source.has("nonexistent.gltf")).toBe(false);

    const kitJson = await source.readJson<{ name: string; version: string }>("kit.json");
    expect(kitJson.name).toBe("Test Kit");
    expect(kitJson.version).toBe("1.0.0");

    const text = await source.readText("props/test.txt");
    expect(text).toBe("Hello 3D World!");

    const binary = await source.read("data/binary.bin");
    expect(Array.from(binary)).toEqual([1, 2, 3, 4, 5]);

    // Test virtual fetch handler
    const virtualFetch = source.toFetch("sw-asset://test-source/");
    const resp = await virtualFetch("sw-asset://test-source/kit.json");
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("application/json");
    const json = await resp.json();
    expect(json.name).toBe("Test Kit");

    const notFoundResp = await virtualFetch("sw-asset://test-source/unknown.png");
    expect(notFoundResp.status).toBe(404);
  });
});

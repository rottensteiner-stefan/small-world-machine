import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { SecurityValidator } from "../../src/common/io/Security.js";
import { ZipAssetSink } from "../../src/common/io/sinks/ZipAssetSink.js";
import { ZipAssetSource } from "../../src/common/io/sources/ZipAssetSource.js";

describe("ZipAssetSink & ZipAssetSource roundtrip", () => {
  it("should write files to ZipAssetSink, build archive, and read back via ZipAssetSource", async () => {
    const sink = new ZipAssetSink();

    const textData = new TextEncoder().encode("Hello Small World Machine Asset IO!");
    const jsonData = new TextEncoder().encode(
      JSON.stringify({ version: "1.0.0", name: "test-kit" }),
    );
    const binaryData = new Uint8Array([0, 1, 2, 3, 4, 5, 255, 254]);

    await sink.write("info.txt", textData);
    await sink.write("sub/manifest.json", jsonData);
    await sink.write("data.bin", binaryData);

    const zipBuffer = await sink.build();
    expect(zipBuffer).toBeInstanceOf(Uint8Array);
    expect(zipBuffer.byteLength).toBeGreaterThan(0);

    // Read back via ZipAssetSource
    const source = await ZipAssetSource.fromBytes(zipBuffer);
    const fileList = await source.list();

    expect(fileList.sort()).toEqual(["data.bin", "info.txt", "sub/manifest.json"]);

    const readText = await source.read("info.txt");
    expect(new TextDecoder().decode(readText)).toBe("Hello Small World Machine Asset IO!");

    const readJson = await source.read("sub/manifest.json");
    expect(JSON.parse(new TextDecoder().decode(readJson))).toEqual({
      version: "1.0.0",
      name: "test-kit",
    });

    const readBinary = await source.read("data.bin");
    expect(readBinary).toEqual(binaryData);
  });

  it("should provide toFetch bridge that serves virtual asset URLs", async () => {
    const sink = new ZipAssetSink();
    await sink.write("models/hero.gltf", new TextEncoder().encode('{"asset":{"version":"2.0"}}'));
    const zipBuffer = await sink.build();

    const source = await ZipAssetSource.fromBytes(zipBuffer);
    const virtualFetch = source.toFetch("sw-asset://test-mount/");

    const response = await virtualFetch("sw-asset://test-mount/models/hero.gltf");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe('{"asset":{"version":"2.0"}}');

    const notFound = await virtualFetch("sw-asset://test-mount/non-existent.png");
    expect(notFound.status).toBe(404);
  });

  it("should reject path traversal entries on write", async () => {
    const sink = new ZipAssetSink();
    await expect(sink.write("../outside.txt", new Uint8Array([1]))).rejects.toThrow();
  });

  it("rejects ZIP entries that declare more than the file limit (zip bomb)", async () => {
    const bomb = zipSync({ "big.bin": new Uint8Array(512 * 1024) });
    await expect(
      ZipAssetSource.fromBytes(bomb, { security: new SecurityValidator({ maxFileBytes: 1024 }) }),
    ).rejects.toThrow(/exceeds limit/);
  });

  it("skips Zip-Slip entries when loading", async () => {
    const zip = zipSync({ "../evil.bin": new Uint8Array([1]), "ok.bin": new Uint8Array([2]) });
    const source = await ZipAssetSource.fromBytes(zip);
    expect(await source.list()).toEqual(["ok.bin"]);
  });
});

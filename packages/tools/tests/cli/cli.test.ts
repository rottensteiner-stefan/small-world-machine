import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSwm } from "../../src/cli/index.js";
import type { CliIo } from "../../src/cli/index.js";
import { runIblCommand } from "../../src/cli/iblCommand.js";
import { NodePngRasterIO, type RgbaImage } from "../../src/core/RasterIO.js";
import { derivePbrMaps, MATERIAL_STUDIO_PRESETS } from "../../src/core/material.js";

interface CapturedIo {
  io: CliIo;
  stdoutText: () => string;
  stderrText: () => string;
}

function makeCapturingIo(stdin = ""): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    out: (line: string): void => {
      out.push(line);
    },
    err: (line: string): void => {
      err.push(line);
    },
    readStdin: async (): Promise<string> => stdin,
  };
  return {
    io,
    stdoutText: (): string => out.join("\n"),
    stderrText: (): string => err.join("\n"),
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "swm-cli-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function toolsVersion(): Promise<string> {
  const url = new URL("../../package.json", import.meta.url);
  const raw = await readFile(url, "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}

const VALID_KIT_MANIFEST = JSON.stringify(
  {
    id: "testkit",
    name: "Test Kit",
    version: "1.0.0",
    description: "Smoke fixture for the swm kit validate CLI.",
    author: "Ops-D",
    license: "MIT",
  },
  null,
  2,
);

describe("swm cli global surface", () => {
  it("prints usage for --help and exits 0", async () => {
    const { io, stdoutText, stderrText } = makeCapturingIo();
    const code = await runSwm(["--help"], io);
    expect(code).toBe(0);
    expect(stdoutText()).toContain("Usage:");
    expect(stdoutText()).toContain("map");
    expect(stdoutText()).toContain("kit");
    expect(stderrText()).toBe("");
  });

  it("prints usage when invoked without arguments", async () => {
    const { io, stdoutText } = makeCapturingIo();
    const code = await runSwm([], io);
    expect(code).toBe(0);
    expect(stdoutText()).toContain("Usage:");
  });

  it("prints the tools package version for --version", async () => {
    const { io, stdoutText } = makeCapturingIo();
    const code = await runSwm(["--version"], io);
    expect(code).toBe(0);
    expect(stdoutText()).toBe(`swm ${await toolsVersion()}`);
  });

  it("rejects an unknown command with a non-zero exit", async () => {
    const { io, stdoutText, stderrText } = makeCapturingIo();
    const code = await runSwm(["frobnicate"], io);
    expect(code).toBe(1);
    expect(stderrText()).toContain('unknown command "frobnicate"');
    expect(stdoutText()).toBe("");
  });
});

describe("swm map", () => {
  it("prints map usage for --help", async () => {
    const { io, stdoutText } = makeCapturingIo();
    const code = await runSwm(["map", "--help"], io);
    expect(code).toBe(0);
    expect(stdoutText()).toContain("to-json");
  });

  it("rejects an unknown map operation with a non-zero exit", async () => {
    const { io, stderrText } = makeCapturingIo();
    const code = await runSwm(["map", "bogus"], io);
    expect(code).toBe(1);
    expect(stderrText()).toContain('unknown operation "bogus"');
  });

  it("converts an ASCII map file to a JSON grid file", async () => {
    await withTempDir(async (dir) => {
      const mapPath = join(dir, "level.map");
      const outPath = join(dir, "level.json");
      await writeFile(mapPath, "WW\nW.", "utf8");
      const { io } = makeCapturingIo();
      const code = await runSwm(["map", "to-json", mapPath, outPath], io);
      expect(code).toBe(0);
      const written = await readFile(outPath, "utf8");
      expect(JSON.parse(written)).toEqual([
        ["W", "W"],
        ["W", "."],
      ]);
    });
  });

  it("writes the JSON grid to stdout when the output path is omitted", async () => {
    await withTempDir(async (dir) => {
      const mapPath = join(dir, "level.map");
      await writeFile(mapPath, "X\nX", "utf8");
      const { io, stdoutText } = makeCapturingIo();
      const code = await runSwm(["map", "to-json", mapPath], io);
      expect(code).toBe(0);
      expect(JSON.parse(stdoutText())).toEqual([["X"], ["X"]]);
    });
  });

  it("reads an ASCII map from stdin when the input is '-'", async () => {
    const { io, stdoutText } = makeCapturingIo("AB\nAB");
    const code = await runSwm(["map", "to-json", "-"], io);
    expect(code).toBe(0);
    expect(JSON.parse(stdoutText())).toEqual([
      ["A", "B"],
      ["A", "B"],
    ]);
  });

  it("converts a JSON grid back to an ASCII map file", async () => {
    await withTempDir(async (dir) => {
      const gridPath = join(dir, "grid.json");
      const outPath = join(dir, "level.map");
      await writeFile(
        gridPath,
        JSON.stringify([
          ["W", "."],
          ["W", "W"],
        ]),
        "utf8",
      );
      const { io } = makeCapturingIo();
      const code = await runSwm(["map", "from-json", gridPath, outPath], io);
      expect(code).toBe(0);
      expect(await readFile(outPath, "utf8")).toBe("W.\nWW\n");
    });
  });

  it("rejects malformed grid JSON with a non-zero exit", async () => {
    await withTempDir(async (dir) => {
      const gridPath = join(dir, "grid.json");
      await writeFile(gridPath, "[123]", "utf8");
      const { io, stderrText } = makeCapturingIo();
      const code = await runSwm(["map", "from-json", gridPath], io);
      expect(code).toBe(1);
      expect(stderrText()).toContain("swm map: error");
    });
  });

  it("reports a missing input file with a non-zero exit", async () => {
    const { io, stderrText } = makeCapturingIo();
    const code = await runSwm(["map", "to-json", "/definitely/not/here.map"], io);
    expect(code).toBe(1);
    expect(stderrText()).toContain("swm map: error");
  });
});

describe("swm kit", () => {
  it("prints kit usage for --help", async () => {
    const { io, stdoutText } = makeCapturingIo();
    const code = await runSwm(["kit", "--help"], io);
    expect(code).toBe(0);
    expect(stdoutText()).toContain("validate");
  });

  it("validates a well-formed kit directory", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "kit.json"), VALID_KIT_MANIFEST, "utf8");
      const { io, stdoutText } = makeCapturingIo();
      const code = await runSwm(["kit", "validate", dir], io);
      expect(code).toBe(0);
      expect(stdoutText()).toContain("swm kit: OK");
    });
  });

  it("fails on a directory without a kit manifest", async () => {
    await withTempDir(async (dir) => {
      const { io, stderrText } = makeCapturingIo();
      const code = await runSwm(["kit", "validate", dir], io);
      expect(code).toBe(1);
      expect(stderrText()).toContain("swm kit: INVALID");
    });
  });

  it("fails with an error for a missing directory", async () => {
    const { io, stderrText } = makeCapturingIo();
    const code = await runSwm(["kit", "validate", "/definitely/not/a/dir"], io);
    expect(code).toBe(1);
    expect(stderrText()).toContain("swm kit: error");
  });

  it("fails for an invalid manifest structure", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "kit.json"), '{"name": "missing everything else"}', "utf8");
      const { io, stderrText } = makeCapturingIo();
      const code = await runSwm(["kit", "validate", dir], io);
      expect(code).toBe(1);
      expect(stderrText()).toContain("swm kit: INVALID");
    });
  });
});

describe("swm splatter", () => {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

  it("prints splatter usage for --help", async () => {
    const { io, stdoutText } = makeCapturingIo();
    expect(await runSwm(["splatter", "--help"], io)).toBe(0);
    expect(stdoutText()).toContain("swm splatter [options] <output.png>");
  });

  it("writes a PNG of the requested size", async () => {
    await withTempDir(async (dir) => {
      const out = join(dir, "decal.png");
      const { io, stdoutText } = makeCapturingIo();
      const code = await runSwm(
        ["splatter", "-a", "metaballs", "--seed", "3", "--size", "64", "--blur", "5", out],
        io,
      );
      expect(code).toBe(0);
      expect(stdoutText()).toContain("metaballs seed 3");
      const bytes = await readFile(out);
      expect(Array.from(bytes.subarray(0, 4))).toEqual(PNG_SIGNATURE);
      // IHDR width/height, big-endian, right after the 8-byte signature + chunk header.
      expect(bytes.readUInt32BE(16)).toBe(64);
      expect(bytes.readUInt32BE(20)).toBe(64);
    });
  });

  it("writes identical bytes for the same seed", async () => {
    await withTempDir(async (dir) => {
      const args = ["splatter", "-a", "mud-splatter", "--seed", "9", "--size", "64"];
      await runSwm([...args, join(dir, "a.png")], makeCapturingIo().io);
      await runSwm([...args, join(dir, "b.png")], makeCapturingIo().io);
      expect((await readFile(join(dir, "a.png"))).equals(await readFile(join(dir, "b.png")))).toBe(
        true,
      );
    });
  });

  it.each([
    [["splatter"], "missing <output.png>"],
    [["splatter", "-a", "ink", "x.png"], "--algorithm must be one of"],
    [["splatter", "--blob-count", "3", "x.png"], "unknown option --blob-count for noise-warp"],
    [["splatter", "--size", "big", "x.png"], 'needs a number, got "big"'],
    [["splatter", "--seed"], "--seed needs a value"],
    [["splatter", "--color", "red", "x.png"], "#rrggbb"],
  ])("rejects %j with exit 1", async (argv, message) => {
    const { io, stderrText } = makeCapturingIo();
    expect(await runSwm(argv, io)).toBe(1);
    expect(stderrText()).toContain(message);
  });
});

function sampleDiffuse(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 23 + y * 7) & 0xff;
      data[i + 1] = (x * 11 + y * 31) & 0xff;
      data[i + 2] = (x * 5 + y * 17) & 0xff;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("swm material", () => {
  it("prints material usage for --help and gen --help", async () => {
    const a = makeCapturingIo();
    expect(await runSwm(["material", "--help"], a.io)).toBe(0);
    expect(a.stdoutText()).toContain("swm material [gen] [options] <diffuse.png> <out-dir>");

    const b = makeCapturingIo();
    expect(await runSwm(["material", "gen", "--help"], b.io)).toBe(0);
    expect(b.stdoutText()).toContain("swm material [gen] [options] <diffuse.png> <out-dir>");
  });

  it("derives all 6 default PBR maps byte-identical to core/material", async () => {
    await withTempDir(async (dir) => {
      const rasterIo = new NodePngRasterIO();
      const src = sampleDiffuse(16, 12);
      const inPath = join(dir, "brick_diffuse.png");
      const outDir = join(dir, "out");
      await writeFile(inPath, await rasterIo.encodePng(src));

      const { io, stdoutText } = makeCapturingIo();
      const code = await runSwm(["material", "gen", "-p", "stone", inPath, outDir], io);
      expect(code).toBe(0);
      expect(stdoutText()).toContain("stone (height,normal,specular,roughness,ao,edge)");

      const expected = derivePbrMaps(src, MATERIAL_STUDIO_PRESETS.stone);
      for (const mapName of ["height", "normal", "specular", "roughness", "ao", "edge"] as const) {
        const decoded = await rasterIo.decode(await readFile(join(outDir, `brick_${mapName}.png`)));
        expect(decoded.width).toBe(16);
        expect(decoded.height).toBe(12);
        expect(Array.from(decoded.data)).toEqual(Array.from(expected[mapName].data));
      }
    });
  });

  it("supports --maps subset, albedo alias, --name stem and slider overrides", async () => {
    await withTempDir(async (dir) => {
      const rasterIo = new NodePngRasterIO();
      const src = sampleDiffuse(8, 8);
      const inPath = join(dir, "tile.png");
      const outDir = join(dir, "custom");
      await writeFile(inPath, await rasterIo.encodePng(src));

      const { io } = makeCapturingIo();
      const code = await runSwm(
        [
          "material",
          "--diffuse",
          inPath,
          "--out",
          outDir,
          "--name",
          "wall",
          "--maps",
          "albedo,normal,edge",
          "--normal-strength",
          "150",
          "--normal-format",
          "directx",
          "--height-invert",
          "--no-edge-invert",
        ],
        io,
      );
      expect(code).toBe(0);

      const expected = derivePbrMaps(src, {
        ...MATERIAL_STUDIO_PRESETS.default,
        normalStrength: 150,
        normalFormat: "directx",
        heightInvert: true,
        edgeInvert: false,
      });
      const normalImg = await rasterIo.decode(await readFile(join(outDir, "wall_normal.png")));
      const edgeImg = await rasterIo.decode(await readFile(join(outDir, "wall_edge.png")));
      const albedoImg = await rasterIo.decode(await readFile(join(outDir, "wall_albedo.png")));
      expect(Array.from(normalImg.data)).toEqual(Array.from(expected.normal.data));
      expect(Array.from(edgeImg.data)).toEqual(Array.from(expected.edge.data));
      expect(Array.from(albedoImg.data)).toEqual(Array.from(src.data));
    });
  });

  it.each([
    [["material"], "missing <diffuse.png>"],
    [["material", "in.png"], "missing <out-dir>"],
    [["material", "-p", "plastic", "in.png", "out"], "--preset must be one of"],
    [["material", "-m", "bogus", "in.png", "out"], 'unknown map "bogus"'],
    [["material", "--normal-format", "vulkan", "in.png", "out"], "--normal-format must be"],
    [["material", "--normal-strength", "abc", "in.png", "out"], 'needs a number, got "abc"'],
    [["material", "--unknown", "1", "in.png", "out"], "unknown option --unknown"],
  ])("rejects %j with exit 1", async (argv, message) => {
    const { io, stderrText } = makeCapturingIo();
    expect(await runSwm(argv, io)).toBe(1);
    expect(stderrText()).toContain(message);
  });
});

describe("swm ibl", () => {
  it("prints ibl usage for --help and bake --help", async () => {
    const a = makeCapturingIo();
    expect(await runSwm(["ibl", "--help"], a.io)).toBe(0);
    expect(a.stdoutText()).toContain("swm ibl [bake] [options] <out-dir>");

    const b = makeCapturingIo();
    expect(await runSwm(["ibl", "bake", "--help"], b.io)).toBe(0);
    expect(b.stdoutText()).toContain("swm ibl [bake] [options] <out-dir>");
  });

  it("writes deterministic input.png and manifest.json in --panorama-only mode", async () => {
    await withTempDir(async (dir) => {
      const outA = join(dir, "a");
      const outB = join(dir, "b");
      const { io, stdoutText } = makeCapturingIo();
      const code = await runSwm(
        ["ibl", "--seed", "7", "--width", "32", "--height", "16", "--panorama-only", outA],
        io,
      );
      expect(code).toBe(0);
      expect(stdoutText()).toContain("32x16 (panorama)");

      await runSwm(
        ["ibl", "bake", "--seed", "7", "--width", "32", "--height", "16", "--panorama-only", outB],
        makeCapturingIo().io,
      );

      const pngA = await readFile(join(outA, "input.png"));
      const pngB = await readFile(join(outB, "input.png"));
      expect(pngA.equals(pngB)).toBe(true);

      const manifest = JSON.parse(await readFile(join(outA, "manifest.json"), "utf8")) as {
        tool: string;
        seed: number;
        options: { width: number; height: number };
        outputs: unknown[];
      };
      expect(manifest.tool).toBe("ibl-bake");
      expect(manifest.seed).toBe(7);
      expect(manifest.options.width).toBe(32);
      expect(manifest.options.height).toBe(16);
      expect(manifest.outputs).toEqual([]);
    });
  });

  it("writes baked outputs and manifest hashes with a custom --input panorama", async () => {
    await withTempDir(async (dir) => {
      const rasterIo = new NodePngRasterIO();
      const panoPath = join(dir, "pano.png");
      const outDir = join(dir, "baked");
      const panoBytes = await rasterIo.encodePng(sampleDiffuse(24, 12));
      await writeFile(panoPath, panoBytes);

      const { io, stdoutText } = makeCapturingIo();
      const code = await runIblCommand(
        ["bake", "--input", panoPath, "--prefilter-mips", "2", "--out", outDir],
        io,
        async (_input, opts) => {
          expect(opts.prefilterMips).toBe(2);
          return new Map<string, Uint8Array>([
            ["env.png", panoBytes],
            ["irradiance.png", panoBytes],
            ["brdf_lut.png", panoBytes],
            ["prefilter/mip0.png", panoBytes],
            ["prefilter/mip1.png", panoBytes],
          ]);
        },
      );
      expect(code).toBe(0);
      expect(stdoutText()).toContain("24x12 (baked 5 maps)");

      const manifest = JSON.parse(await readFile(join(outDir, "manifest.json"), "utf8")) as {
        options: { width: number; height: number; prefilterMips: number };
        outputs: Array<{ name: string; bytes: number; sha256: string }>;
      };
      expect(manifest.options.width).toBe(24);
      expect(manifest.options.height).toBe(12);
      expect(manifest.outputs.map((o) => o.name)).toEqual([
        "env.png",
        "irradiance.png",
        "brdf_lut.png",
        "prefilter/mip0.png",
        "prefilter/mip1.png",
      ]);
      expect((await readFile(join(outDir, "prefilter", "mip1.png"))).equals(panoBytes)).toBe(true);
    });
  });

  it.each([
    [["ibl"], "missing <out-dir>"],
    [["ibl", "--seed", "1.5", "out"], "--seed needs an integer"],
    [["ibl", "--width", "0", "--panorama-only", "out"], "width must be a positive integer"],
    [["ibl", "--bogus", "1", "out"], "unknown option --bogus"],
  ])("rejects %j with exit 1", async (argv, message) => {
    const { io, stderrText } = makeCapturingIo();
    expect(await runSwm(argv, io)).toBe(1);
    expect(stderrText()).toContain(message);
  });
});

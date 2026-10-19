import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSwm } from "../../src/cli/index.js";
import type { CliIo } from "../../src/cli/index.js";

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

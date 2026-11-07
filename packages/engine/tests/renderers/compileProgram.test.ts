import { describe, it, expect, vi } from "vitest";
import { compileProgram, tryCompileProgram } from "../../src/renderers/compileProgram.js";

interface MockOptions {
  failShader?: "vertex" | "fragment";
  failLink?: boolean;
}

function makeGl(options: MockOptions = {}): { gl: WebGL2RenderingContext; deleted: string[] } {
  const deleted: string[] = [];
  let next = 0;
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 10,
    LINK_STATUS: 11,
    createShader: (type: number): object => ({ id: `s${next++}`, type }),
    shaderSource: (): void => {},
    compileShader: (): void => {},
    getShaderParameter: (shader: { type: number }): boolean =>
      !(
        (options.failShader === "vertex" && shader.type === 1) ||
        (options.failShader === "fragment" && shader.type === 2)
      ),
    getShaderInfoLog: (): string => "0:1: syntax error",
    deleteShader: (s: { id: string }): void => void deleted.push(s.id),
    createProgram: (): object => ({ id: "prog" }),
    attachShader: (): void => {},
    bindAttribLocation: vi.fn(),
    linkProgram: (): void => {},
    getProgramParameter: (): boolean => !options.failLink,
    getProgramInfoLog: (): string => "link failed",
    deleteProgram: (p: { id: string }): void => void deleted.push(p.id),
  } as unknown as WebGL2RenderingContext;
  return { gl, deleted };
}

describe("compileProgram", () => {
  it("returns the linked program, binds fixed attribute locations and frees the shaders", () => {
    const { gl, deleted } = makeGl();
    const prog = compileProgram(gl, "vs", "fs", "Test", [[0, "a_position"]]);
    expect(prog).toEqual({ id: "prog" });
    expect(gl.bindAttribLocation).toHaveBeenCalledWith(prog, 0, "a_position");
    expect(deleted).toEqual(["s0", "s1"]);
  });

  it.each([
    ["vertex", /\[Test\] vertex shader compile error: 0:1: syntax error/],
    ["fragment", /\[Test\] fragment shader compile error: 0:1: syntax error/],
  ] as const)(
    "throws with label and info log on a %s compile error and frees what it made",
    (which, message) => {
      const { gl, deleted } = makeGl({ failShader: which });
      expect(() => compileProgram(gl, "vs", "fs", "Test")).toThrow(message);
      expect(deleted).toContain("s0");
    },
  );

  it("throws on a link error and deletes the program and both shaders", () => {
    const { gl, deleted } = makeGl({ failLink: true });
    expect(() => compileProgram(gl, "vs", "fs", "Test")).toThrow(
      /\[Test\] program link error: link failed/,
    );
    expect(deleted).toEqual(expect.arrayContaining(["prog", "s0", "s1"]));
  });
});

describe("tryCompileProgram", () => {
  it("returns null and logs the error instead of throwing", () => {
    const { gl } = makeGl({ failShader: "fragment" });
    const spy = vi.spyOn(console, "error").mockImplementation((): void => {});
    expect(tryCompileProgram(gl, "vs", "fs", "Pass")).toBeNull();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[Pass] fragment shader compile error"),
    );
    spy.mockRestore();
  });

  it("returns the program on success", () => {
    const { gl } = makeGl();
    expect(tryCompileProgram(gl, "vs", "fs", "Pass")).toEqual({ id: "prog" });
  });
});

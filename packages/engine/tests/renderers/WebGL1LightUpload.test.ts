import "../../src/index.js";
import { describe, expect, it } from "vitest";
import { WebGL1Renderer } from "../../src/renderers/WebGL1/WebGL1Renderer.js";
import type { WebGLProgramCacheEntry } from "../../src/renderers/gl/managers/WebGLProgramCache.js";
import type { LightDataInterface } from "../../src/interfaces/index.js";

type Loc = WebGLUniformLocation;
const loc = (name: string): Loc => name as unknown as Loc;

function setup(): {
  bind: (lights: Partial<LightDataInterface>) => void;
  u3f: Record<string, number[]>;
} {
  const u3f: Record<string, number[]> = {};
  const noop = (): void => {};
  const gl = {
    uniform1i: noop,
    uniform1f: noop,
    uniform2f: noop,
    uniform3f: (l: Loc, ...v: number[]) => (u3f[l as unknown as string] = v),
    uniform4f: noop,
  } as unknown as WebGLRenderingContext;
  const renderer = new WebGL1Renderer();
  (renderer as unknown as { gl: WebGLRenderingContext }).gl = gl;

  const u = new Map<string, Loc | undefined>([
    ["u_numPointLights", loc("u_numPointLights")],
    ["u_numSpotLights", loc("u_numSpotLights")],
    ["u_numAreaLights", loc("u_numAreaLights")],
  ]);
  const cache = {
    pointLightLocs: Array.from({ length: 16 }, (_, i) => ({
      pos: loc(`pp${i}`),
      col: loc(`pc${i}`),
      distance: loc(`pd${i}`),
      decay: loc(`pk${i}`),
    })),
    spotLightLocs: Array.from({ length: 16 }, (_, i) => ({
      pos: loc(`sp${i}`),
      dir: loc(`sd${i}`),
      col: loc(`sc${i}`),
      params: loc(`sa${i}`),
    })),
    areaLightLocs: Array.from({ length: 4 }, (_, i) => ({
      pos: loc(`ap${i}`),
      col: loc(`ac${i}`),
      right: loc(`ar${i}`),
      up: loc(`au${i}`),
      normal: loc(`an${i}`),
      size: loc(`as${i}`),
    })),
  } as unknown as WebGLProgramCacheEntry;

  const bind = (lights: Partial<LightDataInterface>): void =>
    (
      renderer as unknown as {
        _bindLights: (
          u: Map<string, Loc | undefined>,
          c: WebGLProgramCacheEntry,
          l: LightDataInterface,
        ) => void;
      }
    )._bindLights(u, cache, {
      pLights: [],
      sLights: [],
      aLights: [],
      ...lights,
    } as LightDataInterface);
  return { bind, u3f };
}

const matrix = (x: number, y: number, z: number): { data: number[] } => ({
  data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
});

describe("WebGL1Renderer light upload", () => {
  it("never sends a zero spot direction to the shader", () => {
    const { bind, u3f } = setup();
    bind({
      sLights: [
        {
          worldMatrix: matrix(0, 0, 0),
          direction: { x: 0, y: 0, z: 0 },
          linearColor: { r: 1, g: 1, b: 1 },
          intensity: 1,
          angle: 1,
          penumbra: 0,
          distance: 1,
          decay: 1,
        },
      ],
    } as unknown as Partial<LightDataInterface>);
    expect(u3f["sd0"]!.every(Number.isFinite)).toBe(true);
  });

  it("fails fast when the uniform arrays would overflow", () => {
    const { bind } = setup();
    const many = (n: number): object[] =>
      Array.from({ length: n }, () => ({ worldMatrix: matrix(0, 0, 0) }));
    expect(() => bind({ sLights: many(17) } as unknown as Partial<LightDataInterface>)).toThrow(
      /Spot light count exceeds limit of 16/,
    );
    expect(() => bind({ aLights: many(5) } as unknown as Partial<LightDataInterface>)).toThrow(
      /Area light count exceeds limit of 4/,
    );
  });
});

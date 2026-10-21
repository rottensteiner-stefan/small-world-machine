import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGL1Renderer } from "../../src/renderers/WebGL1/WebGL1Renderer.js";
import type { WebGLProgramCacheEntry } from "../../src/renderers/gl/managers/WebGLProgramCache.js";
import type { LightDataInterface } from "../../src/interfaces/index.js";

type Loc = WebGLUniformLocation;
const loc = (name: string): Loc => name as unknown as Loc;

interface Calls {
  u1i: Record<string, number>;
  u3f: Record<string, number[]>;
  u4f: Record<string, number[]>;
  u2f: Record<string, number[]>;
  u1f: Record<string, number>;
}

function setup(): {
  bind: (lights: Partial<LightDataInterface>) => void;
  calls: Calls;
} {
  const calls: Calls = { u1i: {}, u3f: {}, u4f: {}, u2f: {}, u1f: {} };
  const gl = {
    uniform1i: (l: Loc, v: number) => (calls.u1i[l as unknown as string] = v),
    uniform1f: (l: Loc, v: number) => (calls.u1f[l as unknown as string] = v),
    uniform2f: (l: Loc, ...v: number[]) => (calls.u2f[l as unknown as string] = v),
    uniform3f: (l: Loc, ...v: number[]) => (calls.u3f[l as unknown as string] = v),
    uniform4f: (l: Loc, ...v: number[]) => (calls.u4f[l as unknown as string] = v),
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
  return { bind, calls };
}

const matrix = (x: number, y: number, z: number): { data: number[] } => ({
  data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
});

describe("WebGL1Renderer light upload", () => {
  it("uploads spot lights (they used to be ignored: u_numSpotLights stayed 0)", () => {
    const { bind, calls } = setup();
    const spot = {
      worldMatrix: matrix(1, 2, 3),
      direction: { x: 0, y: -2, z: 0 },
      color: { r: 1, g: 0.5, b: 0.25 },
      intensity: 2,
      angle: Math.PI / 3,
      penumbra: 0.5,
      distance: 20,
      decay: 2,
    };

    bind({ sLights: [spot] } as unknown as Partial<LightDataInterface>);

    expect(calls.u1i["u_numSpotLights"]).toBe(1);
    expect(calls.u3f["sp0"]).toEqual([1, 2, 3]);
    expect(calls.u3f["sd0"]).toEqual([0, -1, 0]); // normalised
    expect(calls.u3f["sc0"]).toEqual([2, 1, 0.5]); // colour * intensity
    const p = calls.u4f["sa0"]!;
    expect(p[0]).toBeCloseTo(Math.cos(Math.PI / 3), 9);
    expect(p[1]).toBeCloseTo(Math.cos(Math.PI / 6), 9);
    expect(p.slice(2)).toEqual([20, 2]);
  });

  it("uploads area lights with the matrix columns as right/up/normal and half extents", () => {
    const { bind, calls } = setup();
    const area = {
      worldMatrix: {
        data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1],
      },
      color: { r: 1, g: 1, b: 1 },
      intensity: 3,
      width: 4,
      height: 2,
    };

    bind({ aLights: [area] } as unknown as Partial<LightDataInterface>);

    expect(calls.u1i["u_numAreaLights"]).toBe(1);
    expect(calls.u3f["ap0"]).toEqual([4, 5, 6]);
    expect(calls.u3f["ac0"]).toEqual([3, 3, 3]);
    expect(calls.u3f["ar0"]).toEqual([1, 0, 0]);
    expect(calls.u3f["au0"]).toEqual([0, 1, 0]);
    expect(calls.u3f["an0"]).toEqual([0, 0, 1]);
    expect(calls.u2f["as0"]).toEqual([2, 1]);
  });

  it("never sends a zero spot direction to the shader", () => {
    const { bind, calls } = setup();
    bind({
      sLights: [
        {
          worldMatrix: matrix(0, 0, 0),
          direction: { x: 0, y: 0, z: 0 },
          color: { r: 1, g: 1, b: 1 },
          intensity: 1,
          angle: 1,
          penumbra: 0,
          distance: 1,
          decay: 1,
        },
      ],
    } as unknown as Partial<LightDataInterface>);
    expect(calls.u3f["sd0"]!.every(Number.isFinite)).toBe(true);
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
    void vi;
  });
});

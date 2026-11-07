// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { IBLBaker } from "../../src/ibl-gen/ibl-gen.js";

/** Minimal recording WebGL2 stand-in: every method is a spy returning a unique truthy object. */
function makeGl(): {
  gl: WebGL2RenderingContext;
  created: Map<string, unknown[]>;
  deleted: unknown[];
} {
  const created = new Map<string, unknown[]>();
  const deleted: unknown[] = [];
  const gl = new Proxy({} as Record<string, unknown>, {
    get(target, prop: string): unknown {
      if (prop in target) return target[prop];
      if (/^[A-Z0-9_]+$/.test(prop)) return 1;
      const fn = (...args: unknown[]): unknown => {
        if (prop.startsWith("create")) {
          const obj = { kind: prop };
          created.set(prop, [...(created.get(prop) ?? []), obj]);
          return obj;
        }
        if (prop === "deleteTexture") deleted.push(args[0]);
        if (prop === "getShaderParameter" || prop === "getProgramParameter") return true;
        return undefined;
      };
      target[prop] = fn;
      return fn;
    },
  }) as unknown as WebGL2RenderingContext;
  return { gl, created, deleted };
}

describe("IBLBaker.generateBRDF", () => {
  it("deletes the BRDF LUT texture it created", async () => {
    const { gl, created, deleted } = makeGl();
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn((type: string): unknown => {
      if (type === "webgl2") return gl;
      return {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        scale: vi.fn(),
        drawImage: vi.fn(),
      };
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    try {
      const dest = document.createElement("canvas");
      dest.id = "brdfCanvas";
      document.body.appendChild(dest);
      const baker = new IBLBaker({ brdfResolution: 4 } as ConstructorParameters<
        typeof IBLBaker
      >[0]);
      await baker.generateBRDF("brdfCanvas");
      const textures = created.get("createTexture") ?? [];
      expect(textures).toHaveLength(1);
      expect(deleted).toContain(textures[0]);
    } finally {
      HTMLCanvasElement.prototype.getContext = real;
    }
  });
});

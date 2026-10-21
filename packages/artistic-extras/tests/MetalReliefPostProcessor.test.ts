/* eslint-disable @typescript-eslint/explicit-function-return-type -- terse recording mocks of GL/GPU */
import { beforeAll, describe, it, expect } from "vitest";
import { MetalReliefPostProcessor } from "../src/post/MetalReliefPostProcessor.js";

describe("MetalReliefPostProcessor", () => {
  it("initializes with intended default parameters", () => {
    const post = new MetalReliefPostProcessor();

    expect(post.reliefStrength).toBe(1.5);
    expect(post.paletteKnifeStrength).toBe(0.5);
    expect(post.paletteKnifeScale).toBe(24.0);
    expect(post.scratchIntensity).toBe(0.35);
    expect(post.scratchScale).toBe(120.0);
    expect(post.targetHue).toBe(0.0);
    expect(post.hueTolerance).toBe(0.09);
    expect(post.desaturation).toBe(0.95);
    expect(post.rustStrength).toBe(0.8);
    expect(post.edgeGlintStrength).toBe(1.2);
    expect(post.wetRainStreaks).toBe(0.5);
    expect(post.wireMeshStrength).toBe(0.0);
    expect(post.wireMeshScale).toBe(30.0);
  });

  it("accepts custom configurations", () => {
    const post = new MetalReliefPostProcessor({
      reliefStrength: 2.5,
      paletteKnifeStrength: 0.8,
      scratchIntensity: 0.5,
      targetHue: 0.1,
      desaturation: 0.8,
      rustStrength: 0.9,
      edgeGlintStrength: 2.0,
      wetRainStreaks: 0.7,
      wireMeshStrength: 0.4,
    });

    expect(post.reliefStrength).toBe(2.5);
    expect(post.paletteKnifeStrength).toBe(0.8);
    expect(post.scratchIntensity).toBe(0.5);
    expect(post.targetHue).toBe(0.1);
    expect(post.desaturation).toBe(0.8);
    expect(post.rustStrength).toBe(0.9);
    expect(post.edgeGlintStrength).toBe(2.0);
    expect(post.wetRainStreaks).toBe(0.7);
    expect(post.wireMeshStrength).toBe(0.4);
  });

  it("safely handles destroy without prior initialization", () => {
    const post = new MetalReliefPostProcessor();
    expect(() => post.destroy()).not.toThrow();
  });

  describe("WebGL path (recording mock context, WebGL1 branch)", () => {
    interface MockGL {
      gl: WebGLRenderingContext;
      log: string[];
      uniformLookups: () => number;
    }

    function createMockGL(options: { compileOk?: boolean } = {}): MockGL {
      const log: string[] = [];
      let lookups = 0;
      const state: Record<number, unknown> = {
        1: null, // CURRENT_PROGRAM
        2: 0x84c1, // ACTIVE_TEXTURE (TEXTURE1)
        3: "prevTex", // TEXTURE_BINDING_2D
        4: "prevBuf", // ARRAY_BUFFER_BINDING
        5: new Int32Array([1, 2, 30, 40]), // VIEWPORT
        6: false, // UNPACK_FLIP_Y_WEBGL
      };
      const enabled = new Map<number, boolean>([
        [10, true], // DEPTH_TEST
        [11, true], // BLEND
        [12, false], // CULL_FACE
        [13, true], // SCISSOR_TEST
      ]);
      const gl = {
        VERTEX_SHADER: 100,
        FRAGMENT_SHADER: 101,
        COMPILE_STATUS: 102,
        LINK_STATUS: 103,
        CURRENT_PROGRAM: 1,
        ACTIVE_TEXTURE: 2,
        TEXTURE_BINDING_2D: 3,
        ARRAY_BUFFER_BINDING: 4,
        VIEWPORT: 5,
        UNPACK_FLIP_Y_WEBGL: 6,
        DEPTH_TEST: 10,
        BLEND: 11,
        CULL_FACE: 12,
        SCISSOR_TEST: 13,
        TEXTURE0: 0x84c0,
        TEXTURE_2D: 20,
        ARRAY_BUFFER: 21,
        STATIC_DRAW: 22,
        FLOAT: 23,
        TRIANGLES: 24,
        VERTEX_ATTRIB_ARRAY_ENABLED: 25,
        RGBA: 26,
        UNSIGNED_BYTE: 27,
        TEXTURE_WRAP_S: 28,
        TEXTURE_WRAP_T: 29,
        TEXTURE_MIN_FILTER: 30,
        TEXTURE_MAG_FILTER: 31,
        CLAMP_TO_EDGE: 32,
        LINEAR: 33,
        createShader: () => ({}),
        shaderSource: () => undefined,
        compileShader: () => undefined,
        getShaderParameter: () => options.compileOk ?? true,
        getShaderInfoLog: () => "0:1: syntax error",
        deleteShader: () => undefined,
        createProgram: () => ({ p: 1 }),
        attachShader: () => undefined,
        bindAttribLocation: () => undefined,
        linkProgram: () => undefined,
        getProgramParameter: () => true,
        getProgramInfoLog: () => "",
        deleteProgram: () => undefined,
        getUniformLocation: () => {
          lookups++;
          return {};
        },
        createBuffer: () => ({ b: 1 }),
        bindBuffer: (_t: number, b: unknown) => {
          state[4] = b;
        },
        bufferData: () => undefined,
        getParameter: (k: number) => state[k],
        isEnabled: (k: number) => enabled.get(k) ?? false,
        enable: (k: number) => {
          enabled.set(k, true);
        },
        disable: (k: number) => {
          enabled.set(k, false);
        },
        activeTexture: (t: number) => {
          state[2] = t;
        },
        bindTexture: (_t: number, tex: unknown) => {
          state[3] = tex;
        },
        useProgram: (p: unknown) => {
          state[1] = p;
        },
        viewport: (x: number, y: number, w: number, h: number) => {
          state[5] = new Int32Array([x, y, w, h]);
        },
        getVertexAttrib: () => false,
        enableVertexAttribArray: () => undefined,
        disableVertexAttribArray: () => log.push("disableAttrib"),
        vertexAttribPointer: () => undefined,
        uniform1i: () => undefined,
        uniform2f: () => undefined,
        uniform1f: () => undefined,
        drawArrays: () => log.push("draw"),
        createTexture: () => ({ t: 1 }),
        deleteTexture: () => undefined,
        texParameteri: () => undefined,
        pixelStorei: (k: number, v: boolean) => {
          if (k === 6) {
            state[6] = v;
            log.push(`flipY:${v}`);
          }
        },
        texImage2D: () => log.push(`upload(flip=${String(state[6])})`),
        _state: state,
        _enabled: enabled,
      };
      return {
        gl: gl as unknown as WebGLRenderingContext,
        log,
        uniformLookups: () => lookups,
      };
    }

    it("fails fast with the GL info log on a shader compile error", () => {
      const { gl } = createMockGL({ compileOk: false });
      const post = new MetalReliefPostProcessor();
      expect(() => post.renderGL(gl, {} as WebGLTexture, 64, 64)).toThrow(
        /compile error.*syntax error/,
      );
    });

    it("caches uniform locations and restores GL state after drawing", () => {
      const { gl, log, uniformLookups } = createMockGL();
      const post = new MetalReliefPostProcessor();
      post.renderGL(gl, {} as WebGLTexture, 64, 64);
      const afterFirst = uniformLookups();
      expect(afterFirst).toBeGreaterThan(0);
      post.renderGL(gl, {} as WebGLTexture, 64, 64);
      expect(uniformLookups()).toBe(afterFirst); // no per-frame getUniformLocation
      expect(log.filter((l) => l === "draw")).toHaveLength(2);

      const internals = gl as unknown as {
        _state: Record<number, unknown>;
        _enabled: Map<number, boolean>;
      };
      expect(internals._state[1]).toBeNull(); // program
      expect(internals._state[2]).toBe(0x84c1); // active texture unit
      expect(internals._state[3]).toBe("prevTex");
      expect(internals._state[4]).toBe("prevBuf");
      expect(Array.from(internals._state[5] as Int32Array)).toEqual([1, 2, 30, 40]);
      expect(internals._enabled.get(10)).toBe(true); // depth
      expect(internals._enabled.get(11)).toBe(true); // blend
      expect(internals._enabled.get(12)).toBe(false); // cull
      expect(internals._enabled.get(13)).toBe(true); // scissor
      expect(log).toContain("disableAttrib"); // attribute 0 was disabled before, so it is again
    });

    it("uploads canvas sources with UNPACK_FLIP_Y and rejects source === target", () => {
      const { gl, log } = createMockGL();
      const target = { width: 8, height: 8, getContext: () => gl } as unknown as HTMLCanvasElement;
      const source = { width: 8, height: 8 } as unknown as HTMLCanvasElement;
      const post = new MetalReliefPostProcessor();
      post.applyToCanvas(source, target);
      expect(log.indexOf("flipY:true")).toBeLessThan(log.indexOf("upload(flip=true)"));
      expect(log).toContain("flipY:false"); // previous value restored

      expect(() => post.applyToCanvas(source, source)).toThrow(/must differ/);
    });
  });

  describe("WebGPU path (mock device)", () => {
    function createMockDevice(): {
      device: GPUDevice;
      counts: { bindGroups: number; writes: unknown[]; formats: string[] };
    } {
      const counts = { bindGroups: 0, writes: [] as unknown[], formats: [] as string[] };
      const device = {
        createShaderModule: () => ({}),
        createBuffer: () => ({ destroy: () => undefined }),
        createSampler: () => ({}),
        createRenderPipeline: (d: { fragment: { targets: { format: string }[] } }) => {
          counts.formats.push(d.fragment.targets[0]!.format);
          return { getBindGroupLayout: () => ({}) };
        },
        createBindGroup: () => {
          counts.bindGroups++;
          return {};
        },
        queue: {
          writeBuffer: (_b: unknown, _o: number, data: unknown) => counts.writes.push(data),
        },
      };
      return { device: device as unknown as GPUDevice, counts };
    }
    const pass = {
      setPipeline: () => undefined,
      setBindGroup: () => undefined,
      draw: () => undefined,
    } as unknown as GPURenderPassEncoder;

    beforeAll(() => {
      (globalThis as Record<string, unknown>)["GPUBufferUsage"] = { UNIFORM: 1, COPY_DST: 2 };
    });

    it("reuses the uniform scratch array and the bind group per frame", () => {
      const { device, counts } = createMockDevice();
      const post = new MetalReliefPostProcessor();
      const view = {} as GPUTextureView;
      post.renderGPU(device, pass, view, 100, 50);
      post.renderGPU(device, pass, view, 100, 50);
      expect(counts.bindGroups).toBe(1);
      expect(counts.writes[0]).toBe(counts.writes[1]); // same Float32Array instance
      expect((counts.writes[0] as Float32Array)[0]).toBe(100);

      post.renderGPU(device, pass, {} as GPUTextureView, 100, 50); // new input view -> rebuild
      expect(counts.bindGroups).toBe(2);
    });

    it("takes the color target format from the option instead of hardcoding bgra8unorm", () => {
      const { device, counts } = createMockDevice();
      new MetalReliefPostProcessor({ targetFormat: "rgba8unorm" }).renderGPU(
        device,
        pass,
        {} as GPUTextureView,
        4,
        4,
      );
      expect(counts.formats).toEqual(["rgba8unorm"]);
    });
  });
});

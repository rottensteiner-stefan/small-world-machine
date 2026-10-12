import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { MainRenderPass } from "../../src/renderers/passes/MainRenderPass.js";
import { Vector3D } from "../../src/math/index.js";
import { MaterialType, NormalTargetMode } from "../../src/enums/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

function makeMockRenderer(): Internals {
  return {
    activeDepthView: { mock: "depthView" },
    clearColor: { r: 0, g: 0, b: 0, a: 1 },
    postProcessing: { enabled: false, get: vi.fn(() => undefined) },
    _renderBatch: vi.fn(),
  };
}

function makeMockScene(): Internals {
  return {
    getVisibleObjectsSorted: vi.fn(() => ({ opaqueBatches: [], transparent: [], decals: [] })),
  };
}

describe("MainRenderPass", () => {
  it("relies on DepthPrePassGPU's clear -- opens the opaque pass with depthLoadOp: 'load', not 'clear'", () => {
    const renderer = makeMockRenderer();
    const scene = makeMockScene();
    const rp = { end: vi.fn() };
    const ce = { beginRenderPass: vi.fn(() => rp) };
    const targetView = { mock: "targetView" };

    const pass = new MainRenderPass() as Internals;
    pass.execute(renderer, scene, ce, targetView, new Float32Array(16), new Vector3D(0, 0, 0));

    expect(ce.beginRenderPass).toHaveBeenCalledWith(
      expect.objectContaining({
        depthStencilAttachment: expect.objectContaining({
          view: renderer.activeDepthView,
          depthLoadOp: "load",
        }),
      }),
    );
    // Must not re-clear -- that would erase what DepthPrePassGPU already wrote this frame.
    const call = (ce.beginRenderPass as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.depthStencilAttachment.depthLoadOp).not.toBe("clear");
  });

  it("captures activeColorTexture and activeDepth when transparent objects are present", () => {
    const mockColorTex = { mock: "activeColorTex" };
    const renderer = {
      ...makeMockRenderer(),
      activeColorTexture: mockColorTex,
      captureOpaqueTexture: vi.fn(),
      captureOpaqueDepth: vi.fn(),
    };
    const mockMesh = {
      material: {
        uuid: "mat-1",
        getRenderManifest: vi.fn(() => ({
          shaderId: "test-shader",
          state: { topology: 3 },
        })),
      },
      geometry: { topology: 3 },
    };
    const scene = {
      getVisibleObjectsSorted: vi.fn(() => ({
        opaqueBatches: [],
        transparent: [mockMesh],
        decals: [],
      })),
    };
    const rp = { end: vi.fn(), setBindGroup: vi.fn() };
    const ce = { beginRenderPass: vi.fn(() => rp) };
    const targetView = { mock: "targetView" };

    const pass = new MainRenderPass() as Internals;
    pass.execute(renderer, scene, ce, targetView, new Float32Array(16), new Vector3D(0, 0, 0));

    expect(renderer.captureOpaqueTexture).toHaveBeenCalledWith(ce, mockColorTex);
    expect(renderer.captureOpaqueDepth).toHaveBeenCalledWith(ce);
  });

  describe("normal buffer (ADR 0028)", () => {
    function run(normalView: unknown): { ce: Internals; renderer: Internals } {
      const renderer = {
        ...makeMockRenderer(),
        activeNormalView: normalView,
        activeColorTexture: {},
        captureOpaqueTexture: vi.fn(),
        captureOpaqueDepth: vi.fn(),
      };
      const opaque = (shaderId: string): Internals => ({
        shaderId,
        objects: [{}],
      });
      const transparentMesh = {
        material: {
          uuid: "glass",
          getRenderManifest: vi.fn(() => ({ shaderId: "glass", state: { topology: 3 } })),
        },
        geometry: { topology: 3 },
      };
      const scene = {
        getVisibleObjectsSorted: vi.fn(() => ({
          opaqueBatches: [opaque(MaterialType.SKYBOX), opaque("standard")],
          transparent: [transparentMesh],
          decals: [],
        })),
      };
      const rp = { end: vi.fn() };
      const ce = { beginRenderPass: vi.fn(() => rp) };

      new MainRenderPass().execute(
        renderer,
        scene as never,
        ce as never,
        { mock: "targetView" } as never,
        new Float32Array(16),
        new Vector3D(0, 0, 0),
      );
      return { ce, renderer };
    }

    it("adds a cleared second color attachment and writes normals for opaque batches", () => {
      const normalView = { mock: "normalView" };
      const { ce, renderer } = run(normalView);

      const opaquePass = ce.beginRenderPass.mock.calls[0][0];
      expect(opaquePass.colorAttachments).toHaveLength(2);
      expect(opaquePass.colorAttachments[1]).toMatchObject({ view: normalView, loadOp: "clear" });

      const modes = renderer._renderBatch.mock.calls.map((c: unknown[]) => c[3]);
      expect(modes).toEqual([
        NormalTargetMode.MASKED, // skybox
        NormalTargetMode.WRITE, // standard
        NormalTargetMode.MASKED, // transparent
      ]);
    });

    it("keeps the transparent pass attached to the normal buffer without clearing it", () => {
      const normalView = { mock: "normalView" };
      const { ce } = run(normalView);

      const transparentPass = ce.beginRenderPass.mock.calls[1][0];
      expect(transparentPass.colorAttachments[1]).toMatchObject({
        view: normalView,
        loadOp: "load",
      });
    });

    it("stays single-target and never requests a normal mode while the buffer is off", () => {
      const { ce, renderer } = run(undefined);

      expect(ce.beginRenderPass.mock.calls[0][0].colorAttachments).toHaveLength(1);
      const modes = renderer._renderBatch.mock.calls.map((c: unknown[]) => c[3]);
      expect(new Set(modes)).toEqual(new Set([NormalTargetMode.NONE]));
    });
  });

  describe("decal sub-pass", () => {
    function run(options: { canDrawDecals: boolean; normalView?: unknown; transparent?: number }): {
      ce: Internals;
      renderer: Internals;
    } {
      const renderer = {
        ...makeMockRenderer(),
        canDrawDecals: options.canDrawDecals,
        activeNormalView: options.normalView,
        activeColorTexture: {},
        captureOpaqueTexture: vi.fn(),
        captureOpaqueDepth: vi.fn(),
        captureOpaqueNormal: vi.fn(),
      };
      const decal = {
        material: {
          uuid: "decal-mat",
          getRenderManifest: vi.fn(() => ({ shaderId: "DecalMaterial" })),
        },
      };
      const transparentMesh = {
        material: {
          uuid: "glass",
          getRenderManifest: vi.fn(() => ({ shaderId: "glass", state: { topology: 3 } })),
        },
        geometry: { topology: 3 },
      };
      const scene = {
        getVisibleObjectsSorted: vi.fn(() => ({
          opaqueBatches: [],
          transparent: options.transparent ? [transparentMesh] : [],
          decals: [decal],
        })),
      };
      const rp = { end: vi.fn() };
      const ce = { beginRenderPass: vi.fn(() => rp) };

      new MainRenderPass().execute(
        renderer,
        scene as never,
        ce as never,
        { mock: "targetView" } as never,
        new Float32Array(16),
        new Vector3D(0, 0, 0),
      );
      return { ce, renderer };
    }

    it("draws decals in their own pass after capturing depth and the normal copy, blending normals", () => {
      const normalView = { mock: "normalView" };
      const { ce, renderer } = run({ canDrawDecals: true, normalView });

      expect(renderer.captureOpaqueDepth).toHaveBeenCalledTimes(1);
      expect(renderer.captureOpaqueNormal).toHaveBeenCalledTimes(1);
      const decalPass = ce.beginRenderPass.mock.calls[1][0];
      expect(decalPass.colorAttachments).toHaveLength(2);
      expect(decalPass.colorAttachments[1]).toMatchObject({ view: normalView, loadOp: "load" });
      expect(renderer._renderBatch.mock.calls[0][3]).toBe(NormalTargetMode.BLEND);
    });

    it("captures the opaque depth only once when transparents follow the decals", () => {
      const { renderer } = run({ canDrawDecals: true, normalView: undefined, transparent: 1 });

      expect(renderer.captureOpaqueDepth).toHaveBeenCalledTimes(1);
    });

    it("skips decals on targets that cannot draw them (offscreen render targets)", () => {
      const { ce, renderer } = run({ canDrawDecals: false });

      expect(renderer.captureOpaqueDepth).not.toHaveBeenCalled();
      expect(renderer._renderBatch).not.toHaveBeenCalled();
      expect(ce.beginRenderPass).toHaveBeenCalledTimes(1);
    });
  });
});

import "../../src/index.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { describe, expect, it, vi } from "vitest";
import { DepthPrePassGPU } from "../../src/renderers/passes/DepthPrePassGPU.js";
import { InstancedMesh } from "../../src/core/InstancedMesh.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Vector3D } from "../../src/math/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

function makeMockRenderer(): Internals {
  return {
    activeDepthView: { mock: "depthView" },
    context: { shaderRegistry: new ShaderRegistry() },
    globalBindGroup: { mock: "globalBindGroup" },
    _renderSubgroup: vi.fn(),
  };
}

function makeMockScene(opaqueBatches: Internals[]): Internals {
  return {
    getVisibleObjectsSorted: vi.fn(() => ({ opaqueBatches })),
  };
}

function makeCe(): { ce: Internals; rp: Internals } {
  const rp = { setBindGroup: vi.fn(), setPipeline: vi.fn(), end: vi.fn() };
  const ce = { beginRenderPass: vi.fn(() => rp) };
  return { ce, rp };
}

/** Builds an object whose material reports the given render-manifest `state` (mirrors what
 * e.g. SkyboxMaterial (depthWrite:false) or WireframeMaterial/SpriteMaterial/CustomShaderMaterial
 * (skipDepthPrePass:true) put into their manifests). */
function makeObjWithState(state: Internals): Object3D {
  const obj = new Object3D("obj");
  obj.material = {
    getRenderManifest: () => ({ state, properties: {} }),
  } as Internals;
  return obj;
}

describe("DepthPrePassGPU", () => {
  it("clears the depth buffer and the throwaway color target every frame, even with nothing to draw", () => {
    const renderer = makeMockRenderer();
    const scene = makeMockScene([]);
    const { ce, rp } = makeCe();
    const targetView = { mock: "targetView" };

    const pass = new DepthPrePassGPU() as Internals;
    pass.execute(renderer, scene, ce, targetView, new Float32Array(16), new Vector3D(0, 0, 0));

    expect(ce.beginRenderPass).toHaveBeenCalledWith(
      expect.objectContaining({
        colorAttachments: [
          expect.objectContaining({ view: targetView, loadOp: "clear", storeOp: "discard" }),
        ],
        depthStencilAttachment: expect.objectContaining({
          view: renderer.activeDepthView,
          depthLoadOp: "clear",
          depthClearValue: 1.0,
        }),
      }),
    );
    expect(rp.setBindGroup).toHaveBeenCalledWith(0, renderer.globalBindGroup);
    expect(rp.end).toHaveBeenCalledTimes(1);
    expect(renderer._renderSubgroup).not.toHaveBeenCalled();
  });

  it("skips objects whose material is excluded from the pre-pass via state.skipDepthPrePass", () => {
    const renderer = makeMockRenderer();
    for (const state of [
      { skipDepthPrePass: true }, // e.g. CustomShaderMaterial / WireframeMaterial
      { skipDepthPrePass: true, transparent: false, depthWrite: true }, // e.g. opaque SpriteMaterial
    ]) {
      const scene = makeMockScene([
        { shaderId: "material", objects: [makeObjWithState(state)], topology: undefined },
      ]);
      const { ce } = makeCe();

      const pass = new DepthPrePassGPU() as Internals;
      pass.execute(renderer, scene, ce, {}, new Float32Array(16), new Vector3D(0, 0, 0));

      expect(renderer._renderSubgroup).not.toHaveBeenCalled();
    }
  });

  it("skips objects that write no depth (e.g. the skybox, whose manifest has depthWrite:false)", () => {
    const renderer = makeMockRenderer();
    const scene = makeMockScene([
      {
        shaderId: "material",
        objects: [makeObjWithState({ depthWrite: false })],
        topology: undefined,
      },
    ]);
    const { ce } = makeCe();

    const pass = new DepthPrePassGPU() as Internals;
    pass.execute(renderer, scene, ce, {}, new Float32Array(16), new Vector3D(0, 0, 0));

    expect(renderer._renderSubgroup).not.toHaveBeenCalled();
  });

  it("splits standard vs. instanced objects and passes viewOffset 0 (main camera slot)", () => {
    const renderer = makeMockRenderer();
    const standard = makeObjWithState({});
    // _renderSubgroup is mocked below, so geometry/material are never actually read here --
    // only `instanceof InstancedMesh` matters for the standard/instanced split this pass does.
    const instanced = new InstancedMesh(
      "instanced",
      undefined as unknown as Internals,
      undefined as unknown as Internals,
      1,
    );
    instanced.material = { getRenderManifest: () => ({ state: {}, properties: {} }) } as Internals;
    const scene = makeMockScene([
      { shaderId: "test-shader", objects: [standard, instanced], topology: undefined },
    ]);
    const { ce } = makeCe();

    const pass = new DepthPrePassGPU() as Internals;
    pass.execute(renderer, scene, ce, {}, new Float32Array(16), new Vector3D(0, 0, 0));

    expect(renderer._renderSubgroup).toHaveBeenCalledTimes(2);
    const calls = (renderer._renderSubgroup as ReturnType<typeof vi.fn>).mock.calls;

    const standardCall = calls.find((c: Internals) => c[2] === false)!;
    expect(standardCall[1]).toEqual([standard]);
    expect(standardCall[5]).toBe(0); // VIEW_SLOT_MAIN_CAMERA

    const instancedCall = calls.find((c: Internals) => c[2] === true)!;
    expect(instancedCall[1]).toEqual([instanced]);
    expect(instancedCall[5]).toBe(0);
  });
});

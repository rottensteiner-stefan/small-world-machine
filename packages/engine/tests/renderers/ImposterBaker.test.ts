import { describe, expect, it } from "vitest";
import type { RenderTarget, SpriteMaterial, Vector3D } from "../../src/index.js";
import {
  bakeImposter,
  Camera,
  Color,
  Cube,
  computeImposterVerticalFrame,
  ImposterSprite,
  Object3D,
  PerspectiveProjection,
  RendererType,
  StandardMaterial,
} from "../../src/index.js";
import type { Renderer } from "../../src/interfaces/index.js";

class MockRenderer {
  public renderTargetParams: unknown[] = [];
  public renderCalls = 0;
  public capturedVp: Float32Array | undefined;
  public clearColor = new Color(0.55, 0.72, 0.85, 1);
  public clearColorCalls: Color[] = [];
  public readonly type: RendererType;

  constructor(type: RendererType = RendererType.WEB_GPU) {
    this.type = type;
  }

  public setRenderTarget(target: unknown): void {
    this.renderTargetParams.push(target);
  }

  public render(_scene?: unknown, vpMatrix?: Float32Array): void {
    this.renderCalls++;
    if (vpMatrix) this.capturedVp = vpMatrix.slice(0);
  }

  public setClearColor(color: Color): void {
    this.clearColor = color.clone();
    this.clearColorCalls.push(color.clone());
  }
}

function makeCube(): Object3D {
  const obj = new Object3D("BakeTarget");
  obj.geometry = new Cube({ size: 1 }).getGeometryData();
  obj.material = new StandardMaterial({ color: new Color(1, 1, 1) });
  return obj;
}

describe("bakeImposter", () => {
  it("renders and restores the render target once per angle, returning one texture each", () => {
    const renderer = new MockRenderer();
    const textures = bakeImposter(renderer as unknown as Renderer, makeCube(), { angleCount: 6 });

    expect(textures).toHaveLength(6);
    expect(renderer.renderCalls).toBe(6);
    // Every render target set must be paired with a null reset right after.
    expect(renderer.renderTargetParams).toHaveLength(12);
    for (let i = 0; i < 6; i++) {
      expect(renderer.renderTargetParams[i * 2]).toBe(textures[i]);
      expect(renderer.renderTargetParams[i * 2 + 1]).toBeNull();
    }
  });

  it("defaults to 8 angles", () => {
    const renderer = new MockRenderer();
    const textures = bakeImposter(renderer as unknown as Renderer, makeCube());
    expect(textures).toHaveLength(8);
  });

  it("bakes textures sized to the requested resolution", () => {
    const renderer = new MockRenderer();
    const textures = bakeImposter(renderer as unknown as Renderer, makeCube(), {
      angleCount: 2,
      resolution: 64,
    });
    for (const tex of textures) {
      expect((tex as RenderTarget).width).toBe(64);
      expect((tex as RenderTarget).height).toBe(64);
    }
  });

  it("bakes against a transparent background by default and restores the caller's clear color", () => {
    const renderer = new MockRenderer();
    bakeImposter(renderer as unknown as Renderer, makeCube(), { angleCount: 4 });

    // The bake must clear each angle to fully transparent black, never the scene's own clear
    // color -- otherwise the billboard carries an opaque baked background into the scene.
    expect(renderer.clearColorCalls.length).toBe(2);
    expect(renderer.clearColorCalls[0]).toMatchObject({ r: 0, g: 0, b: 0, a: 0 });
    expect(renderer.clearColorCalls[1]).toMatchObject({ r: 0.55, g: 0.72, b: 0.85, a: 1 });
    expect(renderer.clearColor).toMatchObject({ r: 0.55, g: 0.72, b: 0.85, a: 1 });
  });

  it("respects an explicit bake clear color and still restores the caller's", () => {
    const renderer = new MockRenderer();
    bakeImposter(renderer as unknown as Renderer, makeCube(), {
      angleCount: 2,
      clearColor: new Color(0.2, 0.4, 0.6, 0.5),
    });

    expect(renderer.clearColorCalls[0]).toMatchObject({ r: 0.2, g: 0.4, b: 0.6, a: 0.5 });
    expect(renderer.clearColorCalls[1]).toMatchObject({ r: 0.55, g: 0.72, b: 0.85, a: 1 });
  });

  it("restores the clear color even if rendering throws mid-bake", () => {
    const renderer = new MockRenderer();
    renderer.render = (): never => {
      throw new Error("bake render failed");
    };
    expect(() =>
      bakeImposter(renderer as unknown as Renderer, makeCube(), { angleCount: 2 }),
    ).toThrow("bake render failed");
    expect(renderer.clearColorCalls.at(-1)).toMatchObject({ r: 0.55, g: 0.72, b: 0.85, a: 1 });
    expect(renderer.clearColor).toMatchObject({ r: 0.55, g: 0.72, b: 0.85, a: 1 });
  });

  it("pre-flips the bake vertically on WebGPU only, so imposters face upright on both GL and GPU", () => {
    // The view-projection matrix's Y scale is the ortho `2/(top-bottom)` factor (column-major
    // index 5): negative for the WebGPU-only vertical pre-flip, positive for the WebGL legs.
    const gpu = new MockRenderer(RendererType.WEB_GPU);
    bakeImposter(gpu as unknown as Renderer, makeCube(), { angleCount: 1 });
    expect(gpu.capturedVp).toBeDefined();
    expect(gpu.capturedVp![5]).toBeLessThan(0);

    for (const glType of [RendererType.WEB_GL1, RendererType.WEB_GL2]) {
      const gl = new MockRenderer(glType);
      bakeImposter(gl as unknown as Renderer, makeCube(), { angleCount: 1 });
      expect(gl.capturedVp).toBeDefined();
      expect(gl.capturedVp![5]).toBeGreaterThan(0);
    }
  });

  it("defaults to symmetric (centered) vertical framing around the object's bounding sphere", () => {
    const cube = makeCube();
    const frame = computeImposterVerticalFrame(cube, false);
    // Unit cube: bounding radius sqrt(3)/2, so the default frame is +/-(1.1 * radius) around the
    // sphere center -- identical to the historical, always-centered framing.
    const half = 1.1 * frame.radius;
    expect(frame.lower).toBeCloseTo(-half, 10);
    expect(frame.upper).toBeCloseTo(half, 10);
  });

  it("anchors the ground line at the frame bottom when groundAtBottom is set", () => {
    const cube = makeCube();
    const frame = computeImposterVerticalFrame(cube, true);
    // Exact anchoring contract: the lower frame edge is the object's genuine ground line (minY)
    // minus the small anti-clip margin, and the vertical span stays identical to the centered
    // frame so the billboard keeps its full height.
    expect(frame.upper - frame.lower).toBeCloseTo(2.2 * frame.radius, 10);
    expect(frame.lower).toBeCloseTo(frame.minY - 0.08 * frame.radius - frame.center.y, 10);
  });

  it("grounds a tall, wide-canopled object that centered framing would leave hovering", () => {
    // A trunk standing at ground level plus a wide canopy far above it: the bounding sphere's
    // center is dragged upward by the tall shape, so symmetric framing leaves the base's baked
    // texture gap high above the image bottom (it reads as a hovering billboard). Grounded
    // framing must pin the base to the bottom edge instead.
    const obj = new Object3D("TallWide");
    const trunk = new Object3D("Trunk");
    trunk.geometry = makeCube().geometry;
    trunk.position.y = 1.5;
    const canopy = new Object3D("Canopy");
    canopy.geometry = new Cube({ size: 2 }).getGeometryData();
    canopy.material = new StandardMaterial();
    canopy.position.y = 3.8;
    obj.add(trunk);
    obj.add(canopy);

    const centered = computeImposterVerticalFrame(obj, false);
    const grounded = computeImposterVerticalFrame(obj, true);

    // Grounding must never rescale the baked object.
    expect(grounded.upper - grounded.lower).toBeCloseTo(centered.upper - centered.lower, 10);

    // For a ground-standing object the base must sit at the very bottom of the frame (only the
    // anti-clip margin remains), strictly lower than centered framing would place it.
    const baseFraction = (f: {
      center: Vector3D;
      minY: number;
      lower: number;
      upper: number;
    }): number => (f.minY - (f.center.y + f.lower)) / (f.upper - f.lower);

    expect(baseFraction(grounded)).toBeCloseTo(0.08 / 2.2, 10);
    expect(baseFraction(grounded)).toBeLessThan(baseFraction(centered));
  });
});

describe("ImposterSprite", () => {
  it("throws when constructed with no baked textures", () => {
    expect(() => new ImposterSprite("Test", [])).toThrow();
  });

  it("selects the texture baked closest to the current view angle", () => {
    const renderer = new MockRenderer();
    const textures = bakeImposter(renderer as unknown as Renderer, makeCube(), { angleCount: 4 });
    const sprite = new ImposterSprite("Test", textures);
    sprite.position.set(0, 0, 0);

    // Camera due +X of the sprite -- nearest baked angle should be index 1 (of 4, step = PI/2).
    const camera = new Camera(new PerspectiveProjection());
    camera.position.set(5, 0, 0);
    sprite.update(camera);

    expect((sprite.material as SpriteMaterial).texture).toBe(textures[1]);
  });

  it("wraps around to angle 0 when the view angle is behind the sprite", () => {
    const renderer = new MockRenderer();
    const textures = bakeImposter(renderer as unknown as Renderer, makeCube(), { angleCount: 4 });
    const sprite = new ImposterSprite("Test", textures);
    sprite.position.set(0, 0, 0);

    const camera = new Camera(new PerspectiveProjection());
    camera.position.set(0, 0, 5);
    sprite.update(camera);

    expect((sprite.material as SpriteMaterial).texture).toBe(textures[0]);
  });
});

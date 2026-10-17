import { describe, expect, it } from "vitest";
import type { RenderTarget, SpriteMaterial } from "../../src/index.js";
import {
  bakeImposter,
  Camera,
  Color,
  Cube,
  ImposterSprite,
  Object3D,
  PerspectiveProjection,
  StandardMaterial,
} from "../../src/index.js";
import type { Renderer } from "../../src/interfaces/index.js";

class MockRenderer {
  public renderTargetParams: unknown[] = [];
  public renderCalls = 0;

  public setRenderTarget(target: unknown): void {
    this.renderTargetParams.push(target);
  }

  public render(): void {
    this.renderCalls++;
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

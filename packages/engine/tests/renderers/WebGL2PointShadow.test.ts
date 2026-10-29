import "../../src/index.js";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import { WebGL2PointShadows } from "../../src/renderers/WebGL2/WebGL2PointShadows.js";
import { WebGL2SpotShadowArray } from "../../src/renderers/WebGL2/WebGL2SpotShadowArray.js";
import { PointLight } from "../../src/core/lights/PointLight.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Cube } from "../../src/geometry/Cube.js";
import { BasicMaterial } from "../../src/core/materials/surface/BasicMaterial.js";
import {
  SHADOW_ARRAY_LAYERS,
  SPOT_SHADOW_LAYERS,
  cubeFaceForDirection,
  pointShadowLayer,
} from "../../src/core/lights/PointLightShadow.js";
import { Matrix4, Vector3D } from "../../src/math/index.js";
import type { LightDataInterface } from "../../src/interfaces/index.js";
import type { RenderBatch } from "../../src/core/Scene.js";

const GL2 = new URL("../../src/renderers/shaders/source/web_gl2/chunks/", import.meta.url);
const read = (file: string, base: URL = GL2): string => readFileSync(new URL(file, base), "utf8");

/** Camera at the origin looking down -Z (60 degree fov, near 0.1, far 100). */
function cameraViewProj(): Matrix4 {
  const proj = new Matrix4();
  const view = new Matrix4();
  const vp = new Matrix4();
  Matrix4.perspective(Math.PI / 3, 1, 0.1, 100, proj);
  Matrix4.lookAt(new Vector3D(0, 0, 0), new Vector3D(0, 0, -1), new Vector3D(0, 1, 0), view);
  Matrix4.multiply(proj, view, vp);
  return vp;
}

function light(x: number, y: number, z: number, castShadow: boolean = true): PointLight {
  const l = new PointLight({ distance: 5, castShadow });
  l.position.set(x, y, z);
  l.updateMatrixWorld(true);
  return l;
}

const material = new BasicMaterial();
const geometry = new Cube().getGeometryData();

function caster(x: number, y: number, z: number): Object3D {
  const o = new Object3D("caster");
  o.geometry = geometry;
  o.material = material;
  o.castShadow = true;
  o.position.set(x, y, z);
  o.updateMatrixWorld(true);
  o.computeBounds();
  return o;
}

function sceneRoot(...children: Object3D[]): Object3D {
  const root = new Object3D("root");
  for (const c of children) root.add(c);
  return root;
}

describe("WebGL2 point shadows: GLSL guards (ADR 0052)", () => {
  const header = read("base_fragment_header.frag.glsl");

  it("every GL2 point-light loop applies pointShadowFactor", () => {
    const call = "pointShadowFactor(i, u_pointLights[i].pos, v_worldPos, v_normal)";
    expect(read("light_calc.frag.glsl")).toContain(`attenuation *= ${call}`);
    expect(read("light_calc_pbr.frag.glsl")).toContain(`attenuation * ${call}`);
    expect(read("lights.frag.glsl")).toContain(`#define GLASS_POINT_SHADOW(i) ${call}`);
    const glass = read("../../shared/glass_pbr_loops.frag.glsl");
    expect(glass).toContain("GLASS_POINT_COLOR(i) * attenuation * GLASS_POINT_SHADOW(i)");
    // glsl100 has no shadow maps: the shared loop falls back to fully lit.
    expect(glass).toMatch(
      /#ifndef GLASS_POINT_SHADOW\s+[^\n]*\n#define GLASS_POINT_SHADOW\(i\) 1\.0/,
    );
  });

  it("samples layer 4 + slot * 6 + face with face matrix slot * 6 + face, exactly 1.0 without a slot", () => {
    expect(header).toContain("uniform mat4 u_pointShadowMatrix[12];");
    expect(header).toContain("uniform vec4 u_pointShadowInfo[2];");
    expect(header).toContain("u_pointShadowMatrix[s * 6 + face]");
    expect(header).toContain("float layer = float(4 + s * 6 + face);");
    expect(header).toContain("if (info.w < 0.5 || int(info.z + 0.5) != lightIndex) continue;");
    expect(header).toMatch(/return shadow \/ 9\.0;\s*}\s*return 1\.0;\s*}/);
  });

  it("pointShadowFace matches cubeFaceForDirection, ties X > Y > Z", () => {
    const body = /int pointShadowFace\(vec3 d\) \{([\s\S]*?)\n\}/.exec(header)![1]!;
    // The remaining GLSL lines are valid JavaScript once `vec3 a = abs(d);` is translated.
    const js = body.replace(
      "vec3 a = abs(d);",
      "const a = { x: Math.abs(d.x), y: Math.abs(d.y), z: Math.abs(d.z) };",
    );
    const glslFace = new Function("d", js) as (d: { x: number; y: number; z: number }) => number;
    const values = [-2, -1, -0.5, -0, 0, 0.5, 1, 2];
    for (const x of values) {
      for (const y of values) {
        for (const z of values) {
          expect(glslFace({ x, y, z })).toBe(cubeFaceForDirection(x, y, z));
        }
      }
    }
  });
});

describe("WebGL2SpotShadowArray layers", () => {
  function glMock(): { gl: WebGL2RenderingContext; texImage3D: ReturnType<typeof vi.fn> } {
    const texImage3D = vi.fn();
    const gl = {
      createTexture: vi.fn(() => ({})),
      createFramebuffer: vi.fn(() => ({})),
      bindTexture: vi.fn(),
      bindFramebuffer: vi.fn(),
      texParameteri: vi.fn(),
      drawBuffers: vi.fn(),
      readBuffer: vi.fn(),
      texImage3D,
    } as unknown as WebGL2RenderingContext;
    return { gl, texImage3D };
  }

  it("has capacity for 4 spot layers + 12 point faces, allocated only when asked", () => {
    expect(WebGL2SpotShadowArray.LAYERS).toBe(SHADOW_ARRAY_LAYERS);
    expect(WebGL2SpotShadowArray.LAYERS).toBe(16);
    const { gl, texImage3D } = glMock();
    const arr = new WebGL2SpotShadowArray(gl, 256);
    expect(texImage3D.mock.calls[0]![5]).toBe(SPOT_SHADOW_LAYERS);
    arr.resize(256, WebGL2SpotShadowArray.LAYERS);
    expect(texImage3D.mock.calls[1]![3]).toBe(256);
    expect(texImage3D.mock.calls[1]![5]).toBe(16);
    expect(arr.layers).toBe(16);
    arr.resize(256, 16);
    expect(texImage3D).toHaveBeenCalledTimes(2);
  });
});

describe("WebGL2PointShadows.prepare", () => {
  const vp = cameraViewProj();
  const cam = new Vector3D(0, 0, 0);

  it("assigns slots nearest first and writes [bias, normalBias, index, 1]", () => {
    const far = light(0, 0, -20);
    const near = light(0, 0, -6);
    near.shadowBias = 0.01;
    near.shadowNormalBias = 0.02;
    const ps = new WebGL2PointShadows();
    const root = sceneRoot(caster(0, 0, -21), caster(0, 0, -7));

    expect(ps.prepare([far, light(1, 0, -3, false), near], vp, cam, 2, root, [])).toBe(2);
    expect(ps.lights).toEqual([near, far]);
    expect(Array.from(ps.info.slice(0, 4))).toEqual([Math.fround(0.01), Math.fround(0.02), 2, 1]);
    expect(ps.info[6]).toBe(0);
    expect(ps.info[7]).toBe(1);
  });

  it("respects the quality limit and leaves unused lanes zeroed", () => {
    const ps = new WebGL2PointShadows();
    const root = sceneRoot(caster(0, 0, -7), caster(0, 0, -21));
    expect(ps.prepare([light(0, 0, -6), light(0, 0, -20)], vp, cam, 1, root, [])).toBe(1);
    expect(ps.info[7]).toBe(0);
    expect(ps.prepare([light(0, 0, -6)], vp, cam, 0, root, [])).toBe(0);
    expect(Array.from(ps.info)).toEqual(new Array(8).fill(0));
  });

  it("drops a light without casters in range and compacts the next one into slot 0", () => {
    const lonely = light(0, 0, -6);
    const busy = light(0, 0, -30);
    const ps = new WebGL2PointShadows();
    const root = sceneRoot(caster(0, 0, -31), caster(40, 0, -6));

    expect(ps.prepare([lonely, busy], vp, cam, 2, root, [])).toBe(1);
    expect(ps.lights).toEqual([busy]);
    expect(ps.info[2]).toBe(1);
  });

  it("finds an off-screen caster through the scene walk, not the camera-visible batches", () => {
    const l = light(0, 0, -4);
    const behindCamera = caster(0, 0, 0.5);
    const ps = new WebGL2PointShadows();
    expect(ps.prepare([l], vp, cam, 2, sceneRoot(behindCamera), [])).toBe(1);
    const batches = ps.faceCasters(0, 4); // +Z face, towards the camera
    expect(batches).toHaveLength(1);
    expect(batches[0]!.objects).toEqual([behindCamera]);
  });

  it("culls casters per face", () => {
    const l = light(0, 0, -6);
    const below = caster(0, -2.5, -6);
    const ps = new WebGL2PointShadows();
    ps.prepare([l], vp, cam, 2, sceneRoot(below), []);
    expect(ps.faceCasters(0, 3)[0]!.objects).toEqual([below]); // -Y
    expect(ps.faceCasters(0, 2)).toHaveLength(0); // +Y
  });

  it("skips faces whose region cannot reach the view", () => {
    // Light 6 m right of a camera looking down -Z (60 degree fov): its +X region (x >= 6,
    // z in [-8, 2]) lies right of the frustum, which only reaches x = 4.6 at z = -8.
    const l = light(6, 0, -3);
    const ps = new WebGL2PointShadows();
    ps.prepare([l], vp, cam, 2, sceneRoot(caster(5, 0, -3)), []);
    expect(ps.isFaceVisible(0, 0)).toBe(false); // +X
    expect(ps.isFaceVisible(0, 1)).toBe(true); // -X
    expect(ps.isFaceVisible(0, 5)).toBe(true); // -Z
  });

  it("drops a light whose whole range is outside the view", () => {
    const ps = new WebGL2PointShadows();
    const l = light(0, 0, 20); // 20 m behind the camera, range 5
    expect(ps.prepare([l], vp, cam, 2, sceneRoot(caster(0, 0, 19)), [])).toBe(0);
  });
});

type Fn = ReturnType<typeof vi.fn>;

interface RendererInternals {
  gl: Record<string, Fn | number>;
  _spotShadowArray: { resize: Fn; bindLayer: Fn; unbind: Fn; size: number };
  _globalUBO: { setMatrix: Fn; updateRange: Fn };
  _renderShadowScene: Fn;
  updateGlobalUBO: Fn;
  _frameViewProj: Matrix4;
  _frameCamPos: Vector3D;
  _frameScene: { root: Object3D } | undefined;
  _quality: { maxShadowedPointLights?: number };
  renderShadowMaps(lights: LightDataInterface, groups: RenderBatch[]): void;
}

function renderer(): RendererInternals {
  const r = new WebGL2Renderer() as unknown as RendererInternals;
  r.gl = {
    enable: vi.fn(),
    disable: vi.fn(),
    cullFace: vi.fn(),
    CULL_FACE: 1,
    FRONT: 2,
    BACK: 3,
    DEPTH_TEST: 4,
    BLEND: 5,
  };
  r._spotShadowArray = { resize: vi.fn(), bindLayer: vi.fn(), unbind: vi.fn(), size: 256 };
  r._globalUBO = { setMatrix: vi.fn(), updateRange: vi.fn() };
  r._renderShadowScene = vi.fn();
  r.updateGlobalUBO = vi.fn();
  r._frameViewProj = cameraViewProj();
  r._frameCamPos = new Vector3D(0, 0, 0);
  return r;
}

function lightData(pLights: PointLight[]): LightDataInterface {
  return { pLights, sLights: [], aLights: [] } as unknown as LightDataInterface;
}

describe("WebGL2Renderer.renderShadowMaps: point-light faces", () => {
  it("renders no extra pass without casters in range", () => {
    const r = renderer();
    r._frameScene = { root: sceneRoot(caster(30, 0, -6)) };
    r.renderShadowMaps(lightData([light(0, 0, -6)]), []);
    expect(r._spotShadowArray.bindLayer).not.toHaveBeenCalled();
    expect(r._renderShadowScene).not.toHaveBeenCalled();
    expect(r._spotShadowArray.resize).not.toHaveBeenCalled();
  });

  it("renders into layers 4 + 6 * slot + face, uploading the full UBO once per light", () => {
    const r = renderer();
    const l = light(0, 0, -6);
    l.shadowResolution = 256;
    r._frameScene = { root: sceneRoot(caster(0, -2.5, -6)) };
    r.renderShadowMaps(lightData([l]), []);

    expect(r._spotShadowArray.resize).toHaveBeenCalledWith(256, SHADOW_ARRAY_LAYERS);
    const layers = r._spotShadowArray.bindLayer.mock.calls.map((c) => c[0] as number);
    // A light in the middle of the view: every face region reaches it.
    expect(layers).toEqual([0, 1, 2, 3, 4, 5].map((f) => pointShadowLayer(0, f)));
    // Only the -Y face holds the caster; the others are just cleared.
    expect(r._renderShadowScene).toHaveBeenCalledTimes(1);
    expect(r.updateGlobalUBO).toHaveBeenCalledTimes(1);
    expect(r._globalUBO.updateRange).not.toHaveBeenCalled();
  });

  it("re-uploads only u_vp for further faces of the same light", () => {
    const r = renderer();
    r._frameScene = { root: sceneRoot(caster(0, -2.5, -6), caster(0, 2.5, -6)) };
    r.renderShadowMaps(lightData([light(0, 0, -6)]), []);
    expect(r._renderShadowScene).toHaveBeenCalledTimes(2);
    expect(r.updateGlobalUBO).toHaveBeenCalledTimes(1);
    expect(r._globalUBO.updateRange).toHaveBeenCalledWith(0, 64);
  });

  it("honours quality.maxShadowedPointLights = 0", () => {
    const r = renderer();
    r._quality = { ...r._quality, maxShadowedPointLights: 0 };
    r._frameScene = { root: sceneRoot(caster(0, -2.5, -6)) };
    r.renderShadowMaps(lightData([light(0, 0, -6)]), []);
    expect(r._spotShadowArray.bindLayer).not.toHaveBeenCalled();
  });
});

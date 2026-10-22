import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebGL2Renderer } from "../../src/renderers/WebGL2/WebGL2Renderer.js";
import type { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";
import { GlobalUniformWriter } from "../../src/renderers/WebGPU/managers/GlobalUniformWriter.js";
import { WebGL2UniformBuffer } from "../../src/renderers/WebGL2/WebGL2UniformBuffer.js";
import { Vector3D } from "../../src/math/index.js";
import {
  WebGL2GlobalUniformLayout,
  WebGL2PointLightLayout,
  WebGL2SpotLightLayout,
  WebGL2AreaLightLayout,
  WebGPUGGlobalUniformLayout,
} from "../../src/renderers/GlobalUniformLayout.js";
import STRUCTS_WGSL from "../../src/renderers/shaders/source/web_gpu/chunks/structs.wgsl?raw";
import BASE_VERTEX_GLSL from "../../src/renderers/shaders/source/web_gl2/chunks/base_vertex_header.vert.glsl?raw";
import LIGHTS_FRAG_GLSL from "../../src/renderers/shaders/source/web_gl2/chunks/lights.frag.glsl?raw";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, "global-uniform-snapshot.json");

interface PackedSnapshot {
  /** 528 floats = full 2112-byte WebGL2 GlobalUniforms UBO, _data order. */
  webgl2: number[];
  /** 220 floats = full 880-byte WebGPU GlobalUniforms buffer (scratchGlobalBufferData). */
  webgpu: number[];
}

// ── Controlled renderer state ────────────────────────────────────────────────────────────────
// Deterministic, unique-per-slot values so a swapped/off-by-N offset or index shows up as a byte
// difference. The state is identical for the old and the table-driven writers, so the packed
// buffers must match the committed snapshot byte for byte.

function makeMockGL(): WebGL2RenderingContext {
  return {
    createBuffer: () => ({}),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    bufferSubData: vi.fn(),
    bindBufferBase: vi.fn(),
    uniformBlockBinding: vi.fn(),
    deleteBuffer: vi.fn(),
    UNIFORM_BUFFER: 0x8a11,
    DYNAMIC_DRAW: 0x88e8,
  } as unknown as WebGL2RenderingContext;
}

function makeWorldMatrix(seed: number): Float32Array {
  const data = new Float32Array(16);
  for (let i = 0; i < 16; i++) {
    data[i] = seed + i * 0.5;
  }
  return data;
}

function makeLights(): Any {
  return {
    aCol: { r: 0.1, g: 0.2, b: 0.3 },
    aIntensity: 1.0,
    dCol: { r: 0.4, g: 0.5, b: 0.6 },
    dIntensity: 0.5,
    dDir: { x: 0.7, y: 0.8, z: 0.9 },
    pLights: [
      {
        worldMatrix: { data: makeWorldMatrix(1) },
        color: { r: 1, g: 0, b: 0 },
        intensity: 2,
        distance: 10,
        decay: 0.5,
      },
      {
        worldMatrix: { data: makeWorldMatrix(2) },
        color: { r: 0, g: 1, b: 0 },
        intensity: 3,
        distance: 20,
        decay: 0.25,
      },
    ],
    sLights: [
      {
        worldMatrix: { data: makeWorldMatrix(3) },
        direction: { x: 0, y: 0, z: -1 },
        color: { r: 1, g: 0, b: 0 },
        intensity: 2,
        angle: 0.5,
        penumbra: 0.1,
        distance: 30,
        decay: 0.5,
      },
      {
        worldMatrix: { data: makeWorldMatrix(4) },
        direction: { x: 0, y: 1, z: 0 },
        color: { r: 0, g: 0, b: 1 },
        intensity: 1.5,
        angle: 0.7,
        penumbra: 0.2,
        distance: 40,
        decay: 0.6,
      },
    ],
    aLights: [
      {
        worldMatrix: { data: makeWorldMatrix(5) },
        color: { r: 0, g: 1, b: 1 },
        intensity: 1.2,
        width: 2,
        height: 3,
        distance: 50,
        decay: 0.7,
      },
      {
        worldMatrix: { data: makeWorldMatrix(6) },
        color: { r: 1, g: 1, b: 0 },
        intensity: 0.8,
        width: 4,
        height: 5,
        distance: 60,
        decay: 0.8,
      },
    ],
  };
}

function makeScene(): Any {
  return {
    fog: null,
    environmentIntensity: 0.5,
    irradianceMap: undefined,
    prefilterMap: undefined,
    brdfLUT: undefined,
  };
}

function makeVp(): Float32Array {
  const vp = new Float32Array(16);
  for (let i = 0; i < 16; i++) {
    vp[i] = i + 1;
  }
  return vp;
}

function captureWebGL2(): number[] {
  const gl = makeMockGL();
  const ubo = new WebGL2UniformBuffer(gl, 2112, 0) as Any;
  const renderer = Object.create(WebGL2Renderer.prototype) as Any;
  renderer._globalUBO = ubo;
  renderer.postProcessing = { enabled: false };
  renderer._quality = { gamma: 2.2, exposure: 1.0 };
  renderer._clusterDims = { x: 12, y: 13, z: 14 };
  renderer._clusterMaxLightsPerCluster = 32;

  renderer.updateGlobalUBO(makeVp(), new Vector3D(11, 12, 13), makeLights(), 0.1, 500);
  renderer.writeClusterGridUniforms([32, 32]);

  return Array.from(ubo._data.subarray(0, 2112 / 4));
}

function captureWebGPU(): number[] {
  const device = { queue: { writeBuffer: vi.fn() } };
  // The writer reaches its host through WebGPURenderer's accessors only; a minimal stub is
  // enough to exercise the byte-exact packing below (the same state the old renderer test set).
  const host = {
    gpuDevice: device,
    postProcessing: { enabled: false },
    quality: { gamma: 2.2, exposure: 1.0, clusteredLighting: { tileSize: [32, 32] } },
    gpuCanvasContext: { canvas: { width: 1280, height: 720 } },
    clusterDims: { x: 12, y: 13, z: 14 },
    clusterMaxLightsPerCluster: 32,
    _writeViewSlot: (): number => 0,
    _rebuildGlobalBindGroupForScene: (): void => {},
  } as unknown as WebGPURenderer;
  const writer = new GlobalUniformWriter(host) as Any;
  writer._pointLightBuffer = {};
  writer._spotLightBuffer = {};
  writer._areaLightBuffer = {};
  writer._globalUniformBuffer = {};

  writer.update(
    makeVp(),
    new Vector3D(11, 12, 13),
    makeLights(),
    makeScene(),
    0.1,
    500,
    makeProj(),
  );

  return Array.from(writer._scratchGlobalBufferData);
}

function makeProj(): Float32Array {
  return new Float32Array([1.2, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function captureSnapshot(): PackedSnapshot {
  return { webgl2: captureWebGL2(), webgpu: captureWebGPU() };
}

function loadFixture(): PackedSnapshot {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as PackedSnapshot;
}

describe("GlobalUniforms byte-identity (snapshot taken from the OLD writers before the layout refactor)", () => {
  it("packs the WebGL2 UBO and the WebGPU global buffer bit-identical to the committed snapshot", () => {
    const packed = captureSnapshot();
    if (process.env["UPDATE_GLOBAL_UNIFORM_SNAPSHOT"] === "1") {
      fs.writeFileSync(FIXTURE_PATH, JSON.stringify(packed, null, 1) + "\n", "utf8");
    }
    const committed = loadFixture();
    expect(packed.webgl2).toEqual(committed.webgl2);
    expect(packed.webgpu).toEqual(committed.webgpu);
  });

  it("webgl2 snapshot is a full 2112-byte block (528 floats)", () => {
    const packed = captureSnapshot();
    expect(packed.webgl2).toHaveLength(528);
  });

  it("webgpu snapshot is a full 880-byte block (220 floats)", () => {
    const packed = captureSnapshot();
    expect(packed.webgpu).toHaveLength(220);
  });
});

// ── Shader-parse fidelity: the layout tables must equal the authoritative shader sources ──────
// GlobalUniformLayout.ts is the writers' single source of truth; these tests re-derive the block
// from the WGSL struct and the two GLSL std140 copies (with a tiny std140 layout engine) and
// assert field order, offsets and sizes match the tables. A shader edit that moves or resizes a
// field fails here instead of silently corrupting rendering.

interface ShaderField {
  name: string;
  type: ShaderType;
}

type ShaderType =
  | { kind: "scalar" }
  | { kind: "vec2" }
  | { kind: "vec3" }
  | { kind: "vec4" }
  | { kind: "mat4" }
  | { kind: "struct"; fields: readonly ShaderField[] }
  | { kind: "array"; elem: ShaderType; count: number };

function roundUp(alignment: number, value: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function shaderAlign(t: ShaderType): number {
  switch (t.kind) {
    case "scalar":
      return 4;
    case "vec2":
      return 8;
    case "vec3":
    case "vec4":
    case "mat4":
    case "struct":
      return 16;
    case "array":
      return shaderAlign(t.elem);
  }
}

function shaderSize(t: ShaderType): number {
  switch (t.kind) {
    case "scalar":
      return 4;
    case "vec2":
      return 8;
    case "vec3":
      return 12;
    case "vec4":
      return 16;
    case "mat4":
      return 64;
    case "struct": {
      let end = 0;
      for (const f of t.fields) {
        end = roundUp(shaderAlign(f.type), end);
        end += shaderSize(f.type);
      }
      return roundUp(shaderAlign(t), end);
    }
    case "array": {
      const stride = roundUp(shaderAlign(t.elem), shaderSize(t.elem));
      return stride * t.count;
    }
  }
}

/** Lays a member list out per std140 rules and returns {name -> byte offset+size} plus the total. */
function layoutStd140(members: readonly ShaderField[]): {
  fields: Map<string, { offset: number; size: number }>;
  total: number;
} {
  const fields = new Map<string, { offset: number; size: number }>();
  let cursor = 0;
  for (const m of members) {
    cursor = roundUp(shaderAlign(m.type), cursor);
    const size = shaderSize(m.type);
    fields.set(m.name, { offset: cursor, size });
    cursor += size;
  }
  return { fields, total: cursor };
}

/** Extracts all named struct definitions (`struct NAME { members };`) from a GLSL source. */
function parseStructDefs(source: string): Map<string, ShaderField[]> {
  const defs = new Map<string, ShaderField[]>();
  const re = /struct\s+(\w+)\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    defs.set(match[1]!, parseGLSLMembers(match[2]!));
  }
  return defs;
}

/** Extracts a single named struct (`struct NAME { members };`) body from a GLSL source. */
function parseGLSLStruct(source: string, structName: string): ShaderField[] {
  const match = source.match(new RegExp(`struct\\s+${structName}\\s*\\{([^}]*)\\}`));
  expect(match, `GLSL struct ${structName} must exist`).toBeTruthy();
  return parseGLSLMembers(match![1]!);
}

function parseGLSLMembers(
  body: string,
  structDefs?: ReadonlyMap<string, ShaderField[]>,
): ShaderField[] {
  const members: ShaderField[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (line === "") continue;
    const m = line.match(/^(\w+)\s+(\w+)(?:\s*\[(\d+)\])?\s*;$/);
    expect(m, `malformed GLSL member <${line}>`).toBeTruthy();
    const typeName = m![1]!;
    const name = m![2]!;
    const count = m![3];
    members.push({
      name,
      type: count
        ? { kind: "array", elem: glslBaseType(typeName, structDefs), count: Number(count) }
        : glslBaseType(typeName, structDefs),
    });
  }
  return members;
}

/** Resolves a GLSL member type name to its std140 type. Nested structs are resolved structurally. */
function glslBaseType(
  typeName: string,
  structDefs: ReadonlyMap<string, ShaderField[]> | undefined,
): ShaderType {
  switch (typeName) {
    case "int":
    case "float":
      return { kind: "scalar" };
    case "vec2":
      return { kind: "vec2" };
    case "vec3":
      return { kind: "vec3" };
    case "vec4":
      return { kind: "vec4" };
    case "mat4":
      return { kind: "mat4" };
    default: {
      expect(structDefs, `GLSL type <${typeName}> is not a primitive`).toBeDefined();
      const nested = structDefs!.get(typeName);
      expect(nested, `GLSL struct definition <${typeName}> must exist`).toBeDefined();
      return { kind: "struct", fields: nested! };
    }
  }
}

/** Computes the WGSL GlobalUniforms field layout in float units. */
function layoutWGSLGlobalUniforms(): {
  fields: Map<string, { index: number; floats: number }>;
  totalFloats: number;
} {
  const structMatch = STRUCTS_WGSL.match(/struct\s+GlobalUniforms\s*\{([\s\S]*?)\}/);
  expect(structMatch, "WGSL struct GlobalUniforms must exist").toBeTruthy();
  const fields = new Map<string, { index: number; floats: number }>();
  let cursor = 0;
  for (const rawLine of structMatch![1]!.split("\n")) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (line === "") continue;
    const m = line.match(/^(\w+)\s*:\s*(array<\s*\w+\s*,\s*\d+\s*>|\w+)\s*,?\s*$/);
    expect(m, `malformed WGSL member <${line}>`).toBeTruthy();
    const name = m![1]!;
    const typeText = m![2]!.trim();
    const arr = typeText.match(/^array<(\w+),\s*(\d+)>$/);
    const floats = arr ? Number(arr[2]) * wgslScalarFloats(arr[1]!) : wgslScalarFloats(typeText);
    cursor = roundUp(wgslAlignmentFloats(typeText), cursor);
    fields.set(name, { index: cursor, floats });
    cursor += floats;
  }
  return { fields, totalFloats: cursor };
}

function wgslScalarFloats(typeText: string): number {
  switch (typeText) {
    case "mat4x4f":
      return 16;
    case "vec4f":
      return 4;
    case "vec2f":
      return 2;
    case "f32":
      return 1;
    default:
      throw new Error(`Unhandled WGSL type <${typeText}>`);
  }
}

/** WGSL uniform host-shareable alignment, in float units (16B=4, 8B=2, 4B=1). */
function wgslAlignmentFloats(typeText: string): number {
  const arr = typeText.match(/^array<(\w+),\s*\d+>$/);
  const base = arr ? arr[1]! : typeText;
  return Math.min(4, wgslScalarFloats(base));
}

const WEBGL2_OUTER_MEMBERS: ReadonlyArray<{ shader: string; table: string }> = [
  { shader: "u_vp", table: "vp" },
  { shader: "u_viewPos", table: "viewPos" },
  { shader: "u_ambientColor", table: "ambientColor" },
  { shader: "u_dirLightColor", table: "dirLightColor" },
  { shader: "u_dirLightDir", table: "dirLightDir" },
  { shader: "u_numPointLights", table: "numPointLights" },
  { shader: "u_numSpotLights", table: "numSpotLights" },
  { shader: "u_numAreaLights", table: "numAreaLights" },
  { shader: "u_gamma", table: "gamma" },
  { shader: "u_exposure", table: "exposure" },
  { shader: "u_cameraNearFar", table: "cameraNearFar" },
  { shader: "u_pointLights", table: "pointLights" },
  { shader: "u_spotLights", table: "spotLights" },
  { shader: "u_areaLights", table: "areaLights" },
  { shader: "u_tileSizePx", table: "tileSizePx" },
  { shader: "u_clusterDims", table: "clusterDims" },
];

function expectGLSLBlockMatchesTable(source: string): void {
  const blockMatch = source.match(/uniform\s+GlobalUniforms\s*\{([\s\S]*?)\};/);
  expect(blockMatch, "GLSL GlobalUniforms block must exist").toBeTruthy();
  const structDefs = parseStructDefs(source);
  const members = parseGLSLMembers(blockMatch![1]!, structDefs);
  const { fields, total } = layoutStd140(members);
  expect(total).toBe(WebGL2GlobalUniformLayout.totalBytes);
  for (const pair of WEBGL2_OUTER_MEMBERS) {
    const laid = fields.get(pair.shader);
    const table =
      WebGL2GlobalUniformLayout.fields[pair.table as keyof typeof WebGL2GlobalUniformLayout.fields];
    expect(laid, `GLSL member ${pair.shader} must exist`).toBeDefined();
    expect(laid!.offset).toBe(table.offset);
    expect(laid!.size).toBe(table.size);
  }
}

/** Asserts a GLSL struct member sits at the given byte offset (layout engine already ran). */
function expectGLSLMember(
  source: string,
  structName: string,
  memberName: string,
): { offset: number; size: number } {
  const { fields } = layoutStd140(parseGLSLStruct(source, structName));
  const laid = fields.get(memberName);
  expect(laid, `GLSL ${structName}.${memberName} must exist`).toBeDefined();
  return laid!;
}

describe("shader parse: GlobalUniformLayout equals the authoritative shaders", () => {
  it("WGSL struct GlobalUniforms matches the WebGPU table (float order + sizes)", () => {
    const { fields, totalFloats } = layoutWGSLGlobalUniforms();
    expect(totalFloats).toBe(WebGPUGGlobalUniformLayout.totalFloats);
    for (const [name, entry] of fields) {
      const table =
        WebGPUGGlobalUniformLayout.fields[name as keyof typeof WebGPUGGlobalUniformLayout.fields];
      expect(table, `WGSL field ${name} must exist in the WebGPU table`).toBeDefined();
      expect(entry.index).toBe(table.index);
      expect(entry.floats).toBe(table.floats);
    }
    expect(fields.size).toBe(Object.keys(WebGPUGGlobalUniformLayout.fields).length);
  });

  it("base_vertex_header.vert.glsl std140 block matches the WebGL2 table", () => {
    expectGLSLBlockMatchesTable(BASE_VERTEX_GLSL);
  });

  it("lights.frag.glsl std140 block matches the WebGL2 table", () => {
    expectGLSLBlockMatchesTable(LIGHTS_FRAG_GLSL);
  });

  it("nested PointLight/SpotLight/AreaLight std140 offsets match the slot sub-layout tables", () => {
    for (const source of [BASE_VERTEX_GLSL, LIGHTS_FRAG_GLSL]) {
      // PointLight: GLSL member names are a 1:1 with the writer-facing table.
      expect(expectGLSLMember(source, "PointLight", "pos").offset).toBe(WebGL2PointLightLayout.pos);
      expect(expectGLSLMember(source, "PointLight", "color").offset).toBe(
        WebGL2PointLightLayout.color,
      );
      expect(expectGLSLMember(source, "PointLight", "distance").offset).toBe(
        WebGL2PointLightLayout.distance,
      );
      expect(expectGLSLMember(source, "PointLight", "decay").offset).toBe(
        WebGL2PointLightLayout.decay,
      );
      expect(expectGLSLMember(source, "PointLight", "decay").size).toBe(4);

      // SpotLight: GLSL folds the last four floats into `params`; the table splits that vec4.
      // The table's four sub-offsets must sit exactly inside the GLSL params range.
      expect(expectGLSLMember(source, "SpotLight", "pos").offset).toBe(WebGL2SpotLightLayout.pos);
      expect(expectGLSLMember(source, "SpotLight", "dir").offset).toBe(WebGL2SpotLightLayout.dir);
      expect(expectGLSLMember(source, "SpotLight", "color").offset).toBe(
        WebGL2SpotLightLayout.color,
      );
      const spotParams = expectGLSLMember(source, "SpotLight", "params");
      expect(spotParams.offset).toBe(WebGL2SpotLightLayout.angleCos);
      expect(spotParams.size).toBe(
        WebGL2SpotLightLayout.decay + 4 - WebGL2SpotLightLayout.angleCos,
      );

      // AreaLight: GLSL uses right/up/normal/size/params; the table uses u/v/w and the four
      // scalar tails. Bind each against the table via the shared slot offsets.
      expect(expectGLSLMember(source, "AreaLight", "pos").offset).toBe(WebGL2AreaLightLayout.pos);
      expect(expectGLSLMember(source, "AreaLight", "color").offset).toBe(
        WebGL2AreaLightLayout.color,
      );
      expect(expectGLSLMember(source, "AreaLight", "right").offset).toBe(WebGL2AreaLightLayout.u);
      expect(expectGLSLMember(source, "AreaLight", "up").offset).toBe(WebGL2AreaLightLayout.v);
      expect(expectGLSLMember(source, "AreaLight", "normal").offset).toBe(WebGL2AreaLightLayout.w);
      const areaSize = expectGLSLMember(source, "AreaLight", "size");
      expect(areaSize.offset).toBe(WebGL2AreaLightLayout.widthHalf);
      expect(areaSize.size).toBe(
        WebGL2AreaLightLayout.heightHalf + 4 - WebGL2AreaLightLayout.widthHalf,
      );
      const areaParams = expectGLSLMember(source, "AreaLight", "params");
      expect(areaParams.offset).toBe(WebGL2AreaLightLayout.distance);
      expect(areaParams.size).toBe(
        WebGL2AreaLightLayout.decay + 4 - WebGL2AreaLightLayout.distance,
      );
    }
  });
});

/**
 * Synthetic indexed grid GLB fixture for the `swm lod` core + CLI tests.
 *
 * Self-contained (no repo asset dependency): builds a wavy `width`x`height` triangle grid
 * (1922 tris for 32x32) with POSITION / NORMAL / TEXCOORD_0 and one named material, then
 * serializes a VALID glTF 2.0 .glb container exactly the way the writer under test does
 * (JSON chunk padded with 0x20 spaces, accessors linked to their buffer views).
 */

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_TYPE = 0x4e4f534a;
const GLB_BIN_TYPE = 0x004e4942;

export interface GridGlb {
  glb: Uint8Array;
  /** Triangle count per primitive (index array length / 3). */
  trisPerPrim: readonly number[];
  width: number;
  height: number;
}

/** Serializes a glTF JSON object + one binary buffer into a .glb container. */
export function assembleGlb(json: unknown, bin: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = Math.ceil(jsonBytes.length / 4) * 4;
  const binPadded = Math.ceil(bin.length / 4) * 4;
  const total = 12 + 8 + jsonPadded + 8 + binPadded;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, GLB_JSON_TYPE, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded);
  view.setUint32(20 + jsonPadded, binPadded, true);
  view.setUint32(20 + jsonPadded + 4, GLB_BIN_TYPE, true);
  out.set(bin, 20 + jsonPadded + 8);
  return out;
}

/**
 * Builds a wavy indexed grid GLB: `width` x `height` grid -> `(width-1)*(height-1)*2`
 * triangles, positions on an undulating surface in a ~[0, ...] box, neutral +Y normals,
 * UVs in [0,1], one unnamed-material slot (named material exercises the copy path).
 */
export function buildGridGlb(width: number, height: number): GridGlb {
  if (width < 2 || height < 2) {
    throw new Error("grid fixture needs width/height >= 2");
  }
  const vcount = width * height;
  const positions = new Float32Array(vcount * 3);
  const normals = new Float32Array(vcount * 3);
  const uvs = new Float32Array(vcount * 2);
  const minP = [Infinity, Infinity, Infinity];
  const maxP = [-Infinity, -Infinity, -Infinity];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const px = x * 0.25;
      const py = Math.sin(x * 0.7) * Math.cos(y * 0.5) * 0.35;
      const pz = y * 0.25;
      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;
      normals[i * 3 + 1] = 1;
      uvs[i * 2] = x / (width - 1);
      uvs[i * 2 + 1] = y / (height - 1);
      minP[0] = Math.min(minP[0]!, px);
      minP[1] = Math.min(minP[1]!, py);
      minP[2] = Math.min(minP[2]!, pz);
      maxP[0] = Math.max(maxP[0]!, px);
      maxP[1] = Math.max(maxP[1]!, py);
      maxP[2] = Math.max(maxP[2]!, pz);
    }
  }
  const indices = new Uint32Array((width - 1) * (height - 1) * 6);
  let t = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const a = y * width + x;
      const b = a + 1;
      const c = a + width;
      const d = c + 1;
      indices[t++] = a;
      indices[t++] = b;
      indices[t++] = d;
      indices[t++] = a;
      indices[t++] = d;
      indices[t++] = c;
    }
  }

  const bin = new Uint8Array(
    positions.byteLength + normals.byteLength + uvs.byteLength + indices.byteLength,
  );
  const posOff = 0;
  const nrmOff = positions.byteLength;
  const uvOff = nrmOff + normals.byteLength;
  const idxOff = uvOff + uvs.byteLength;
  bin.set(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength), posOff);
  bin.set(new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength), nrmOff);
  bin.set(new Uint8Array(uvs.buffer, uvs.byteOffset, uvs.byteLength), uvOff);
  bin.set(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), idxOff);

  const json = {
    asset: { version: "2.0", generator: "swm lod test fixture" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "grid", mesh: 0 }],
    meshes: [
      {
        name: "grid",
        primitives: [
          { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 },
        ],
      },
    ],
    materials: [
      {
        name: "gridMat",
        pbrMetallicRoughness: {
          baseColorFactor: [0.4, 0.7, 0.5, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        doubleSided: false,
        alphaMode: "OPAQUE",
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vcount, type: "VEC3", min: minP, max: maxP },
      { bufferView: 1, componentType: 5126, count: vcount, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: vcount, type: "VEC2" },
      { bufferView: 3, componentType: 5125, count: indices.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: posOff, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: nrmOff, byteLength: normals.byteLength },
      { buffer: 0, byteOffset: uvOff, byteLength: uvs.byteLength },
      { buffer: 0, byteOffset: idxOff, byteLength: indices.byteLength },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  return { glb: assembleGlb(json, bin), trisPerPrim: [indices.length / 3], width, height };
}

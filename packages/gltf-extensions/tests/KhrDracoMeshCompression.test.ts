import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GltfLoader, registerGltfExtension } from "@small-world-machine/engine";
import {
  createKhrDracoMeshCompressionPlugin,
  khrDracoMeshCompression,
} from "../src/draco/KhrDracoMeshCompression.js";
import { DracoDecoder } from "../src/draco/DracoDecoder.js";

describe("KHR_draco_mesh_compression", () => {
  beforeEach(() => {
    registerGltfExtension(khrDracoMeshCompression);
  });

  afterEach(() => {
    DracoDecoder.setDecodeHandler(null);
  });

  it("decodes Draco primitive attributes into GeometryDataInterface via custom decode handler", async () => {
    DracoDecoder.setDecodeHandler((_buffer, attributeIds) => {
      expect(attributeIds["POSITION"]).toBe(0);
      expect(attributeIds["NORMAL"]).toBe(1);

      return DracoDecoder.createGeometryData({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
        uvs: new Float32Array([0, 0, 1, 0, 0.5, 1]),
        indices: new Uint16Array([0, 1, 2]),
      });
    });

    const compressedPayload = new Uint8Array([0x44, 0x52, 0x41, 0x43, 0x4f, 1, 2, 3, 4, 5]).buffer;

    const gltf = {
      json: {
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: compressedPayload.byteLength }],
        meshes: [
          {
            name: "DracoMesh",
            primitives: [
              {
                attributes: {},
                extensions: {
                  KHR_draco_mesh_compression: {
                    bufferView: 0,
                    attributes: {
                      POSITION: 0,
                      NORMAL: 1,
                    },
                  },
                },
              },
            ],
          },
        ],
        nodes: [{ name: "HeroMeshNode", mesh: 0 }],
        scenes: [{ nodes: [0] }],
        scene: 0,
      },
      buffers: [compressedPayload],
    };

    const loader = new GltfLoader();
    const scene = await loader.parse(gltf, "");
    expect(scene).toBeDefined();

    const node = scene.getObjectByName("HeroMeshNode");
    expect(node).toBeDefined();
    expect(node?.children.length).toBe(1);

    const mesh = node?.children[0];
    expect(mesh?.geometry).toBeDefined();
    expect(mesh?.geometry?.vertices).toHaveLength(9);
    expect(mesh?.geometry?.normals).toHaveLength(9);
    expect(mesh?.geometry?.indices).toHaveLength(3);
  });

  it("handles missing bufferView gracefully by returning null", async () => {
    const gltf = {
      json: {
        bufferViews: [],
        meshes: [
          {
            primitives: [
              {
                attributes: {},
                extensions: {
                  KHR_draco_mesh_compression: {
                    bufferView: 99, // invalid index
                    attributes: { POSITION: 0 },
                  },
                },
              },
            ],
          },
        ],
        nodes: [{ mesh: 0 }],
      },
      buffers: [],
    };

    const loader = new GltfLoader();
    const scene = await loader.parse(gltf, "");
    expect(scene).toBeDefined();
    // Primitive failed to decode, so no mesh child added
    expect(scene.children[0]?.children.length).toBe(0);
  });

  it("isolates per-instance Draco plugins via GltfLoaderOptions.extensions without global state (AS07)", async () => {
    const pluginA = createKhrDracoMeshCompressionPlugin({
      customHandler: () =>
        DracoDecoder.createGeometryData({
          positions: new Float32Array([1, 0, 0, 2, 0, 0, 3, 0, 0]),
          indices: new Uint16Array([0, 1, 2]),
        }),
    });
    const pluginB = createKhrDracoMeshCompressionPlugin({
      customHandler: () =>
        DracoDecoder.createGeometryData({
          positions: new Float32Array([10, 0, 0, 20, 0, 0, 30, 0, 0]),
          indices: new Uint16Array([0, 1, 2]),
        }),
    });

    const payload = new Uint8Array([0x44, 0x52, 0x41, 0x43, 0x4f, 1, 2, 3, 4, 5]).buffer;
    const makeGltf = (): { json: Record<string, unknown>; buffers: ArrayBuffer[] } => ({
      json: {
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: payload.byteLength }],
        meshes: [
          {
            primitives: [
              {
                attributes: {},
                extensions: {
                  KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } },
                },
              },
            ],
          },
        ],
        nodes: [{ name: "Node", mesh: 0 }],
        scenes: [{ nodes: [0] }],
        scene: 0,
      },
      buffers: [payload],
    });

    const loaderA = new GltfLoader({ extensions: [pluginA] });
    const loaderB = new GltfLoader({ extensions: [pluginB] });
    const sceneA = await loaderA.parse(makeGltf(), "");
    const sceneB = await loaderB.parse(makeGltf(), "");

    expect(sceneA.getObjectByName("Node")?.children[0]?.geometry?.vertices[0]).toBe(1);
    expect(sceneB.getObjectByName("Node")?.children[0]?.geometry?.vertices[0]).toBe(10);
  });
});

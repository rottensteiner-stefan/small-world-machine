import { describe, it, expect } from "vitest";
import { WorldWriter, GltfDocument } from "../../src/loaders/WorldWriter.js";
import { GltfLoader } from "../../src/loaders/GltfLoader.js";
import { GltfData } from "../../src/loaders/gltf/index.js";
import { Object3D } from "../../src/core/Object3D.js";
import { PointLight } from "../../src/core/lights/PointLight.js";
import { DirectionalLight } from "../../src/core/lights/DirectionalLight.js";
import { SpotLight } from "../../src/core/lights/SpotLight.js";
import { AmbientLight } from "../../src/core/lights/AmbientLight.js";
import { StandardMaterial } from "../../src/core/materials/surface/StandardMaterial.js";
import { Color } from "../../src/core/colors/Color.js";
import { Matrix4, Vector3D, Quaternion } from "../../src/math/index.js";
import { GeometryDataInterface } from "../../src/interfaces/index.js";
import { StageZone } from "../../src/core/stage/StageZone.js";
import { StageZoneMarker } from "../../src/core/stage/StageZoneMarker.js";
import { Cube } from "../../src/geometry/index.js";
import { Raycaster } from "../../src/physix/Raycaster.js";

/** Mirrors `GltfLoader`'s own private `_decodeBase64` -- decoding here is test setup, not
 * something the writer/loader pair needs to expose publicly. */
function decodeDataUri(uri: string): ArrayBuffer {
  const base64 = uri.split(",")[1]!;
  const binaryStr = atob(base64);
  const buffer = new ArrayBuffer(binaryStr.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binaryStr.length; i++) view[i] = binaryStr.charCodeAt(i);
  return buffer;
}

function triangleGeometry(): GeometryDataInterface {
  return {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    getBoundingVolume: () => {
      throw new Error("not needed for this test");
    },
  } as unknown as GeometryDataInterface;
}

async function parseDocument(doc: GltfDocument): Promise<Object3D> {
  // Round-trip through real JSON text, not just the in-memory object -- proves the document is
  // actually plain-JSON-safe, the same as it would be after being written to and read back
  // from a `.gltf` file on disk.
  const roundTripped = JSON.parse(JSON.stringify(doc)) as GltfData["json"];
  const buffers = doc.buffers ? [decodeDataUri(doc.buffers[0]!.uri)] : [];
  const loader = new GltfLoader();
  return loader.parse({ json: roundTripped, buffers }, "");
}

describe("WorldWriter <-> GltfLoader round trip", () => {
  it("preserves node hierarchy, transforms, one material, and one point light", async () => {
    const root = new Object3D("Root");

    const meshNode = new Object3D("Crate");
    meshNode.position.set(1, 2, 3);
    meshNode.rotation.set(0.3, 0.6, 0.1);
    meshNode.scale.set(2, 1, 1);
    meshNode.geometry = triangleGeometry();
    meshNode.material = new StandardMaterial({
      color: new Color(0.2, 0.4, 0.6, 1),
      metallic: 0.3,
      roughness: 0.7,
      emissiveColor: new Color(0.1, 0, 0),
    });

    const lightNode = new PointLight({
      name: "Lamp",
      color: new Color(1, 0.9, 0.8),
      intensity: 5,
      distance: 12,
      decay: 1.5,
    });
    lightNode.position.set(0, 5, 0);

    const groupNode = new Object3D("Group");
    groupNode.position.set(-1, 0, 0);
    groupNode.quaternion = new Quaternion().setFromAxisAngle(new Vector3D(0, 1, 0), Math.PI / 4);
    const nestedChild = new Object3D("Nested");
    nestedChild.position.set(0, 0, 2);
    groupNode.add(nestedChild);

    root.add(meshNode, lightNode, groupNode);

    const doc = new WorldWriter().write(root);
    const parsedRoot = await parseDocument(doc);

    expect(parsedRoot.children).toHaveLength(3);
    const [parsedMesh, parsedLight, parsedGroup] = parsedRoot.children;

    // -- Mesh node: name, transform, material --
    expect(parsedMesh!.name).toBe("Crate");
    expect(parsedMesh!.position.x).toBeCloseTo(1);
    expect(parsedMesh!.position.y).toBeCloseTo(2);
    expect(parsedMesh!.position.z).toBeCloseTo(3);
    expect(parsedMesh!.scale.x).toBeCloseTo(2);
    expect(parsedMesh!.scale.y).toBeCloseTo(1);
    expect(parsedMesh!.scale.z).toBeCloseTo(1);

    // Euler rotation round-trips as a quaternion (glTF's node.rotation is always a
    // quaternion) -- compare against the same Euler->matrix->quaternion conversion the
    // writer itself performs, using the engine's own math primitives as the oracle.
    const expectedQuat = new Quaternion().setFromRotationMatrix(
      new Matrix4().compose(new Vector3D(0, 0, 0), meshNode.rotation, new Vector3D(1, 1, 1)),
    );
    expect(parsedMesh!.quaternion?.x).toBeCloseTo(expectedQuat.x, 5);
    expect(parsedMesh!.quaternion?.y).toBeCloseTo(expectedQuat.y, 5);
    expect(parsedMesh!.quaternion?.z).toBeCloseTo(expectedQuat.z, 5);
    expect(parsedMesh!.quaternion?.w).toBeCloseTo(expectedQuat.w, 5);

    // GltfLoader attaches geometry/material to a synthetic "<name>_mesh" child object, not the
    // node itself -- matching glTF's own node-vs-mesh-instance separation.
    expect(parsedMesh!.children).toHaveLength(1);
    const parsedMat = parsedMesh!.children[0]!.material as StandardMaterial;
    expect(parsedMat.color.r).toBeCloseTo(0.2);
    expect(parsedMat.color.g).toBeCloseTo(0.4);
    expect(parsedMat.color.b).toBeCloseTo(0.6);
    expect(parsedMat.metallic).toBeCloseTo(0.3);
    expect(parsedMat.roughness).toBeCloseTo(0.7);
    expect(parsedMat.emissiveColor.r).toBeCloseTo(0.1);

    // -- Light node: type, transform, properties --
    expect(parsedLight!.name).toBe("Lamp");
    expect(parsedLight!).toBeInstanceOf(PointLight);
    const parsedPointLight = parsedLight as PointLight;
    expect(parsedPointLight.position.y).toBeCloseTo(5);
    expect(parsedPointLight.color.r).toBeCloseTo(1);
    expect(parsedPointLight.color.g).toBeCloseTo(0.9);
    expect(parsedPointLight.color.b).toBeCloseTo(0.8);
    expect(parsedPointLight.intensity).toBeCloseTo(5);
    expect(parsedPointLight.distance).toBeCloseTo(12);

    // -- Group node: explicit quaternion (not Euler) passes through unchanged, plus its
    // nested child survives the hierarchy walk --
    expect(parsedGroup!.name).toBe("Group");
    expect(parsedGroup!.position.x).toBeCloseTo(-1);
    expect(parsedGroup!.quaternion?.x).toBeCloseTo(groupNode.quaternion.x, 10);
    expect(parsedGroup!.quaternion?.y).toBeCloseTo(groupNode.quaternion.y, 10);
    expect(parsedGroup!.quaternion?.z).toBeCloseTo(groupNode.quaternion.z, 10);
    expect(parsedGroup!.quaternion?.w).toBeCloseTo(groupNode.quaternion.w, 10);
    expect(parsedGroup!.children).toHaveLength(1);
    expect(parsedGroup!.children[0]!.name).toBe("Nested");
    expect(parsedGroup!.children[0]!.position.z).toBeCloseTo(2);
  });

  it("omits meshes/materials/accessors/buffers entirely for a scene with no geometry", () => {
    const root = new Object3D("Root");
    root.add(new PointLight({ name: "OnlyLight" }));

    const doc = new WorldWriter().write(root);

    expect(doc.meshes).toBeUndefined();
    expect(doc.materials).toBeUndefined();
    expect(doc.accessors).toBeUndefined();
    expect(doc.buffers).toBeUndefined();
    expect(doc.extensions?.KHR_lights_punctual?.lights).toHaveLength(1);
  });

  it("writeSingle() serializes the object itself, not its children, without reparenting it", async () => {
    const liveParent = new Object3D("LiveParent");
    const obj = new Object3D("Selected");
    obj.position.set(4, 5, 6);
    liveParent.add(obj);
    const nested = new Object3D("NestedChild");
    obj.add(nested);

    const doc = new WorldWriter().writeSingle(obj);
    const parsedRoot = await parseDocument(doc);

    expect(parsedRoot.children).toHaveLength(1);
    expect(parsedRoot.children[0]!.name).toBe("Selected");
    expect(parsedRoot.children[0]!.position.x).toBeCloseTo(4);
    expect(parsedRoot.children[0]!.children).toHaveLength(1);
    expect(parsedRoot.children[0]!.children[0]!.name).toBe("NestedChild");

    // The live scene graph must be completely untouched by the export.
    expect(obj.parent).toBe(liveParent);
    expect(liveParent.children).toContain(obj);
  });

  it("round-trips prefabSource via the SWM_prefab_instance extension", async () => {
    const obj = new Object3D("Instance");
    obj.prefabSource = "OilBarrel";

    const doc = new WorldWriter().writeSingle(obj);
    const parsedRoot = await parseDocument(doc);

    expect(parsedRoot.children[0]!.prefabSource).toBe("OilBarrel");
  });

  it("round-trips a 4-point StageZoneMarker via the SWM_stage_zone extension", async () => {
    const marker = new StageZoneMarker(
      new StageZone({
        id: "zone_a",
        name: "ZONE A: TEST",
        points: [
          { u: 0.1, v: 0.1, scale: 1.0 },
          { u: 0.9, v: 0.1, scale: 1.0 },
          { u: 0.9, v: 0.9, scale: 0.4 },
          { u: 0.1, v: 0.9, scale: 0.4 },
        ],
      }),
    );

    const doc = new WorldWriter().writeSingle(marker);
    expect(doc.extensionsUsed).toContain("SWM_stage_zone");

    const parsedRoot = await parseDocument(doc);
    const parsed = parsedRoot.children[0]!;
    expect(parsed).toBeInstanceOf(StageZoneMarker);
    const parsedMarker = parsed as StageZoneMarker;
    expect(parsedMarker.zone.id).toBe("zone_a");
    expect(parsedMarker.zone.name).toBe("ZONE A: TEST");
    expect(parsedMarker.zone.points).toEqual(marker.zone.points);
  });

  it("round-trips a 6-point (non-quad) StageZoneMarker via SWM_stage_zone", async () => {
    const marker = new StageZoneMarker(
      new StageZone({
        id: "zone_hex",
        name: "Hex Zone",
        points: [
          { u: 0.2, v: 0 },
          { u: 0.8, v: 0 },
          { u: 1, v: 0.5 },
          { u: 0.8, v: 1 },
          { u: 0.2, v: 1 },
          { u: 0, v: 0.5 },
        ],
      }),
    );

    const doc = new WorldWriter().writeSingle(marker);
    const parsedRoot = await parseDocument(doc);
    const parsedMarker = parsedRoot.children[0]! as StageZoneMarker;

    expect(parsedMarker.zone.id).toBe("zone_hex");
    expect(parsedMarker.zone.points).toHaveLength(6);
    expect(parsedMarker.zone.points).toEqual(marker.zone.points);
  });

  it("round-trips directional, spot and ambient lights", async () => {
    const sun = new DirectionalLight({
      name: "SunLight",
      color: new Color(1, 0.9, 0.7),
      intensity: 2.5,
      direction: new Vector3D(0.3, -0.9, 0.1).normalize(),
      castShadow: true,
      shadowResolution: 2048,
      shadowBias: 0.002,
      numCascades: 3,
      cascadeSplitLambda: 0.7,
    });
    const spot = new SpotLight({
      name: "Torch",
      intensity: 4,
      direction: new Vector3D(1, 0, 0),
      distance: 12,
      angle: 0.6,
      penumbra: 0.25,
      decay: 1.5,
    });
    spot.position.set(1, 2, 3);
    const fill = new AmbientLight({
      name: "Fill",
      color: new Color(0.2, 0.3, 0.4),
      intensity: 0.4,
    });

    const root = new Object3D("Root");
    root.add(sun, spot, fill);
    const doc = new WorldWriter().write(root);
    expect(doc.extensionsUsed).toEqual(
      expect.arrayContaining(["KHR_lights_punctual", "SWM_lights_ambient"]),
    );
    const parsedRoot = await parseDocument(doc);

    const [pSun, pSpot, pFill] = parsedRoot.children as [DirectionalLight, SpotLight, AmbientLight];
    expect(pSun).toBeInstanceOf(DirectionalLight);
    expect(pSun.name).toBe("SunLight");
    expect(pSun.intensity).toBeCloseTo(2.5);
    expect(pSun.color.g).toBeCloseTo(0.9);
    expect(pSun.direction.x).toBeCloseTo(sun.direction.x);
    expect(pSun.direction.y).toBeCloseTo(sun.direction.y);
    expect(pSun.castShadow).toBe(true);
    expect(pSun.shadowResolution).toBe(2048);
    expect(pSun.shadowBias).toBeCloseTo(0.002);
    expect(pSun.numCascades).toBe(3);
    expect(pSun.cascadeSplitLambda).toBeCloseTo(0.7);

    expect(pSpot).toBeInstanceOf(SpotLight);
    expect(pSpot.position.z).toBeCloseTo(3);
    expect(pSpot.direction.x).toBeCloseTo(1);
    expect(pSpot.distance).toBeCloseTo(12);
    expect(pSpot.angle).toBeCloseTo(0.6);
    expect(pSpot.penumbra).toBeCloseTo(0.25);
    expect(pSpot.decay).toBeCloseTo(1.5);

    expect(pFill).toBeInstanceOf(AmbientLight);
    expect(pFill.name).toBe("Fill");
    expect(pFill.intensity).toBeCloseTo(0.4);
    expect(pFill.color.b).toBeCloseTo(0.4);
  });

  it("round-trips a real mesh with indices, normals and uvs, so the reloaded mesh renders and can be raycast", async () => {
    const source = new Object3D("Crate");
    source.geometry = new Cube({ size: 1 }).getGeometryData();
    source.material = new StandardMaterial();
    source.setPosition(0, 0.5, 0).setScale(6, 1, 6);
    const root = new Object3D("Root");
    root.add(source);

    const doc = new WorldWriter().write(root);
    const primitive = doc.meshes![0]!.primitives[0]!;
    expect(Object.keys(primitive.attributes).sort()).toEqual(["NORMAL", "POSITION", "TEXCOORD_0"]);
    expect(primitive.indices).toBeDefined();
    // Every buffer view starts on a 4-byte boundary, as glTF requires.
    expect(doc.bufferViews!.every((v) => 0 === v.byteOffset % 4)).toBe(true);

    const parsedRoot = await parseDocument(doc);
    const mesh = parsedRoot.children[0]!.children[0]!;
    const before = source.geometry;
    const after = mesh.geometry!;
    expect(Array.from(after.vertices)).toEqual(Array.from(before.vertices));
    expect(Array.from(after.indices!)).toEqual(Array.from(before.indices!));
    expect(Array.from(after.normals!)).toEqual(Array.from(before.normals!));
    expect(Array.from(after.uvs!)).toEqual(Array.from(before.uvs!));

    // The old failure mode: no indices meant no triangles to test, so a ray fell straight through.
    parsedRoot.updateMatrixWorld(true);
    mesh.computeBounds();
    const raycaster = new Raycaster();
    raycaster.ray.origin.set(0.3, 5, -0.9);
    raycaster.ray.direction.set(0, -1, 0);
    const hit = raycaster.intersectObjects([mesh])[0];
    expect(hit).toBeDefined();
    expect(hit!.point.y).toBeCloseTo(1, 5);
    expect(hit!.normal.y).toBeCloseTo(1, 5);
  });

  it("pads buffer views so an odd-length index buffer cannot misalign the next attribute", () => {
    const tri = new Object3D("Tri");
    tri.geometry = {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]), // 6 bytes: not a multiple of 4
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      getBoundingVolume: () => {
        throw new Error("not needed for this test");
      },
    } as unknown as GeometryDataInterface;
    tri.material = new StandardMaterial();
    const doc = new WorldWriter().writeSingle(tri);
    expect(doc.bufferViews!.every((v) => 0 === v.byteOffset % 4)).toBe(true);
  });
});

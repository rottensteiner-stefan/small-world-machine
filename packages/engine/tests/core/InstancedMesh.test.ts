import { InstancedMesh } from "../../src/core/InstancedMesh.js";
import { Matrix4 } from "../../src/math/Matrix4.js";
import { StandardMaterial } from "../../src/core/materials/surface/StandardMaterial.js";
import { GeometryDataInterface, BoundingVolume } from "../../src/interfaces/index.js";
import { describe, it, expect } from "vitest";

describe("InstancedMesh", () => {
  it("should initialize with default identity matrices and correct count", () => {
    const dummyGeometry: GeometryDataInterface = {
      vertices: new Float32Array([0, 0, 0]),
      getBoundingVolume: () => null as unknown as BoundingVolume,
    } as GeometryDataInterface;

    const dummyMaterial = new StandardMaterial();
    const count = 5;
    const mesh = new InstancedMesh("testInstanced", dummyGeometry, dummyMaterial, count);

    expect(mesh.name).toBe("testInstanced");
    expect(mesh.isInstancedMesh).toBe(true);
    expect(mesh.instanceCount).toBe(count);
    expect(mesh.instanceMatrices.length).toBe(count * 16);
    expect(mesh.instanceMatrixNeedsUpdate).toBe(true);

    // Verify first matrix is Identity
    const mat = new Matrix4();
    mesh.getMatrixAt(0, mat);
    expect(mat.data[0]).toBe(1);
    expect(mat.data[5]).toBe(1);
    expect(mat.data[10]).toBe(1);
    expect(mat.data[15]).toBe(1);
  });

  it("should allow setting and getting matrix at specific index", () => {
    const dummyGeometry: GeometryDataInterface = {
      vertices: new Float32Array([0, 0, 0]),
      getBoundingVolume: () => null as unknown as BoundingVolume,
    } as GeometryDataInterface;

    const dummyMaterial = new StandardMaterial();
    const mesh = new InstancedMesh("testInstanced", dummyGeometry, dummyMaterial, 3);

    const testMat = new Matrix4();
    testMat.data[12] = 10;
    testMat.data[13] = 20;
    testMat.data[14] = 30;

    mesh.setMatrixAt(1, testMat);
    expect(mesh.instanceMatrixNeedsUpdate).toBe(true);

    const outMat = new Matrix4();
    mesh.getMatrixAt(1, outMat);
    expect(outMat.data[12]).toBe(10);
    expect(outMat.data[13]).toBe(20);
    expect(outMat.data[14]).toBe(30);
  });
});

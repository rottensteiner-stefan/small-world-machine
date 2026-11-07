import type { BoundingVolume } from "./BoundingVolume.js";
import type { GeometryDataInterface } from "./GeometryData.js";

/**
 * Interface for all geometry types (Cube, Sphere, Plane, etc.).
 * Geometries are responsible for generating raw vertex and index data.
 */
export interface Geometry {
  /**
   * Returns the raw geometry data ready for GPU upload.
   * @returns The geometry data interface.
   */
  getGeometryData(): GeometryDataInterface;

  /**
   * Returns a bounding volume that encapsulates this geometry.
   * @returns The bounding volume.
   */
  getBoundingVolume(): BoundingVolume;
}

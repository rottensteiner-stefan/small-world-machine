import type { ClusteredLightingConfig } from "../../../interfaces/index.js";
import type { ClusterGridDims } from "../../../math/index.js";
import {
  CLUSTER_TEX_WIDTH,
  DEFAULT_CLUSTER_TILE_SIZE,
  DEFAULT_CLUSTER_Z_SLICES,
  DEFAULT_MAX_LIGHTS_PER_CLUSTER,
  computeClusterCounts,
} from "../../../math/index.js";

/**
 * Owns WebGL2's clustered-light-culling integer textures (RGBA32UI grid + RG32UI index list)
 * and grid sizing state -- see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md.
 */
export class WebGL2ClusterManager {
  private _dims: ClusterGridDims = { x: 1, y: 1, z: 1 };
  private _maxLightsPerCluster = 1;
  private _indexCapacity = CLUSTER_TEX_WIDTH;
  private _gridTex: WebGLTexture | undefined = undefined;
  private _indexTex: WebGLTexture | undefined = undefined;

  public get dims(): ClusterGridDims {
    return this._dims;
  }

  public get maxLightsPerCluster(): number {
    return this._maxLightsPerCluster;
  }

  /** Index slots (texels) the allocated cluster index texture holds. */
  public get indexCapacity(): number {
    return this._indexCapacity;
  }

  public get gridTex(): WebGLTexture {
    return this._gridTex!;
  }

  public get indexTex(): WebGLTexture {
    return this._indexTex!;
  }

  /**
   * (Re)allocates the WebGL2 clustered-light-culling data textures (RGBA32UI grid + RG32UI index
   * list) for the given grid size. Laid out on fixed-width 2D textures since WebGL2 has no 1D
   * texture target.
   */
  public allocate(
    gl: WebGL2RenderingContext,
    dims: ClusterGridDims,
    maxLightsPerCluster: number,
  ): void {
    const numClusters = Math.max(1, dims.x * dims.y * dims.z);
    const gridHeight = Math.max(1, Math.ceil(numClusters / CLUSTER_TEX_WIDTH));
    const indexCount = numClusters * Math.max(1, maxLightsPerCluster);
    // Clamp index rows to MAX_TEXTURE_SIZE so fine grids drop only excess tail slots instead of
    // triggering INVALID_OPERATION on texImage2D/texSubImage2D.
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const indexHeight = Math.min(
      Math.max(1, Math.ceil(indexCount / CLUSTER_TEX_WIDTH)),
      maxTextureSize,
    );

    if (this._gridTex) gl.deleteTexture(this._gridTex);
    if (this._indexTex) gl.deleteTexture(this._indexTex);
    this._gridTex = this._createIntegerTexture(gl, CLUSTER_TEX_WIDTH, gridHeight, true);
    this._indexTex = this._createIntegerTexture(gl, CLUSTER_TEX_WIDTH, indexHeight, false);

    this._dims = dims;
    this._maxLightsPerCluster = Math.max(1, maxLightsPerCluster);
    this._indexCapacity = indexHeight * CLUSTER_TEX_WIDTH;
  }

  /** Recomputes cluster grid dimensions on canvas resize and reallocates only when dims change. */
  public resizeForCanvas(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    clusterConfig?: ClusteredLightingConfig,
  ): void {
    const dims: ClusterGridDims =
      clusterConfig?.enabled === false
        ? { x: 1, y: 1, z: 1 }
        : computeClusterCounts(
            width,
            height,
            clusterConfig?.tileSize ?? DEFAULT_CLUSTER_TILE_SIZE,
            clusterConfig?.zSlices ?? DEFAULT_CLUSTER_Z_SLICES,
          );
    // WebGL2's raw light array is capped at 16 (see ADR 0007), so no cluster ever needs more.
    const maxLightsPerCluster = Math.min(
      clusterConfig?.enabled === false
        ? 16
        : (clusterConfig?.maxLightsPerCluster ?? DEFAULT_MAX_LIGHTS_PER_CLUSTER),
      16,
    );
    if (
      dims.x !== this._dims.x ||
      dims.y !== this._dims.y ||
      dims.z !== this._dims.z ||
      maxLightsPerCluster !== this._maxLightsPerCluster
    ) {
      this.allocate(gl, dims, maxLightsPerCluster);
    }
  }

  /** Drops dead GL handles on context loss so restore reallocates fresh textures. */
  public resetOnContextRestored(): void {
    this._gridTex = undefined;
    this._indexTex = undefined;
  }

  /** Frees the cluster grid and index textures. */
  public destroy(gl: WebGL2RenderingContext): void {
    if (this._gridTex) gl.deleteTexture(this._gridTex);
    if (this._indexTex) gl.deleteTexture(this._indexTex);
    this._gridTex = undefined;
    this._indexTex = undefined;
  }

  /**
   * Creates an integer 2D texture for clustered light culling data -- RGBA32UI (point.rg, spot.ba)
   * for the grid texture, RG32UI (point.r, spot.g) for the flat index list.
   */
  private _createIntegerTexture(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    isGrid: boolean,
  ): WebGLTexture {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      isGrid ? gl.RGBA32UI : gl.RG32UI,
      width,
      height,
      0,
      isGrid ? gl.RGBA_INTEGER : gl.RG_INTEGER,
      gl.UNSIGNED_INT,
      null,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }
}

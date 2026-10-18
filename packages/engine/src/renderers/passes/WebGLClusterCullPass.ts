import type { WebGLRenderPass } from "../WebGLRenderPass.js";
import type { AbstractWebGLRenderer } from "../AbstractWebGLRenderer.js";
import { WebGL2Renderer } from "../WebGL2/WebGL2Renderer.js";
import type { Scene } from "../../core/index.js";
import { DeviceLimit } from "../../core/index.js";
import type { Vector3D } from "../../math/index.js";
import {
  clusterIndex,
  lightClusterCoverage,
  CLUSTER_TEX_WIDTH,
  CLUSTER_GRID_UNIT,
  CLUSTER_INDEX_UNIT,
  DEFAULT_CLUSTER_TILE_SIZE,
} from "../../math/index.js";
import type { LightDataInterface } from "../../interfaces/index.js";
import type { RenderList } from "../../core/Scene.js";

/**
 * CPU-side clustered light culling for WebGL2 (fixed-capacity-per-cluster, no atomics -- see
 * docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md). For each of the (up to 16) point/spot
 * lights, computes its screen-space + radial-distance coverage range via `lightClusterCoverage()`
 * -- the same formula `cluster_cull.wgsl` uses on WebGPU -- and only visits the cluster cells
 * within that range, instead of testing every cell against every light.
 *
 * Packs point and spot data into 2 textures: RGBA32UI grid (point.rg, spot.ba) and RG32UI index (point.r, spot.g)
 * to strictly fit within the 16-texture-unit hardware limit (MAX_TEXTURE_IMAGE_UNITS = 16).
 */
export class WebGLClusterCullPass implements WebGLRenderPass {
  public name = "WebGLClusterCullPass";

  private _pointCounts = new Uint8Array(1);
  private _spotCounts = new Uint8Array(1);
  private _grid = new Uint32Array(4);
  private _indices = new Uint32Array(CLUSTER_TEX_WIDTH * 2);
  /** Next free slot in the flat index list per light type: lit cells are packed back to back. */
  private _pointNext: number = 0;
  private _spotNext: number = 0;
  private _warnedGridUnit: boolean = false;
  private _warnedIndexUnit: boolean = false;
  private _scratchCoverage = {
    cellMinX: 0,
    cellMaxX: 0,
    cellMinY: 0,
    cellMaxY: 0,
    sliceMin: 0,
    sliceMax: 0,
  };

  public execute(
    renderer: AbstractWebGLRenderer,
    _scene: Scene,
    vp: Float32Array,
    camPos: Vector3D,
    _vMat: Float32Array | undefined,
    _renderList: RenderList,
    extractedLights: LightDataInterface,
    near: number = 0.1,
    far: number = 1000,
    projMatrix?: Float32Array,
  ): void {
    if (!(renderer instanceof WebGL2Renderer)) return;

    const gl = renderer.webglContext as WebGL2RenderingContext;
    const dims = renderer.clusterDims;
    const maxLightsPerCluster = renderer.clusterMaxLightsPerCluster;
    const tileSizePx = renderer.quality.clusteredLighting?.tileSize ?? DEFAULT_CLUSTER_TILE_SIZE;
    const numClusters = dims.x * dims.y * dims.z;
    const gridHeight = Math.max(1, Math.ceil(numClusters / CLUSTER_TEX_WIDTH));
    const indexCount = numClusters * maxLightsPerCluster;
    const indexHeight = Math.max(1, Math.ceil(indexCount / CLUSTER_TEX_WIDTH));

    renderer.writeClusterGridUniforms(tileSizePx);

    if (this._grid.length < gridHeight * CLUSTER_TEX_WIDTH * 4) {
      this._grid = new Uint32Array(gridHeight * CLUSTER_TEX_WIDTH * 4);
    }
    if (this._pointCounts.length < numClusters) {
      this._pointCounts = new Uint8Array(numClusters);
      this._spotCounts = new Uint8Array(numClusters);
    }
    if (this._indices.length < indexHeight * CLUSTER_TEX_WIDTH * 2) {
      this._indices = new Uint32Array(indexHeight * CLUSTER_TEX_WIDTH * 2);
    }
    this._pointCounts.fill(0, 0, numClusters);
    this._spotCounts.fill(0, 0, numClusters);
    // Zero the grid every frame
    this._grid.fill(0, 0, numClusters * 4);
    this._pointNext = 0;
    this._spotNext = 0;

    if (!projMatrix) {
      // No projection matrix stashed yet (e.g. very first frame) -- leave every cluster empty
      this._uploadAndBind(gl, renderer, gridHeight, indexHeight);
      return;
    }

    const projScaleX = projMatrix[0]!;
    const projScaleY = projMatrix[5]!;
    const numPointLights = Math.min(extractedLights.pLights.length, 16);
    const numSpotLights = Math.min(extractedLights.sLights.length, 16);

    for (let i = 0; i < numPointLights; i++) {
      const light = extractedLights.pLights[i]!;
      this._cullPointLightIntoCells(
        light.worldMatrix.data,
        light.distance,
        i,
        vp,
        camPos,
        projScaleX,
        projScaleY,
        renderer,
        dims,
        maxLightsPerCluster,
        near,
        far,
      );
    }
    for (let i = 0; i < numSpotLights; i++) {
      const light = extractedLights.sLights[i]!;
      this._cullSpotLightIntoCells(
        light.worldMatrix.data,
        light.distance,
        i,
        vp,
        camPos,
        projScaleX,
        projScaleY,
        renderer,
        dims,
        maxLightsPerCluster,
        near,
        far,
      );
    }

    this._uploadAndBind(gl, renderer, gridHeight, indexHeight);
  }

  /** Projects one point light and writes its index into every cluster cell it can reach (R/G channels). */
  private _cullPointLightIntoCells(
    worldMatrixData: Float32Array,
    radius: number,
    lightIndex: number,
    vp: Float32Array,
    camPos: Vector3D,
    projScaleX: number,
    projScaleY: number,
    renderer: WebGL2Renderer,
    dims: { x: number; y: number; z: number },
    maxLightsPerCluster: number,
    near: number,
    far: number,
  ): void {
    const lx = worldMatrixData[12]!;
    const ly = worldMatrixData[13]!;
    const lz = worldMatrixData[14]!;
    const dx = lx - camPos.x;
    const dy = ly - camPos.y;
    const dz = lz - camPos.z;
    const viewDist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 0.0001);

    const clipX = vp[0]! * lx + vp[4]! * ly + vp[8]! * lz + vp[12]!;
    const clipY = vp[1]! * lx + vp[5]! * ly + vp[9]! * lz + vp[13]!;
    const clipW = vp[3]! * lx + vp[7]! * ly + vp[11]! * lz + vp[15]!;
    const ndcX = clipW !== 0 ? clipX / clipW : 0;
    const ndcY = clipW !== 0 ? clipY / clipW : 0;

    const coverage = lightClusterCoverage(
      viewDist,
      Math.max(radius, 0.001),
      ndcX,
      ndcY,
      clipW,
      projScaleX,
      projScaleY,
      renderer.webglContext.canvas.width,
      renderer.webglContext.canvas.height,
      renderer.quality.clusteredLighting?.tileSize ?? DEFAULT_CLUSTER_TILE_SIZE,
      dims,
      near,
      far,
      this._scratchCoverage,
    );

    for (let z = coverage.sliceMin; z <= coverage.sliceMax; z++) {
      for (let y = coverage.cellMinY; y <= coverage.cellMaxY; y++) {
        for (let x = coverage.cellMinX; x <= coverage.cellMaxX; x++) {
          const cell = clusterIndex(x, y, z, dims);
          const count = this._pointCounts[cell]!;
          if (count >= maxLightsPerCluster) continue;
          if (0 === count) {
            this._grid[cell * 4 + 0] = this._pointNext;
            this._pointNext += maxLightsPerCluster;
          }
          this._indices[(this._grid[cell * 4 + 0]! + count) * 2] = lightIndex;
          this._pointCounts[cell] = count + 1;
          this._grid[cell * 4 + 1] = count + 1;
        }
      }
    }
  }

  /** Projects one spot light and writes its index into every cluster cell it can reach (B/A and G channels). */
  private _cullSpotLightIntoCells(
    worldMatrixData: Float32Array,
    radius: number,
    lightIndex: number,
    vp: Float32Array,
    camPos: Vector3D,
    projScaleX: number,
    projScaleY: number,
    renderer: WebGL2Renderer,
    dims: { x: number; y: number; z: number },
    maxLightsPerCluster: number,
    near: number,
    far: number,
  ): void {
    const lx = worldMatrixData[12]!;
    const ly = worldMatrixData[13]!;
    const lz = worldMatrixData[14]!;
    const dx = lx - camPos.x;
    const dy = ly - camPos.y;
    const dz = lz - camPos.z;
    const viewDist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 0.0001);

    const clipX = vp[0]! * lx + vp[4]! * ly + vp[8]! * lz + vp[12]!;
    const clipY = vp[1]! * lx + vp[5]! * ly + vp[9]! * lz + vp[13]!;
    const clipW = vp[3]! * lx + vp[7]! * ly + vp[11]! * lz + vp[15]!;
    const ndcX = clipW !== 0 ? clipX / clipW : 0;
    const ndcY = clipW !== 0 ? clipY / clipW : 0;

    const coverage = lightClusterCoverage(
      viewDist,
      Math.max(radius, 0.001),
      ndcX,
      ndcY,
      clipW,
      projScaleX,
      projScaleY,
      renderer.webglContext.canvas.width,
      renderer.webglContext.canvas.height,
      renderer.quality.clusteredLighting?.tileSize ?? DEFAULT_CLUSTER_TILE_SIZE,
      dims,
      near,
      far,
      this._scratchCoverage,
    );

    for (let z = coverage.sliceMin; z <= coverage.sliceMax; z++) {
      for (let y = coverage.cellMinY; y <= coverage.cellMaxY; y++) {
        for (let x = coverage.cellMinX; x <= coverage.cellMaxX; x++) {
          const cell = clusterIndex(x, y, z, dims);
          const count = this._spotCounts[cell]!;
          if (count >= maxLightsPerCluster) continue;
          if (0 === count) {
            this._grid[cell * 4 + 2] = this._spotNext;
            this._spotNext += maxLightsPerCluster;
          }
          this._indices[(this._grid[cell * 4 + 2]! + count) * 2 + 1] = lightIndex;
          this._spotCounts[cell] = count + 1;
          this._grid[cell * 4 + 3] = count + 1;
        }
      }
    }
  }

  private _uploadAndBind(
    gl: WebGL2RenderingContext,
    renderer: WebGL2Renderer,
    gridHeight: number,
    indexHeight: number,
  ): void {
    // Lit cells are packed from slot 0, so only the rows that hold them need to reach the GPU --
    // uploading the full numClusters * maxLightsPerCluster table every frame costs megabytes.
    const usedIndexHeight = Math.min(
      indexHeight,
      Math.max(1, Math.ceil(Math.max(this._pointNext, this._spotNext) / CLUSTER_TEX_WIDTH)),
    );
    // Both fixed units can exceed a device that only offers the WebGL2 spec's guaranteed
    // minimum MAX_TEXTURE_IMAGE_UNITS (16, units 0-15) once the shadow system's own reserved
    // units (8-14, see WebGLProgramCache's doc) are accounted for -- degrade gracefully (skip +
    // warn) instead of corrupting whatever happens to already be bound at an invalid unit,
    // mirroring how WebGL2Renderer already guards its own fixed shadow-unit binds.
    const maxUnits = renderer.context.deviceCaps.getLimit(
      DeviceLimit.WEBGL2_MAX_TEXTURE_IMAGE_UNITS,
    );

    if (CLUSTER_GRID_UNIT >= maxUnits) {
      if (!this._warnedGridUnit) {
        this._warnedGridUnit = true;
        console.warn(
          `[WebGLClusterCullPass] Exceeded MAX_TEXTURE_IMAGE_UNITS (${maxUnits}). Cannot bind cluster grid texture to texture unit ${CLUSTER_GRID_UNIT}.`,
        );
      }
    } else {
      gl.activeTexture(gl.TEXTURE0 + CLUSTER_GRID_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, renderer.clusterGridTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        CLUSTER_TEX_WIDTH,
        gridHeight,
        gl.RGBA_INTEGER,
        gl.UNSIGNED_INT,
        this._grid,
      );
    }

    if (CLUSTER_INDEX_UNIT >= maxUnits) {
      if (!this._warnedIndexUnit) {
        this._warnedIndexUnit = true;
        console.warn(
          `[WebGLClusterCullPass] Exceeded MAX_TEXTURE_IMAGE_UNITS (${maxUnits}). Cannot bind cluster index texture to texture unit ${CLUSTER_INDEX_UNIT}.`,
        );
      }
    } else {
      gl.activeTexture(gl.TEXTURE0 + CLUSTER_INDEX_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, renderer.clusterIndexTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        CLUSTER_TEX_WIDTH,
        usedIndexHeight,
        gl.RG_INTEGER,
        gl.UNSIGNED_INT,
        this._indices,
      );
    }
  }
}

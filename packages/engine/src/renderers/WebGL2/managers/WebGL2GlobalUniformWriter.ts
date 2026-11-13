import type { WebGL2UniformBuffer } from "../WebGL2UniformBuffer.js";
import {
  WebGL2GlobalUniformLayout,
  WebGL2PointLightLayout,
  WebGL2SpotLightLayout,
  WebGL2AreaLightLayout,
} from "../../GlobalUniformLayout.js";
import { MAX_CLUSTERED_LIGHTS_PER_TYPE } from "../../../core/lights/index.js";
import type { LightDataInterface } from "../../../interfaces/index.js";
import type { ClusterGridDims, Vector3D } from "../../../math/index.js";

/**
 * Stages the clustered light culling grid metadata into the (not-yet-uploaded) global UBO --
 * see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md.
 */
export function writeWebGL2ClusterGridUniforms(
  ubo: WebGL2UniformBuffer,
  dims: ClusterGridDims,
  maxLightsPerCluster: number,
  tileSizePx: [number, number],
): void {
  const f = WebGL2GlobalUniformLayout.fields;
  ubo.setVec2(f.tileSizePx.offset, tileSizePx[0], tileSizePx[1]);
  ubo.setFloat(f.clusterDims.offset, dims.x);
  ubo.setFloat(f.clusterDims.offset + 4, dims.y);
  ubo.setFloat(f.clusterDims.offset + 8, dims.z);
  ubo.setFloat(f.clusterDims.offset + 12, maxLightsPerCluster);
}

/**
 * Packs frame-global camera, lighting, and tone-mapping uniforms into `ubo` and uploads them
 * to the GPU. Validates light-array capacities fail-fast before writing.
 */
export function writeWebGL2GlobalUBO(
  ubo: WebGL2UniformBuffer,
  vp: Float32Array,
  camPos: Vector3D,
  lights: LightDataInterface,
  outputGamma: number,
  exposure: number,
  forwardToneMapping: number,
  forwardToneMappingWhitePoint: number,
  near: number = 0.1,
  far: number = 1000,
): void {
  if (lights.pLights.length > MAX_CLUSTERED_LIGHTS_PER_TYPE) {
    throw new Error(
      `[WebGL2Renderer] Point light count exceeds limit of ${MAX_CLUSTERED_LIGHTS_PER_TYPE}: ${lights.pLights.length}`,
    );
  }
  if (lights.sLights.length > MAX_CLUSTERED_LIGHTS_PER_TYPE) {
    throw new Error(
      `[WebGL2Renderer] Spot light count exceeds limit of ${MAX_CLUSTERED_LIGHTS_PER_TYPE}: ${lights.sLights.length}`,
    );
  }
  if (lights.aLights.length > 42) {
    throw new Error(
      `[WebGL2Renderer] Area light count exceeds limit of 42: ${lights.aLights.length}`,
    );
  }

  const f = WebGL2GlobalUniformLayout.fields;
  ubo.setMatrix(f.vp.offset, vp);
  ubo.setVec3(f.viewPos.offset, camPos.x, camPos.y, camPos.z);

  ubo.setVec3(
    f.ambientColor.offset,
    lights.aCol.r * lights.aIntensity,
    lights.aCol.g * lights.aIntensity,
    lights.aCol.b * lights.aIntensity,
  );
  ubo.setVec3(
    f.dirLightColor.offset,
    lights.dCol.r * lights.dIntensity,
    lights.dCol.g * lights.dIntensity,
    lights.dCol.b * lights.dIntensity,
  );
  ubo.setVec3(f.dirLightDir.offset, lights.dDir.x, lights.dDir.y, lights.dDir.z);
  // WebGL2's raw UBO light array still has 16 slots (see docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md);
  // clamp explicitly now that the scene-wide cap is 64.
  ubo.setInt(f.numPointLights.offset, Math.min(lights.pLights.length, 16));
  ubo.setInt(f.numSpotLights.offset, Math.min(lights.sLights.length, 16));
  ubo.setInt(f.numAreaLights.offset, lights.aLights.length);
  ubo.setFloat(f.gamma.offset, outputGamma);
  ubo.setFloat(f.exposure.offset, exposure);
  ubo.setFloat(f.toneMappingMode.offset, forwardToneMapping);
  ubo.setFloat(f.toneMappingWhite.offset, forwardToneMappingWhitePoint);

  for (let i = 0; i < f.pointLights.count; i++) {
    const offset = f.pointLights.offset + i * f.pointLights.stride;
    if (i < lights.pLights.length) {
      const pl = lights.pLights[i]!;
      const matData = pl.worldMatrix.data;
      ubo.setVec3(offset + WebGL2PointLightLayout.pos, matData[12]!, matData[13]!, matData[14]!);
      ubo.setVec3(
        offset + WebGL2PointLightLayout.color,
        pl.linearColor.r * pl.intensity,
        pl.linearColor.g * pl.intensity,
        pl.linearColor.b * pl.intensity,
      );
      ubo.setFloat(offset + WebGL2PointLightLayout.distance, pl.distance);
      ubo.setFloat(offset + WebGL2PointLightLayout.decay, pl.decay);
    }
  }

  for (let i = 0; i < f.spotLights.count; i++) {
    const offset = f.spotLights.offset + i * f.spotLights.stride;
    if (i < lights.sLights.length) {
      const sl = lights.sLights[i]!;
      const slMat = sl.worldMatrix.data;
      const dir = sl.direction;
      const dirLen = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1.0;
      ubo.setVec3(offset + WebGL2SpotLightLayout.pos, slMat[12]!, slMat[13]!, slMat[14]!);
      ubo.setVec3(
        offset + WebGL2SpotLightLayout.dir,
        dir.x / dirLen,
        dir.y / dirLen,
        dir.z / dirLen,
      );
      ubo.setVec3(
        offset + WebGL2SpotLightLayout.color,
        sl.linearColor.r * sl.intensity,
        sl.linearColor.g * sl.intensity,
        sl.linearColor.b * sl.intensity,
      );
      ubo.setFloat(offset + WebGL2SpotLightLayout.angleCos, Math.cos(sl.angle));
      ubo.setFloat(
        offset + WebGL2SpotLightLayout.angleCosPenumbra,
        Math.cos(sl.angle * (1.0 - sl.penumbra)),
      );
      ubo.setFloat(offset + WebGL2SpotLightLayout.distance, sl.distance);
      ubo.setFloat(offset + WebGL2SpotLightLayout.decay, sl.decay);
    }
  }

  for (let i = 0; i < f.areaLights.count; i++) {
    const offset = f.areaLights.offset + i * f.areaLights.stride;
    if (i < lights.aLights.length) {
      const al = lights.aLights[i]!;
      const mat = al.worldMatrix.data;
      ubo.setVec3(offset + WebGL2AreaLightLayout.pos, mat[12]!, mat[13]!, mat[14]!);
      ubo.setVec3(
        offset + WebGL2AreaLightLayout.color,
        al.linearColor.r * al.intensity,
        al.linearColor.g * al.intensity,
        al.linearColor.b * al.intensity,
      );
      ubo.setVec3(offset + WebGL2AreaLightLayout.u, mat[0]!, mat[1]!, mat[2]!);
      ubo.setVec3(offset + WebGL2AreaLightLayout.v, mat[4]!, mat[5]!, mat[6]!);
      ubo.setVec3(offset + WebGL2AreaLightLayout.w, mat[8]!, mat[9]!, mat[10]!);
      ubo.setFloat(offset + WebGL2AreaLightLayout.widthHalf, al.width / 2.0);
      ubo.setFloat(offset + WebGL2AreaLightLayout.heightHalf, al.height / 2.0);
      ubo.setFloat(offset + WebGL2AreaLightLayout.distance, al.distance);
      ubo.setFloat(offset + WebGL2AreaLightLayout.decay, al.decay);
    }
  }

  ubo.setVec2(f.cameraNearFar.offset, near, far);
  ubo.update();
}

import type { Object3D } from "../../../core/index.js";
import type { Scene, RenderList } from "../../../core/Scene.js";
import { isInstancedMesh } from "../../../core/InstancedMesh.js";
import { MorphTargetBlender, type MorphBlendTarget } from "../../../core/animation/index.js";
import type { GeometryDataInterface, LightDataInterface } from "../../../interfaces/index.js";
import type { WebGLBufferManager } from "../../gl/managers/WebGLBufferManager.js";

/** Per-object morphed WebGL buffers returned to the render loop. */
export interface GLMorphOutputBuffers {
  vbo: WebGLBuffer;
  nbo: WebGLBuffer | undefined;
  tanbo: WebGLBuffer | undefined;
}

interface TFProgramEntry {
  prog: WebGLProgram;
  uDeltaTex: WebGLUniformLocation | null;
  uMetaTex: WebGLUniformLocation | null;
  uWeightsTex: WebGLUniformLocation | null;
  uDeltaTexWidth: WebGLUniformLocation | null;
  uWeightsTexWidth: WebGLUniformLocation | null;
  uTargetCount: WebGLUniformLocation | null;
}

interface StaticMorphGeoEntry {
  vertexCount: number;
  targetCount: number;
  hasNormals: boolean;
  hasTangents: boolean;
  deltaTex: WebGLTexture | undefined;
  deltaTexWidth: number;
  metaTex: WebGLTexture | undefined;
  refCount: number;
}

interface ObjectMorphEntry {
  geo: GeometryDataInterface;
  obj: Object3D;
  outPosVbo: WebGLBuffer;
  outNormVbo: WebGLBuffer | undefined;
  outTanVbo: WebGLBuffer | undefined;
  weightsTex: WebGLTexture | undefined;
  weightsTexWidth: number;
  weightsTexHeight: number;
  cachedWeights: Float32Array;
  stagingWeights: Float32Array;
  cpuOut: MorphBlendTarget | undefined;
  output: GLMorphOutputBuffers;
  hasComputedOnce: boolean;
}

const TF_FRAGMENT_SHADER = `#version 300 es
precision highp float;
void main() {}
`;

function buildTFVertexShader(hasNormals: boolean, hasTangents: boolean): string {
  return `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec3 a_basePos;
${hasNormals ? "layout(location = 1) in vec3 a_baseNorm;" : ""}
${hasTangents ? "layout(location = 2) in vec4 a_baseTan;" : ""}

uniform sampler2D u_deltaTex;
uniform highp isampler2D u_metaTex;
uniform sampler2D u_weightsTex;
uniform int u_deltaTexWidth;
uniform int u_weightsTexWidth;
uniform int u_targetCount;

out vec3 out_pos;
${hasNormals ? "out vec3 out_norm;" : ""}
${hasTangents ? "out vec4 out_tan;" : ""}

void main() {
  vec3 pos = a_basePos;
  ${hasNormals ? "vec3 norm = a_baseNorm;\n  bool touchedN = false;" : ""}
  ${hasTangents ? "vec4 tanVal = a_baseTan;\n  bool touchedT = false;" : ""}

  for (int t = 0; t < u_targetCount; t++) {
    float w = texelFetch(u_weightsTex, ivec2(t % u_weightsTexWidth, t / u_weightsTexWidth), 0).r;
    if (abs(w) <= 1e-6) continue;

    ivec4 meta = texelFetch(u_metaTex, ivec2(t, 0), 0);
    if (meta.x >= 0) {
      int idx = meta.x + gl_VertexID;
      pos += texelFetch(u_deltaTex, ivec2(idx % u_deltaTexWidth, idx / u_deltaTexWidth), 0).xyz * w;
    }
    ${
      hasNormals
        ? `if (meta.y >= 0) {
      int idx = meta.y + gl_VertexID;
      norm += texelFetch(u_deltaTex, ivec2(idx % u_deltaTexWidth, idx / u_deltaTexWidth), 0).xyz * w;
      touchedN = true;
    }`
        : ""
    }
    ${
      hasTangents
        ? `if (meta.z >= 0) {
      int idx = meta.z + gl_VertexID;
      tanVal.xyz += texelFetch(u_deltaTex, ivec2(idx % u_deltaTexWidth, idx / u_deltaTexWidth), 0).xyz * w;
      touchedT = true;
    }`
        : ""
    }
  }

  out_pos = pos;
  ${
    hasNormals
      ? `if (touchedN) {
    float lenSq = dot(norm, norm);
    if (lenSq > 1e-12) norm *= inversesqrt(lenSq);
  }
  out_norm = norm;`
      : ""
  }
  ${
    hasTangents
      ? `if (touchedT) {
    float lenSq = dot(tanVal.xyz, tanVal.xyz);
    if (lenSq > 1e-12) tanVal.xyz *= inversesqrt(lenSq);
  }
  out_tan = tanVal;`
      : ""
  }
}
`;
}

/**
 * WebGL2 pre-pass morph target manager (AN09).
 * Uses GPU Transform Feedback with `RGBA32F`/`RGBA32I` delta textures when vertex texture
 * fetches are supported (`MAX_VERTEX_TEXTURE_IMAGE_UNITS > 0`), and falls back transparently to
 * {@link MorphTargetBlender} + `gl.bufferSubData` on `DYNAMIC_DRAW` VBOs otherwise.
 */
export class WebGL2MorphTargetManager {
  private readonly _geoEntries = new Map<GeometryDataInterface, StaticMorphGeoEntry>();
  private readonly _objEntries = new Map<Object3D, ObjectMorphEntry>();
  private readonly _tfPrograms = new Map<number, TFProgramEntry>();
  private readonly _visitedThisFrame = new Set<Object3D>();
  private readonly _dirtyEntries: ObjectMorphEntry[] = [];

  private _useTransformFeedback: boolean | undefined = undefined;
  private _maxTexSize: number = 2048;

  private _ensureCapabilities(gl: WebGL2RenderingContext): void {
    if (this._useTransformFeedback !== undefined) return;
    const vertexTexUnits = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) as number;
    this._useTransformFeedback = vertexTexUnits > 0;
    this._maxTexSize = Math.max(256, (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) || 2048);
  }

  /**
   * Evaluates and updates dirty morphed objects before shadow and main passes run.
   */
  public prepareFrame(
    gl: WebGL2RenderingContext,
    geometryMgr: WebGLBufferManager,
    renderList: RenderList,
    scene: Scene,
    lights: LightDataInterface,
  ): void {
    this._ensureCapabilities(gl);
    this._visitedThisFrame.clear();
    let dirtyCount = 0;

    const batches = renderList.opaqueBatches;
    for (let i = 0; i < batches.length; i++) {
      const objs = batches[i]!.objects;
      for (let j = 0; j < objs.length; j++) {
        const entry = this._evaluateObject(gl, objs[j]!);
        if (entry) this._dirtyEntries[dirtyCount++] = entry;
      }
    }

    const transparent = renderList.transparent;
    for (let i = 0; i < transparent.length; i++) {
      const entry = this._evaluateObject(gl, transparent[i]!);
      if (entry) this._dirtyEntries[dirtyCount++] = entry;
    }

    let hasShadows = lights.dLight?.castShadow === true;
    if (!hasShadows) {
      for (let i = 0; i < lights.sLights.length; i++) {
        if (lights.sLights[i]!.castShadow) {
          hasShadows = true;
          break;
        }
      }
    }
    if (!hasShadows) {
      for (let i = 0; i < lights.pLights.length; i++) {
        if (lights.pLights[i]!.castShadow) {
          hasShadows = true;
          break;
        }
      }
    }
    if (hasShadows) {
      dirtyCount = this._collectShadowCasters(gl, scene.root, dirtyCount);
    }

    this._dirtyEntries.length = dirtyCount;
    if (dirtyCount === 0) return;

    if (this._useTransformFeedback) {
      this._runTransformFeedbackPass(gl, geometryMgr, dirtyCount);
    } else {
      this._runCpuFallbackPass(gl, dirtyCount);
    }
    this._dirtyEntries.length = 0;
  }

  private _collectShadowCasters(
    gl: WebGL2RenderingContext,
    node: Object3D,
    dirtyCount: number,
  ): number {
    if (!node.isVisible) return dirtyCount;
    if (node.castShadow && node.material && node.geometry?.morphTargets?.length) {
      const entry = this._evaluateObject(gl, node);
      if (entry) this._dirtyEntries[dirtyCount++] = entry;
    }
    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      dirtyCount = this._collectShadowCasters(gl, children[i]!, dirtyCount);
    }
    return dirtyCount;
  }

  /** Returns the morphed VBO overrides for `obj`, or `undefined` if in untouched bind pose. */
  public getMorphedBuffers(obj: Object3D): GLMorphOutputBuffers | undefined {
    const entry = this._objEntries.get(obj);
    if (!entry || !entry.hasComputedOnce) return undefined;
    if (entry.geo !== obj.geometry) return undefined;
    return entry.output;
  }

  /** Deletes per-object GL morph buffers/textures and drops shared static geo refcount. */
  public releaseObject(gl: WebGL2RenderingContext, obj: Object3D): void {
    const entry = this._objEntries.get(obj);
    if (!entry) return;
    this._objEntries.delete(obj);
    this._deleteObjectEntry(gl, entry);
    this._releaseStaticGeo(gl, entry.geo);
  }

  /** Drops dead GL handles without deleting after `webglcontextlost`/`webglcontextrestored`. */
  public resetOnContextRestored(): void {
    this._objEntries.clear();
    this._geoEntries.clear();
    this._tfPrograms.clear();
    this._visitedThisFrame.clear();
    this._dirtyEntries.length = 0;
    this._useTransformFeedback = undefined;
  }

  /** Deletes all GL buffers, textures, and Transform Feedback programs owned by this manager. */
  public destroy(gl: WebGL2RenderingContext): void {
    for (const entry of this._objEntries.values()) {
      this._deleteObjectEntry(gl, entry);
    }
    this._objEntries.clear();

    for (const geoEntry of this._geoEntries.values()) {
      if (geoEntry.deltaTex) gl.deleteTexture(geoEntry.deltaTex);
      if (geoEntry.metaTex) gl.deleteTexture(geoEntry.metaTex);
    }
    this._geoEntries.clear();

    for (const tf of this._tfPrograms.values()) {
      gl.deleteProgram(tf.prog);
    }
    this._tfPrograms.clear();
    this._visitedThisFrame.clear();
    this._dirtyEntries.length = 0;
    this._useTransformFeedback = undefined;
  }

  private _evaluateObject(gl: WebGL2RenderingContext, obj: Object3D): ObjectMorphEntry | undefined {
    if (this._visitedThisFrame.has(obj)) return undefined;
    this._visitedThisFrame.add(obj);

    const geo = obj.geometry;
    if (!geo || !geo.morphTargets || geo.morphTargets.length === 0 || isInstancedMesh(obj)) {
      if (this._objEntries.has(obj)) this.releaseObject(gl, obj);
      return undefined;
    }

    const vertexCount = Math.floor(geo.vertices.length / 3);
    if (vertexCount === 0) return undefined;

    const existing = this._objEntries.get(obj);
    const influences = obj.morphTargetInfluences;
    const hasActive = MorphTargetBlender.hasActiveWeights(influences);

    if (!existing && !hasActive) return undefined;

    let entry = existing;
    if (!entry || entry.geo !== geo) {
      if (entry) {
        this._deleteObjectEntry(gl, entry);
        this._releaseStaticGeo(gl, entry.geo);
        this._objEntries.delete(obj);
      }
      if (!hasActive) return undefined;
      entry = this._createObjectEntry(gl, obj, geo);
    }

    const staticGeo = this._geoEntries.get(geo)!;
    const targetCount = staticGeo.targetCount;
    if (
      entry.hasComputedOnce &&
      !MorphTargetBlender.weightsDiffer(influences, entry.cachedWeights, targetCount)
    ) {
      return undefined;
    }

    for (let t = 0; t < targetCount; t++) {
      const w = influences && t < influences.length ? influences[t]! : 0;
      entry.cachedWeights[t] = w;
      entry.stagingWeights[t] = w;
    }
    entry.hasComputedOnce = true;
    return entry;
  }

  private _runTransformFeedbackPass(
    gl: WebGL2RenderingContext,
    geometryMgr: WebGLBufferManager,
    count: number,
  ): void {
    gl.bindVertexArray(null);
    gl.enable(gl.RASTERIZER_DISCARD);

    let lastProg: WebGLProgram | undefined;

    for (let i = 0; i < count; i++) {
      const entry = this._dirtyEntries[i]!;
      const staticGeo = this._geoEntries.get(entry.geo)!;
      if (staticGeo.vertexCount === 0) continue;

      const mesh = geometryMgr.getOrCreateMesh(entry.obj, entry.geo);
      const tf = this._getOrCreateTFProgram(gl, staticGeo.hasNormals, staticGeo.hasTangents);
      if (tf.prog !== lastProg) {
        gl.useProgram(tf.prog);
        lastProg = tf.prog;
      }

      // Upload latest morph weights for this object into its R32F weights texture.
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, entry.weightsTex ?? null);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        entry.weightsTexWidth,
        entry.weightsTexHeight,
        gl.RED,
        gl.FLOAT,
        entry.stagingWeights,
      );

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, staticGeo.deltaTex ?? null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, staticGeo.metaTex ?? null);

      if (tf.uDeltaTex) gl.uniform1i(tf.uDeltaTex, 0);
      if (tf.uMetaTex) gl.uniform1i(tf.uMetaTex, 1);
      if (tf.uWeightsTex) gl.uniform1i(tf.uWeightsTex, 2);
      if (tf.uDeltaTexWidth) gl.uniform1i(tf.uDeltaTexWidth, staticGeo.deltaTexWidth);
      if (tf.uWeightsTexWidth) gl.uniform1i(tf.uWeightsTexWidth, entry.weightsTexWidth);
      if (tf.uTargetCount) gl.uniform1i(tf.uTargetCount, staticGeo.targetCount);

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo ?? null);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

      if (staticGeo.hasNormals && mesh.nbo) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nbo);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(1);
      }

      if (staticGeo.hasTangents && mesh.tanbo) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.tanbo);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(2);
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, entry.outPosVbo);
      if (staticGeo.hasNormals && entry.outNormVbo) {
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, entry.outNormVbo);
      }
      if (staticGeo.hasTangents && entry.outTanVbo) {
        gl.bindBufferBase(
          gl.TRANSFORM_FEEDBACK_BUFFER,
          staticGeo.hasNormals ? 2 : 1,
          entry.outTanVbo,
        );
      }

      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, staticGeo.vertexCount);
      gl.endTransformFeedback();

      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
      if (staticGeo.hasNormals) gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, null);
      if (staticGeo.hasTangents) {
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, staticGeo.hasNormals ? 2 : 1, null);
      }
    }

    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
    gl.disableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disable(gl.RASTERIZER_DISCARD);
  }

  private _runCpuFallbackPass(gl: WebGL2RenderingContext, count: number): void {
    for (let i = 0; i < count; i++) {
      const entry = this._dirtyEntries[i]!;
      const out = entry.cpuOut!;
      MorphTargetBlender.blend(entry.geo, entry.cachedWeights, out);

      gl.bindBuffer(gl.ARRAY_BUFFER, entry.outPosVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, out.positions);

      if (entry.outNormVbo && out.normals) {
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.outNormVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, out.normals);
      }
      if (entry.outTanVbo && out.tangents) {
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.outTanVbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, out.tangents);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  private _getOrCreateStaticGeo(
    gl: WebGL2RenderingContext,
    geo: GeometryDataInterface,
  ): StaticMorphGeoEntry {
    let staticGeo = this._geoEntries.get(geo);
    if (staticGeo) {
      staticGeo.refCount++;
      return staticGeo;
    }

    const vertexCount = Math.floor(geo.vertices.length / 3);
    const targets = geo.morphTargets!;
    const targetCount = targets.length;
    const hasNormals = (geo.normals?.length ?? 0) >= vertexCount * 3;
    const hasTangents = (geo.tangents?.length ?? 0) >= vertexCount * 4;

    if (!this._useTransformFeedback) {
      staticGeo = {
        vertexCount,
        targetCount,
        hasNormals,
        hasTangents,
        deltaTex: undefined,
        deltaTexWidth: 1,
        metaTex: undefined,
        refCount: 1,
      };
      this._geoEntries.set(geo, staticGeo);
      return staticGeo;
    }

    let totalSlices = 0;
    for (let t = 0; t < targetCount; t++) {
      const trg = targets[t]!;
      if (trg.positions && trg.positions.length > 0) totalSlices++;
      if (hasNormals && trg.normals && trg.normals.length > 0) totalSlices++;
      if (hasTangents && trg.tangents && trg.tangents.length > 0) totalSlices++;
    }

    const totalTexels = Math.max(1, totalSlices * vertexCount);
    const deltaTexWidth = Math.min(this._maxTexSize, totalTexels);
    const deltaTexHeight = Math.max(1, Math.ceil(totalTexels / deltaTexWidth));
    const deltaData = new Float32Array(deltaTexWidth * deltaTexHeight * 4);
    const metaData = new Int32Array(Math.max(1, targetCount) * 4);
    let texelCursor = 0;

    for (let t = 0; t < targetCount; t++) {
      const trg = targets[t]!;
      const m4 = t * 4;

      if (trg.positions && trg.positions.length > 0) {
        metaData[m4] = texelCursor;
        const limit = Math.min(vertexCount, Math.floor(trg.positions.length / 3));
        for (let v = 0; v < limit; v++) {
          const dst = (texelCursor + v) * 4;
          const src = v * 3;
          deltaData[dst] = trg.positions[src]!;
          deltaData[dst + 1] = trg.positions[src + 1]!;
          deltaData[dst + 2] = trg.positions[src + 2]!;
        }
        texelCursor += vertexCount;
      } else {
        metaData[m4] = -1;
      }

      if (hasNormals && trg.normals && trg.normals.length > 0) {
        metaData[m4 + 1] = texelCursor;
        const limit = Math.min(vertexCount, Math.floor(trg.normals.length / 3));
        for (let v = 0; v < limit; v++) {
          const dst = (texelCursor + v) * 4;
          const src = v * 3;
          deltaData[dst] = trg.normals[src]!;
          deltaData[dst + 1] = trg.normals[src + 1]!;
          deltaData[dst + 2] = trg.normals[src + 2]!;
        }
        texelCursor += vertexCount;
      } else {
        metaData[m4 + 1] = -1;
      }

      if (hasTangents && trg.tangents && trg.tangents.length > 0) {
        metaData[m4 + 2] = texelCursor;
        const limit = Math.min(vertexCount, Math.floor(trg.tangents.length / 3));
        for (let v = 0; v < limit; v++) {
          const dst = (texelCursor + v) * 4;
          const src = v * 3;
          deltaData[dst] = trg.tangents[src]!;
          deltaData[dst + 1] = trg.tangents[src + 1]!;
          deltaData[dst + 2] = trg.tangents[src + 2]!;
        }
        texelCursor += vertexCount;
      } else {
        metaData[m4 + 2] = -1;
      }

      metaData[m4 + 3] = 0;
    }

    const deltaTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, deltaTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      deltaTexWidth,
      deltaTexHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      deltaData,
    );

    const metaTexWidth = Math.max(1, targetCount);
    const metaTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, metaTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32I,
      metaTexWidth,
      1,
      0,
      gl.RGBA_INTEGER,
      gl.INT,
      metaData,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);

    staticGeo = {
      vertexCount,
      targetCount,
      hasNormals,
      hasTangents,
      deltaTex,
      deltaTexWidth,
      metaTex,
      refCount: 1,
    };
    this._geoEntries.set(geo, staticGeo);
    return staticGeo;
  }

  private _releaseStaticGeo(gl: WebGL2RenderingContext, geo: GeometryDataInterface): void {
    const staticGeo = this._geoEntries.get(geo);
    if (!staticGeo) return;
    staticGeo.refCount--;
    if (staticGeo.refCount <= 0) {
      if (staticGeo.deltaTex) gl.deleteTexture(staticGeo.deltaTex);
      if (staticGeo.metaTex) gl.deleteTexture(staticGeo.metaTex);
      this._geoEntries.delete(geo);
    }
  }

  private _createObjectEntry(
    gl: WebGL2RenderingContext,
    obj: Object3D,
    geo: GeometryDataInterface,
  ): ObjectMorphEntry {
    const staticGeo = this._getOrCreateStaticGeo(gl, geo);
    const vCount = staticGeo.vertexCount;
    const usage = this._useTransformFeedback ? gl.DYNAMIC_COPY : gl.DYNAMIC_DRAW;

    const outPosVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, outPosVbo);
    gl.bufferData(gl.ARRAY_BUFFER, vCount * 12, usage);

    let outNormVbo: WebGLBuffer | undefined;
    if (staticGeo.hasNormals) {
      outNormVbo = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, outNormVbo);
      gl.bufferData(gl.ARRAY_BUFFER, vCount * 12, usage);
    }

    let outTanVbo: WebGLBuffer | undefined;
    if (staticGeo.hasTangents) {
      outTanVbo = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, outTanVbo);
      gl.bufferData(gl.ARRAY_BUFFER, vCount * 16, usage);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    let weightsTex: WebGLTexture | undefined;
    const weightsTexWidth = Math.min(this._maxTexSize, Math.max(1, staticGeo.targetCount));
    const weightsTexHeight = Math.max(1, Math.ceil(staticGeo.targetCount / weightsTexWidth));
    const stagingWeights = new Float32Array(weightsTexWidth * weightsTexHeight);

    if (this._useTransformFeedback) {
      weightsTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, weightsTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32F,
        weightsTexWidth,
        weightsTexHeight,
        0,
        gl.RED,
        gl.FLOAT,
        stagingWeights,
      );
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    const cpuOut: MorphBlendTarget | undefined = this._useTransformFeedback
      ? undefined
      : {
          positions: new Float32Array(vCount * 3),
          normals: staticGeo.hasNormals ? new Float32Array(vCount * 3) : undefined,
          tangents: staticGeo.hasTangents ? new Float32Array(vCount * 4) : undefined,
        };

    const cachedWeights = new Float32Array(staticGeo.targetCount);
    cachedWeights.fill(NaN);

    const entry: ObjectMorphEntry = {
      geo,
      obj,
      outPosVbo,
      outNormVbo,
      outTanVbo,
      weightsTex,
      weightsTexWidth,
      weightsTexHeight,
      cachedWeights,
      stagingWeights,
      cpuOut,
      output: { vbo: outPosVbo, nbo: outNormVbo, tanbo: outTanVbo },
      hasComputedOnce: false,
    };
    this._objEntries.set(obj, entry);
    return entry;
  }

  private _deleteObjectEntry(gl: WebGL2RenderingContext, entry: ObjectMorphEntry): void {
    gl.deleteBuffer(entry.outPosVbo);
    if (entry.outNormVbo) gl.deleteBuffer(entry.outNormVbo);
    if (entry.outTanVbo) gl.deleteBuffer(entry.outTanVbo);
    if (entry.weightsTex) gl.deleteTexture(entry.weightsTex);
  }

  private _getOrCreateTFProgram(
    gl: WebGL2RenderingContext,
    hasNormals: boolean,
    hasTangents: boolean,
  ): TFProgramEntry {
    const key = (hasNormals ? 1 : 0) | (hasTangents ? 2 : 0);
    let entry = this._tfPrograms.get(key);
    if (entry) return entry;

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, buildTFVertexShader(hasNormals, hasTangents));
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, TF_FRAGMENT_SHADER);
    gl.compileShader(fs);

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);

    const varyings: string[] = ["out_pos"];
    if (hasNormals) varyings.push("out_norm");
    if (hasTangents) varyings.push("out_tan");
    gl.transformFeedbackVaryings(prog, varyings, gl.SEPARATE_ATTRIBS);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) || "unknown error";
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(prog);
      throw new Error(`[WebGL2MorphTargetManager] TF link error: ${log}`);
    }

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    entry = {
      prog,
      uDeltaTex: gl.getUniformLocation(prog, "u_deltaTex"),
      uMetaTex: gl.getUniformLocation(prog, "u_metaTex"),
      uWeightsTex: gl.getUniformLocation(prog, "u_weightsTex"),
      uDeltaTexWidth: gl.getUniformLocation(prog, "u_deltaTexWidth"),
      uWeightsTexWidth: gl.getUniformLocation(prog, "u_weightsTexWidth"),
      uTargetCount: gl.getUniformLocation(prog, "u_targetCount"),
    };
    this._tfPrograms.set(key, entry);
    return entry;
  }
}

import { AbstractLoader } from "./AbstractLoader.js";
import { EventType } from "../enums/index.js";
import { Object3D } from "../core/index.js";
import type { Skeleton, AnimationClip } from "../core/animation/index.js";
import { Bone, SkinnedMesh } from "../core/animation/index.js";
import { StandardMaterial } from "../core/materials/index.js";
import type { GltfLoaderOptions } from "../interfaces/index.js";
import { Matrix4, Vector3D, Quaternion } from "../math/index.js";

import type { GltfJson, GltfData } from "./gltf/index.js";
import {
  GltfBinaryParser,
  GltfMaterialParser,
  GltfAnimationParser,
  GltfGeometryParser,
  GltfSkinParser,
  GltfVariants,
} from "./gltf/index.js";
import { getGltfExtensions } from "./gltf/GltfExtensionRegistry.js";
import type { GltfReadContext } from "./gltf/GltfExtensionPlugin.js";
// Side-effect import: registers the built-in extension plugins (KHR_lights_punctual,
// SWM_prefab_instance, SWM_stage_zone) -- see ADR 0017.
import "./gltf/extensions/index.js";

/**
 * Loader for glTF 2.0 assets (.gltf and .glb).
 */
export class GltfLoader extends AbstractLoader<Object3D> {
  protected _gltfOptions: GltfLoaderOptions;

  constructor(options: GltfLoaderOptions = {}) {
    super(options);
    this._gltfOptions = options;
  }

  public override async load(url: string): Promise<Object3D> {
    const fullUrl: string = this.basePath + url;
    this.dispatchEvent(EventType.LOADER_START, { url: fullUrl });

    try {
      const isBinary = url.toLowerCase().endsWith(".glb");
      let gltf: GltfData;

      if (isBinary) {
        gltf = await this._loadBinary(fullUrl);
      } else {
        gltf = await this._loadJson(fullUrl);
      }

      const rootObject: Object3D = await this._parse(gltf, fullUrl);

      this.dispatchEvent(EventType.LOADER_END, { url: fullUrl, data: rootObject });
      return rootObject;
    } catch (error: unknown) {
      this.dispatchEvent(EventType.LOADER_ERROR, { url: fullUrl, error });
      throw error;
    }
  }

  private async _loadJson(url: string): Promise<GltfData> {
    const json = (await this._assetManager.loadJson(url)) as GltfJson;
    const folderPath = GltfLoader.getFolderPath(url);

    const bufferPromises = (json.buffers || []).map((buf) => {
      if (buf.uri?.startsWith("data:")) {
        return GltfBinaryParser.decodeBase64(buf.uri);
      }
      return this._assetManager.loadBinary(folderPath + (buf.uri || ""));
    });

    const buffers = await Promise.all(bufferPromises);
    return { json, buffers };
  }

  private async _loadBinary(url: string): Promise<GltfData> {
    const arrayBuffer = await this._assetManager.loadBinary(url);
    return GltfBinaryParser.parseGlb(arrayBuffer);
  }

  /** Decodes a `data:...;base64,...` URI into raw bytes -- public/static so callers that parse a
   * glTF JSON document themselves (`ProjectBinding`, rather than `load()`/`_loadJson()`) can
   * decode its embedded buffers before handing the document to `_parse()`. */
  public static decodeDataUri(uri: string): ArrayBuffer {
    return GltfBinaryParser.decodeBase64(uri);
  }

  /**
   * Loads standalone animation clips from a .glb or .gltf file.
   */
  public async loadAnimations(url: string): Promise<AnimationClip[]> {
    const fullUrl: string = this.basePath + url;
    const isBinary = url.toLowerCase().endsWith(".glb");
    const gltf = isBinary ? await this._loadBinary(fullUrl) : await this._loadJson(fullUrl);
    const root = await this._parse(gltf, fullUrl);
    return root.animations;
  }

  /**
   * Parses a glTF data structure into an Object3D hierarchy.
   * @param gltf The loaded glTF JSON and binary buffers.
   * @param baseUrl Base URL for resolving external resources.
   * @returns The root Object3D.
   */
  public async parse(gltf: GltfData, baseUrl: string = ""): Promise<Object3D> {
    return this._parse(gltf, baseUrl);
  }

  private async _parse(gltf: GltfData, baseUrl: string): Promise<Object3D> {
    const { json, buffers } = gltf;
    const folderPath = GltfLoader.getFolderPath(baseUrl);

    // Validate glTF version
    if (json.asset?.version !== undefined) {
      const versionStr = String(json.asset.version);
      if (!versionStr.startsWith("2.")) {
        throw new Error(
          `[GltfLoader] Unsupported glTF version "${versionStr}". Only glTF 2.x is supported.`,
        );
      }
    }

    // Fail-fast on unsupported required extensions
    if (json.extensionsRequired && json.extensionsRequired.length > 0) {
      const supportedExtensions = new Set<string>([
        ...getGltfExtensions().map((p) => p.name),
        "KHR_materials_variants",
        "KHR_materials_emissive_strength",
        "KHR_materials_clearcoat",
        "KHR_materials_sheen",
        "KHR_materials_transmission",
        "KHR_materials_volume",
        "KHR_materials_ior",
        // Int8/Int16 (optionally normalized) attributes: GltfBinaryParser reads them and the
        // geometry parser widens them to Float32; the dequantization lives in the node transform.
        "KHR_mesh_quantization",
      ]);

      const unsupported = json.extensionsRequired.filter((ext) => !supportedExtensions.has(ext));
      if (unsupported.length > 0) {
        throw new Error(
          `[GltfLoader] Unsupported required extension(s): ${unsupported.join(", ")}. Supported extensions: ${Array.from(supportedExtensions).join(", ")}`,
        );
      }
    }

    if (json.asset?.version === undefined) {
      console.warn("[GltfLoader] Missing required `asset.version`; assuming glTF 2.0.");
    }

    // 0. Initialize read context and let registered extension plugins pre-pass the document
    // (e.g. indexing KHR_lights_punctual.lights[] by node) -- see ADR 0017.
    const readCtx: GltfReadContext = { json, state: new Map() };
    for (const plugin of getGltfExtensions()) plugin.prepareRead?.(readCtx);

    // 1. Parse Materials
    const materials = await Promise.all(
      (json.materials || []).map((m) =>
        GltfMaterialParser.parseMaterial(
          m,
          json,
          folderPath,
          buffers,
          this._assetManager,
          this._gltfOptions,
          readCtx,
        ),
      ),
    );

    // 2. Identify all joint nodes in skins
    const jointNodeIndices = new Set<number>();
    if (json.skins) {
      for (const skin of json.skins) {
        for (const jointIdx of skin.joints) {
          jointNodeIndices.add(jointIdx);
        }
      }
    }

    // 3. Create node objects (Bone if joint, otherwise whatever the first matching extension
    // plugin decides -- e.g. PointLight for KHR_lights_punctual, StageZoneMarker for
    // SWM_stage_zone -- falling back to a plain Object3D)
    const nodeObjects: Object3D[] = [];
    if (json.nodes) {
      for (let i = 0; i < json.nodes.length; i++) {
        const nodeDef = json.nodes[i];
        if (!nodeDef) continue;
        const rawName = nodeDef.name || `Node_${i}`;
        let name = rawName;
        if (this._gltfOptions.normalizeMixamoRig) {
          name = name.replace(/^mixamorig\d*:/, "mixamorig:");
        }
        if (this._gltfOptions.nodeNameTransform) {
          name = this._gltfOptions.nodeNameTransform(name);
        }
        let obj: Object3D | undefined;
        if (jointNodeIndices.has(i)) {
          obj = new Bone(name);
        } else {
          for (const plugin of getGltfExtensions()) {
            obj = plugin.readNode?.(i, nodeDef, name, readCtx);
            if (obj) break;
          }
        }
        obj ??= new Object3D(name);
        this._applyNodeTransforms(obj, nodeDef);
        for (const plugin of getGltfExtensions()) plugin.applyNode?.(obj, nodeDef, readCtx);
        this._gltfOptions.onNodeParsed?.(obj, nodeDef as unknown as Record<string, unknown>);
        nodeObjects[i] = obj;
      }
    }

    // 4. Parse Skeletons
    const skeletons: Skeleton[] = GltfSkinParser.parseSkeletons(json, buffers, nodeObjects);

    // 5. Build Hierarchy and attach Meshes
    if (json.nodes) {
      for (let i = 0; i < json.nodes.length; i++) {
        const nodeDef = json.nodes[i];
        const obj = nodeObjects[i];
        if (!nodeDef || !obj) continue;

        // Attach child nodes
        if (nodeDef.children) {
          for (const childIdx of nodeDef.children) {
            const childObj = nodeObjects[childIdx];
            if (childObj) {
              obj.add(childObj);
            }
          }
        }

        // Attach meshes
        if (nodeDef.mesh !== undefined && json.meshes && json.meshes[nodeDef.mesh]) {
          const meshDef = json.meshes[nodeDef.mesh];
          if (meshDef) {
            for (const primitive of meshDef.primitives) {
              const geo = await GltfGeometryParser.parseGeometry(primitive, json, buffers, readCtx);
              if (geo) {
                const isSkinned =
                  nodeDef.skin !== undefined && skeletons[nodeDef.skin] !== undefined;
                const meshObj = isSkinned
                  ? new SkinnedMesh(nodeDef.name ? `${nodeDef.name}_mesh` : "SkinnedMesh")
                  : new Object3D(nodeDef.name ? `${nodeDef.name}_mesh` : "MeshInstance");

                meshObj.geometry = geo;
                meshObj.material =
                  primitive.material !== undefined && materials[primitive.material]
                    ? materials[primitive.material]!
                    : new StandardMaterial();

                const varExt = primitive.extensions?.KHR_materials_variants;
                if (varExt && varExt.mappings) {
                  const variantMap: Record<number, typeof meshObj.material> = {};
                  for (const mapping of varExt.mappings) {
                    const vMat = materials[mapping.material];
                    if (vMat) {
                      for (const vIdx of mapping.variants) {
                        variantMap[vIdx] = vMat;
                      }
                    }
                  }
                  meshObj.userData["gltfMaterialVariants"] = variantMap;
                  meshObj.userData["gltfDefaultMaterial"] = meshObj.material;
                }

                if (isSkinned) {
                  (meshObj as SkinnedMesh).bind(skeletons[nodeDef.skin!]!);
                }
                obj.add(meshObj);
              }
            }
          }
        }
      }
    }

    // 6. Create Scene Root
    const root = new Object3D("glTF_Root");
    const variantsDef = json.extensions?.KHR_materials_variants?.variants;
    if (variantsDef && variantsDef.length > 0) {
      root.userData["gltfVariants"] = variantsDef.map((v) => v.name);
    }

    const sceneIdx = json.scene ?? 0;
    const scene = json.scenes ? json.scenes[sceneIdx] : null;

    if (scene && scene.nodes) {
      for (const nodeIdx of scene.nodes) {
        const nodeObj = nodeObjects[nodeIdx];
        if (nodeObj) {
          root.add(nodeObj);
        }
      }
    } else if (json.nodes) {
      for (const obj of nodeObjects) {
        if (obj && !obj.parent) {
          root.add(obj);
        }
      }
    }

    // 7. Parse Animations
    if (json.animations && json.accessors) {
      root.animations = GltfAnimationParser.parseAnimations(json, buffers, nodeObjects);
    }

    if (this._gltfOptions.variant !== undefined) {
      GltfVariants.selectVariant(root, this._gltfOptions.variant);
    }

    this._gltfOptions.onParsed?.(root);

    return root;
  }

  private _applyNodeTransforms(obj: Object3D, node: NonNullable<GltfJson["nodes"]>[number]): void {
    if (node.matrix) {
      const mat = new Matrix4();
      mat.data.set(node.matrix);
      const pos = new Vector3D();
      const rot = new Vector3D();
      const sca = new Vector3D(1, 1, 1);
      mat.decompose(pos, rot, sca);
      obj.position.copyFrom(pos);
      // Exact orientation: derive the quaternion from the rotation matrix and let
      // `updateMatrixWorld`'s quaternion compose path use it, consistent with the TRS/animation
      // path. `obj.rotation` (Euler) is kept for inspector display only. This removes the lossy
      // Euler round-trip (gimbal branch in Matrix4.decompose) for matrix-authored nodes.
      obj.quaternion = (obj.quaternion || new Quaternion()).setFromRotationMatrix(mat);
      obj.rotation.copyFrom(rot);
      obj.scale.copyFrom(sca);
    } else {
      if (node.translation) {
        obj.position.set(node.translation[0]!, node.translation[1]!, node.translation[2]!);
      }
      if (node.scale) {
        obj.scale.set(node.scale[0]!, node.scale[1]!, node.scale[2]!);
      }
      if (node.rotation) {
        const q = node.rotation;
        obj.quaternion = (obj.quaternion || new Quaternion()).set(q[0]!, q[1]!, q[2]!, q[3]!);
      }
    }
  }

  protected async _parseMaterial(
    m: NonNullable<GltfJson["materials"]>[number],
    json: GltfJson,
    folderPath: string,
    buffers: ArrayBuffer[],
  ): Promise<StandardMaterial> {
    return GltfMaterialParser.parseMaterial(
      m,
      json,
      folderPath,
      buffers,
      this._assetManager,
      this._gltfOptions,
    );
  }
}

import type { GltfJson } from "./types.js";
import { StandardMaterial } from "../../core/materials/index.js";
import { Color } from "../../core/colors/index.js";
import { Texture } from "../../core/textures/index.js";
import type { AssetManager } from "../AssetManager.js";
import { CullMode } from "../../enums/index.js";
import type { GltfLoaderOptions } from "../../interfaces/index.js";
import { getGltfExtensions } from "./GltfExtensionRegistry.js";
import type { GltfReadContext } from "./GltfExtensionPlugin.js";

/**
 * Parser for glTF PBR materials and textures.
 */
export class GltfMaterialParser {
  /**
   * Applies a clampMetallic/clampRoughness constraint to a PBR factor.
   */
  public static applyClamp(value: number, clamp: number | [number, number] | undefined): number {
    if (undefined === clamp) return value;
    if (Array.isArray(clamp)) return Math.min(Math.max(value, clamp[0]), clamp[1]);
    return Math.min(value, clamp);
  }

  /**
   * Resolves a glTF material definition into a Small World Machine StandardMaterial.
   */
  public static async parseMaterial(
    m: NonNullable<GltfJson["materials"]>[number],
    json: GltfJson,
    folderPath: string,
    buffers: ArrayBuffer[],
    assetManager: AssetManager,
    options: GltfLoaderOptions = {},
    ctx?: GltfReadContext,
  ): Promise<StandardMaterial> {
    const mat = new StandardMaterial();
    const pbr = m.pbrMetallicRoughness || {};
    const readCtx: GltfReadContext = ctx ?? { json, state: new Map() };

    if (pbr.baseColorFactor) {
      mat.color = new Color(
        pbr.baseColorFactor[0]!,
        pbr.baseColorFactor[1]!,
        pbr.baseColorFactor[2]!,
        pbr.baseColorFactor[3]!,
      );
    }

    if (pbr.baseColorTexture) {
      const tex = await this.resolveTexture(
        pbr.baseColorTexture.index,
        json,
        folderPath,
        buffers,
        assetManager,
        readCtx,
      );
      if (tex) mat.diffuseMap = tex;
    }

    if (pbr.metallicRoughnessTexture) {
      const tex = await this.resolveTexture(
        pbr.metallicRoughnessTexture.index,
        json,
        folderPath,
        buffers,
        assetManager,
        readCtx,
      );
      if (tex) {
        mat.metallicMap = tex;
        mat.roughnessMap = tex;
      }
    }

    if (m.normalTexture) {
      const tex = await this.resolveTexture(
        m.normalTexture.index,
        json,
        folderPath,
        buffers,
        assetManager,
        readCtx,
      );
      if (tex) mat.normalMap = tex;
    }

    if (m.occlusionTexture) {
      const tex = await this.resolveTexture(
        m.occlusionTexture.index,
        json,
        folderPath,
        buffers,
        assetManager,
        readCtx,
      );
      if (tex) {
        mat.aoMap = tex;
        if (m.occlusionTexture.strength !== undefined) {
          mat.ao = m.occlusionTexture.strength;
        }
      }
    }

    if (m.emissiveTexture) {
      const tex = await this.resolveTexture(
        m.emissiveTexture.index,
        json,
        folderPath,
        buffers,
        assetManager,
        readCtx,
      );
      if (tex) mat.emissiveMap = tex;
    }

    if (m.emissiveFactor) {
      mat.emissiveColor = new Color(
        m.emissiveFactor[0]!,
        m.emissiveFactor[1]!,
        m.emissiveFactor[2]!,
        1.0,
      );
    }

    if (m.extensions?.KHR_materials_emissive_strength?.emissiveStrength !== undefined) {
      mat.emissiveIntensity = m.extensions.KHR_materials_emissive_strength.emissiveStrength;
    }

    if (m.extensions?.KHR_materials_clearcoat) {
      const cc = m.extensions.KHR_materials_clearcoat;
      if (cc.clearcoatFactor !== undefined) mat.clearcoat = cc.clearcoatFactor;
      if (cc.clearcoatRoughnessFactor !== undefined)
        mat.clearcoatRoughness = cc.clearcoatRoughnessFactor;
      if (cc.clearcoatTexture) {
        const tex = await this.resolveTexture(
          cc.clearcoatTexture.index,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
        );
        if (tex) mat.clearcoatMap = tex;
      }
      if (cc.clearcoatRoughnessTexture) {
        const tex = await this.resolveTexture(
          cc.clearcoatRoughnessTexture.index,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
        );
        if (tex) mat.clearcoatRoughnessMap = tex;
      }
      if (cc.clearcoatNormalTexture) {
        const tex = await this.resolveTexture(
          cc.clearcoatNormalTexture.index,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
        );
        if (tex) mat.clearcoatNormalMap = tex;
      }
    }

    if (m.extensions?.KHR_materials_sheen) {
      const sheen = m.extensions.KHR_materials_sheen;
      if (sheen.sheenColorFactor) {
        mat.sheenColor = new Color(
          sheen.sheenColorFactor[0]!,
          sheen.sheenColorFactor[1]!,
          sheen.sheenColorFactor[2]!,
          1.0,
        );
      }
      if (sheen.sheenRoughnessFactor !== undefined) mat.sheenRoughness = sheen.sheenRoughnessFactor;
      if (sheen.sheenColorTexture) {
        const tex = await this.resolveTexture(
          sheen.sheenColorTexture.index,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
        );
        if (tex) mat.sheenColorMap = tex;
      }
      if (sheen.sheenRoughnessTexture) {
        const tex = await this.resolveTexture(
          sheen.sheenRoughnessTexture.index,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
        );
        if (tex) mat.sheenRoughnessMap = tex;
      }
    }

    if (m.extensions?.KHR_materials_transmission) {
      const trans = m.extensions.KHR_materials_transmission;
      if (trans.transmissionFactor !== undefined) mat.transmission = trans.transmissionFactor;
      if (trans.transmissionTexture) {
        const tex = await this.resolveTexture(
          trans.transmissionTexture.index,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
        );
        if (tex) mat.transmissionMap = tex;
      }
    }

    if (m.extensions?.KHR_materials_volume) {
      const vol = m.extensions.KHR_materials_volume;
      if (vol.thicknessFactor !== undefined) mat.thickness = vol.thicknessFactor;
      if (vol.thicknessTexture) {
        const tex = await this.resolveTexture(
          vol.thicknessTexture.index,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
        );
        if (tex) mat.thicknessMap = tex;
      }
      if (vol.attenuationDistance !== undefined) mat.attenuationDistance = vol.attenuationDistance;
      if (vol.attenuationColor) {
        mat.attenuationColor = new Color(
          vol.attenuationColor[0]!,
          vol.attenuationColor[1]!,
          vol.attenuationColor[2]!,
          1.0,
        );
      }
    }

    if (m.extensions?.KHR_materials_ior?.ior !== undefined) {
      mat.ior = m.extensions.KHR_materials_ior.ior;
    }

    const defaultMetallic = options.defaultMetallic !== undefined ? options.defaultMetallic : 1.0;
    const defaultRoughness =
      options.defaultRoughness !== undefined ? options.defaultRoughness : 1.0;

    let metallic = pbr.metallicFactor !== undefined ? pbr.metallicFactor : defaultMetallic;
    let roughness = pbr.roughnessFactor !== undefined ? pbr.roughnessFactor : defaultRoughness;

    metallic = this.applyClamp(metallic, options.clampMetallic);
    roughness = this.applyClamp(roughness, options.clampRoughness);

    mat.metallic = metallic;
    mat.roughness = roughness;

    if (m.alphaMode === "BLEND") {
      mat.transparent = true;
    } else if (m.alphaMode === "MASK") {
      mat.transparent = true;
      mat.alphaTest = m.alphaCutoff !== undefined ? m.alphaCutoff : 0.5;
    }

    if (m.doubleSided) {
      mat.cullMode = CullMode.NONE;
    }

    options.onMaterialParsed?.(mat, m as unknown as Record<string, unknown>);

    return mat;
  }

  /**
   * Resolves a texture index to a Small World Machine Texture instance.
   */
  public static async resolveTexture(
    texIdx: number,
    json: GltfJson,
    folderPath: string,
    buffers: ArrayBuffer[],
    assetManager: AssetManager,
    ctx?: GltfReadContext,
  ): Promise<Texture | null> {
    if (!json.textures) return null;
    const textureDef = json.textures[texIdx];
    if (!textureDef) return null;

    const readCtx: GltfReadContext = ctx ?? { json, state: new Map() };

    // 1. Check if any registered extension resolves this texture (e.g. KHR_texture_basisu)
    for (const plugin of getGltfExtensions()) {
      if (plugin.resolveTexture) {
        const tex = await plugin.resolveTexture(
          textureDef,
          readCtx,
          folderPath,
          buffers,
          assetManager,
        );
        if (tex) return tex;
      }
    }

    // 2. Standard image resolution fallback
    if (textureDef.source === undefined || !json.images) return null;

    const imageDef = json.images[textureDef.source];
    if (!imageDef) return null;

    let url = "";
    let objectUrl = false;

    if (imageDef.uri) {
      if (imageDef.uri.startsWith("data:")) {
        url = imageDef.uri;
      } else {
        url = folderPath + imageDef.uri;
      }
    } else if (imageDef.bufferView !== undefined && json.bufferViews) {
      const bv = json.bufferViews[imageDef.bufferView];
      if (bv) {
        const buffer = buffers[bv.buffer];
        if (buffer) {
          const byteOffset = bv.byteOffset || 0;
          const chunk = buffer.slice(byteOffset, byteOffset + bv.byteLength);
          const blob = new Blob([chunk], { type: imageDef.mimeType || "image/jpeg" });
          url = URL.createObjectURL(blob);
          objectUrl = true;
        }
      }
    }

    if (!url) return null;

    try {
      // glTF 2.0 defines texture coordinates with origin (0, 0) at the upper-left corner of the image,
      // so glTF textures must NOT be flipped on decode (flipY = false).
      const img = await assetManager.loadImage(url, undefined, false);
      return Texture.fromImage(img);
    } finally {
      if (objectUrl) URL.revokeObjectURL(url);
    }
  }
}

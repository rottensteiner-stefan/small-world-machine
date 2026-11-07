import type { GltfJson, GltfTextureInfo } from "./types.js";
import { StandardMaterial } from "../../core/materials/index.js";
import { Color } from "../../core/colors/index.js";
import { Texture } from "../../core/textures/index.js";
import type { AssetManager } from "../AssetManager.js";
import { CullMode, TextureFilter, TextureWrap } from "../../enums/index.js";
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
   * Encodes a glTF-linear channel into the engine's sRGB-authored color convention.
   * This is the inverse of the shader decode (`sRGBToLinear`/`pow(x, gamma)`), so a
   * glTF-linear `baseColorFactor` is converted ONCE here and decoded exactly once in the
   * fragment shader -- the historical double-decode (imported tints rendered too dark)
   * is thereby removed. Matches the engine's pow-approximation exactly for round-trips.
   */
  public static linearToEngineSRGB(v: number): number {
    return Math.pow(v, 1.0 / 2.2);
  }

  /**
   * Decodes an engine-sRGB color channel back into glTF-linear baseColorFactor. This is the
   * exact inverse of {@link linearToEngineSRGB} (pow exponent 2.2), used by `WorldWriter` so
   * its exported `baseColorFactor` is glTF-linear and round-trips through the loader's single
   * encode back to the authored sRGB value. Alpha is never encoded and stays untouched.
   */
  public static engineSRGBToLinear(v: number): number {
    return Math.pow(v, 2.2);
  }

  /**
   * Maps `KHR_texture_transform` offset/scale/rotation onto `Texture.offset`/`repeat`/`rotation`,
   * the only UV transform the material pipeline carries (one per material, read via
   * `_syncTexOffsetRepeat`). `texCoord` is not supported and is ignored.
   */
  public static applyTextureTransform(tex: Texture, info: GltfTextureInfo): void {
    const transform = info.extensions?.KHR_texture_transform;
    if (!transform) return;
    if (transform.offset) {
      tex.offset.x = transform.offset[0] ?? 0;
      tex.offset.y = transform.offset[1] ?? 0;
    }
    if (transform.scale) {
      tex.repeat.x = transform.scale[0] ?? 1;
      tex.repeat.y = transform.scale[1] ?? 1;
    }
    if (transform.rotation !== undefined) {
      tex.rotation = transform.rotation;
    }
  }

  private static _wrapFromGl(code: number | undefined): TextureWrap | undefined {
    switch (code) {
      case 10497:
        return TextureWrap.REPEAT;
      case 33071:
        return TextureWrap.CLAMP_TO_EDGE;
      case 33648:
        return TextureWrap.MIRRORED_REPEAT;
      default:
        return undefined;
    }
  }

  private static _filterFromGl(code: number | undefined): TextureFilter | undefined {
    switch (code) {
      case 9728:
        return TextureFilter.NEAREST;
      case 9729:
        return TextureFilter.LINEAR;
      case 9984:
        return TextureFilter.NEAREST_MIPMAP_NEAREST;
      case 9985:
        return TextureFilter.LINEAR_MIPMAP_NEAREST;
      case 9986:
        return TextureFilter.NEAREST_MIPMAP_LINEAR;
      case 9987:
        return TextureFilter.LINEAR_MIPMAP_LINEAR;
      default:
        return undefined;
    }
  }

  /**
   * Applies `textures[].sampler` (wrapS/wrapT/magFilter/minFilter) to `tex`. Missing fields keep
   * the engine defaults (glTF's default wrap is repeat as well). Samplers belong to the texture
   * index, so the per-index texture cache already keys on them.
   */
  public static applySampler(tex: Texture, samplerIndex: number | undefined, json: GltfJson): void {
    if (samplerIndex === undefined) return;
    const sampler = json.samplers?.[samplerIndex];
    if (!sampler) {
      console.warn(`[GltfMaterialParser] texture references missing sampler ${samplerIndex}.`);
      return;
    }
    const wrapU = this._wrapFromGl(sampler.wrapS);
    const wrapV = this._wrapFromGl(sampler.wrapT);
    const mag = this._filterFromGl(sampler.magFilter);
    const min = this._filterFromGl(sampler.minFilter);
    if (wrapU) tex.addressModeU = wrapU;
    if (wrapV) tex.addressModeV = wrapV;
    if (mag) tex.magFilter = mag;
    if (min) tex.minFilter = min;
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
      // glTF defines baseColorFactor in LINEAR space. `Material.color` (and every shader's
      // sRGBToLinear(u_color)) is sRGB-authored, so the factor is encoded here, once, and
      // decoded exactly once by the shader (see linearToEngineSRGB).
      mat.color = new Color(
        GltfMaterialParser.linearToEngineSRGB(pbr.baseColorFactor[0]!),
        GltfMaterialParser.linearToEngineSRGB(pbr.baseColorFactor[1]!),
        GltfMaterialParser.linearToEngineSRGB(pbr.baseColorFactor[2]!),
        pbr.baseColorFactor[3]!,
      );
    }

    if (pbr.baseColorTexture) {
      const tex = await this.resolveSlot(
        pbr.baseColorTexture,
        json,
        folderPath,
        buffers,
        assetManager,
        readCtx,
        "pbr.baseColorTexture",
      );
      if (tex) {
        mat.diffuseMap = tex;
      }
    }

    if (pbr.metallicRoughnessTexture) {
      const tex = await this.resolveSlot(
        pbr.metallicRoughnessTexture,
        json,
        folderPath,
        buffers,
        assetManager,
        readCtx,
        "pbr.metallicRoughnessTexture",
      );
      if (tex) {
        mat.metallicMap = tex;
        mat.roughnessMap = tex;
      }
    }

    if (m.normalTexture) {
      const tex = await this.resolveSlot(
        m.normalTexture,
        json,
        folderPath,
        buffers,
        assetManager,
        readCtx,
        "m.normalTexture",
      );
      if (tex) {
        mat.normalMap = tex;
        if (m.normalTexture.scale !== undefined) {
          mat.normalScale.set(m.normalTexture.scale, m.normalTexture.scale);
        }
      }
    }

    if (m.occlusionTexture) {
      const tex = await this.resolveSlot(
        m.occlusionTexture,
        json,
        folderPath,
        buffers,
        assetManager,
        readCtx,
        "m.occlusionTexture",
      );
      if (tex) {
        mat.aoMap = tex;
        if (m.occlusionTexture.strength !== undefined) {
          mat.ao = m.occlusionTexture.strength;
        }
      }
    }

    if (m.emissiveTexture) {
      const tex = await this.resolveSlot(
        m.emissiveTexture,
        json,
        folderPath,
        buffers,
        assetManager,
        readCtx,
        "m.emissiveTexture",
      );
      if (tex) {
        mat.emissiveMap = tex;
      }
    }

    // emissiveFactor, sheenColorFactor and attenuationColor are glTF-linear like baseColorFactor and
    // get the same single encode into the engine's sRGB-authored Color convention (ADR 0049).
    if (m.emissiveFactor) {
      mat.emissiveColor = new Color(
        GltfMaterialParser.linearToEngineSRGB(m.emissiveFactor[0]!),
        GltfMaterialParser.linearToEngineSRGB(m.emissiveFactor[1]!),
        GltfMaterialParser.linearToEngineSRGB(m.emissiveFactor[2]!),
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
        const tex = await this.resolveSlot(
          cc.clearcoatTexture,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
          "cc.clearcoatTexture",
        );
        if (tex) mat.clearcoatMap = tex;
      }
      if (cc.clearcoatRoughnessTexture) {
        const tex = await this.resolveSlot(
          cc.clearcoatRoughnessTexture,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
          "cc.clearcoatRoughnessTexture",
        );
        if (tex) mat.clearcoatRoughnessMap = tex;
      }
      if (cc.clearcoatNormalTexture) {
        const tex = await this.resolveSlot(
          cc.clearcoatNormalTexture,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
          "cc.clearcoatNormalTexture",
        );
        if (tex) mat.clearcoatNormalMap = tex;
      }
    }

    if (m.extensions?.KHR_materials_sheen) {
      const sheen = m.extensions.KHR_materials_sheen;
      if (sheen.sheenColorFactor) {
        mat.sheenColor = new Color(
          GltfMaterialParser.linearToEngineSRGB(sheen.sheenColorFactor[0]!),
          GltfMaterialParser.linearToEngineSRGB(sheen.sheenColorFactor[1]!),
          GltfMaterialParser.linearToEngineSRGB(sheen.sheenColorFactor[2]!),
          1.0,
        );
      }
      if (sheen.sheenRoughnessFactor !== undefined) mat.sheenRoughness = sheen.sheenRoughnessFactor;
      if (sheen.sheenColorTexture) {
        const tex = await this.resolveSlot(
          sheen.sheenColorTexture,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
          "sheen.sheenColorTexture",
        );
        if (tex) mat.sheenColorMap = tex;
      }
      if (sheen.sheenRoughnessTexture) {
        const tex = await this.resolveSlot(
          sheen.sheenRoughnessTexture,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
          "sheen.sheenRoughnessTexture",
        );
        if (tex) mat.sheenRoughnessMap = tex;
      }
    }

    if (m.extensions?.KHR_materials_transmission) {
      const trans = m.extensions.KHR_materials_transmission;
      if (trans.transmissionFactor !== undefined) mat.transmission = trans.transmissionFactor;
      if (trans.transmissionTexture) {
        const tex = await this.resolveSlot(
          trans.transmissionTexture,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
          "trans.transmissionTexture",
        );
        if (tex) mat.transmissionMap = tex;
      }
    }

    if (m.extensions?.KHR_materials_volume) {
      const vol = m.extensions.KHR_materials_volume;
      if (vol.thicknessFactor !== undefined) mat.thickness = vol.thicknessFactor;
      if (vol.thicknessTexture) {
        const tex = await this.resolveSlot(
          vol.thicknessTexture,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
          "vol.thicknessTexture",
        );
        if (tex) mat.thicknessMap = tex;
      }
      // glTF default is +Infinity (no attenuation, not expressible in JSON); the engine's
      // `attenuationDistance` default of 1000 is that "no attenuation" sentinel, so a missing
      // value intentionally keeps it. All other KHR_materials_* defaults already equal the spec's.
      if (vol.attenuationDistance !== undefined) mat.attenuationDistance = vol.attenuationDistance;
      if (vol.attenuationColor) {
        mat.attenuationColor = new Color(
          GltfMaterialParser.linearToEngineSRGB(vol.attenuationColor[0]!),
          GltfMaterialParser.linearToEngineSRGB(vol.attenuationColor[1]!),
          GltfMaterialParser.linearToEngineSRGB(vol.attenuationColor[2]!),
          1.0,
        );
      }
    }

    if (m.extensions?.KHR_materials_ior?.ior !== undefined) {
      mat.ior = m.extensions.KHR_materials_ior.ior;
    }

    if (m.extensions?.KHR_materials_specular) {
      const spec = m.extensions.KHR_materials_specular;
      if (spec.specularFactor !== undefined) mat.specularFactor = spec.specularFactor;
      if (spec.specularColorFactor) {
        mat.specularColor = new Color(
          GltfMaterialParser.linearToEngineSRGB(spec.specularColorFactor[0]!),
          GltfMaterialParser.linearToEngineSRGB(spec.specularColorFactor[1]!),
          GltfMaterialParser.linearToEngineSRGB(spec.specularColorFactor[2]!),
          1.0,
        );
      }
      if (spec.specularTexture) {
        const tex = await this.resolveSlot(
          spec.specularTexture,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
          "spec.specularTexture",
        );
        if (tex) {
          mat.specularMap = tex;
        }
      }
      if (spec.specularColorTexture) {
        const tex = await this.resolveSlot(
          spec.specularColorTexture,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
          "spec.specularColorTexture",
        );
        if (tex) {
          mat.specularColorMap = tex;
        }
      }
    }

    // The anisotropy and iridescence textures are sampled on WebGL2 only (ADR 0055); WebGPU and WebGL1
    // use the factors.
    if (m.extensions?.KHR_materials_anisotropy) {
      const aniso = m.extensions.KHR_materials_anisotropy;
      if (aniso.anisotropyStrength !== undefined) mat.anisotropyStrength = aniso.anisotropyStrength;
      if (aniso.anisotropyRotation !== undefined) mat.anisotropyRotation = aniso.anisotropyRotation;
      if (aniso.anisotropyTexture) {
        const tex = await this.resolveSlot(
          aniso.anisotropyTexture,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
          "aniso.anisotropyTexture",
        );
        if (tex) {
          mat.anisotropyMap = tex;
        }
      }
    }

    if (m.extensions?.KHR_materials_iridescence) {
      const irid = m.extensions.KHR_materials_iridescence;
      if (irid.iridescenceFactor !== undefined) mat.iridescenceFactor = irid.iridescenceFactor;
      if (irid.iridescenceIor !== undefined) mat.iridescenceIor = irid.iridescenceIor;
      if (irid.iridescenceThicknessMinimum !== undefined) {
        mat.iridescenceThicknessMinimum = irid.iridescenceThicknessMinimum;
      }
      if (irid.iridescenceThicknessMaximum !== undefined) {
        mat.iridescenceThicknessMaximum = irid.iridescenceThicknessMaximum;
      }
      if (irid.iridescenceTexture) {
        const tex = await this.resolveSlot(
          irid.iridescenceTexture,
          json,
          folderPath,
          buffers,
          assetManager,
          readCtx,
          "irid.iridescenceTexture",
        );
        if (tex) {
          mat.iridescenceMap = tex;
        }
      }
      if (irid.iridescenceThicknessTexture) {
        // Intensity (red) and thickness (green) are usually packed into one image: reuse the resolved
        // texture so the material shares one sampler (and one WebGL2 texture unit) for both.
        const packed =
          irid.iridescenceTexture?.index === irid.iridescenceThicknessTexture.index
            ? mat.iridescenceMap
            : undefined;
        const tex =
          packed ??
          (await this.resolveSlot(
            irid.iridescenceThicknessTexture,
            json,
            folderPath,
            buffers,
            assetManager,
            readCtx,
            "irid.iridescenceThicknessTexture",
          ));
        if (tex) {
          mat.iridescenceThicknessMap = tex;
        }
      }
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
      // glTF MASK is a depth-writing opaque cutout: the fragment shader already `discard`s
      // below alphaTest, so the material must stay in the opaque batch (depthWrite retained,
      // no alpha blending). Setting `transparent` here would have blended + dropped the
      // depth-write, breaking the glTF alphaMode semantics.
      mat.alphaTest = m.alphaCutoff !== undefined ? m.alphaCutoff : 0.5;
    }

    if (m.doubleSided) {
      mat.cullMode = CullMode.NONE;
    }

    // KHR_materials_unlit: the material renders its base color as-is -- no lighting, no IBL, no
    // emissive. The extension is registered by the loader's supported-extensions allowlist, so an
    // unlit glTF material cannot reach this parser without the extension being allowed. All other
    // PBR slots are parsed as usual and simply stay unused by the USE_UNLIT shader variant.
    if (m.extensions?.KHR_materials_unlit) {
      mat.unlit = true;
    }

    options.onMaterialParsed?.(mat, m as unknown as Record<string, unknown>);

    return mat;
  }

  /**
   * Resolves one material texture slot: the shared per-parse `Texture` for the referenced index, or
   * (non-identity `KHR_texture_transform`) a per-transform sibling that reuses the decoded pixels.
   * A `texCoord` other than 0 is unsupported (only `TEXCOORD_0` is imported) and warned about once
   * per slot.
   */
  public static async resolveSlot(
    info: GltfTextureInfo,
    json: GltfJson,
    folderPath: string,
    buffers: ArrayBuffer[],
    assetManager: AssetManager,
    readCtx: GltfReadContext,
    slot: string,
  ): Promise<Texture | null> {
    const transform = info.extensions?.KHR_texture_transform;
    const texCoord = transform?.texCoord ?? info.texCoord ?? 0;
    if (texCoord !== 0) {
      console.warn(
        `[GltfMaterialParser] ${slot} (texture ${info.index}) uses texCoord ${texCoord}; only TEXCOORD_0 is imported, UV set ${texCoord} is ignored.`,
      );
    }
    const base = await this.resolveTexture(
      info.index,
      json,
      folderPath,
      buffers,
      assetManager,
      readCtx,
    );
    if (!base) return null;
    const isIdentity =
      !transform ||
      (!transform.offset?.some((v) => v !== 0) &&
        !transform.scale?.some((v) => v !== 1) &&
        !transform.rotation);
    if (isIdentity) return base;

    // The transform lives on the Texture object, so slots with different transforms need their
    // own instance. They share the decoded bitmap / compressed payload, not the GPU upload.
    const key = `slotTexture:${info.index}:${JSON.stringify([
      transform.offset,
      transform.scale,
      transform.rotation,
    ])}`;
    let derived = readCtx.state.get(key) as Texture | undefined;
    if (!derived) {
      derived = base.compressedImage
        ? Texture.fromCompressed(base.compressedImage)
        : Texture.fromImage(base.image as ImageBitmap | HTMLImageElement);
      derived.addressModeU = base.addressModeU;
      derived.addressModeV = base.addressModeV;
      derived.magFilter = base.magFilter;
      derived.minFilter = base.minFilter;
      this.applyTextureTransform(derived, info);
      readCtx.state.set(key, derived);
    }
    return derived;
  }

  /**
   * Resolves a texture index to a Small World Machine Texture instance. With a read context the
   * result is cached per parse (one `Texture` per index), so slots referencing the same index
   * (ORM, shared specular maps) share one object and one GPU upload.
   */
  public static async resolveTexture(
    texIdx: number,
    json: GltfJson,
    folderPath: string,
    buffers: ArrayBuffer[],
    assetManager: AssetManager,
    ctx?: GltfReadContext,
  ): Promise<Texture | null> {
    if (!ctx) {
      return this._resolveTextureUncached(texIdx, json, folderPath, buffers, assetManager, {
        json,
        state: new Map(),
      });
    }
    const key = `texture:${texIdx}`;
    let pending = ctx.state.get(key) as Promise<Texture | null> | undefined;
    if (!pending) {
      pending = this._resolveTextureUncached(texIdx, json, folderPath, buffers, assetManager, ctx);
      ctx.state.set(key, pending);
    }
    return pending;
  }

  /**
   * Loads an image definition (`uri`, data URI or embedded `bufferView`). Embedded images are
   * decoded straight from their bytes: routing them through `assetManager.loadImage` via a
   * throw-away blob URL would leave an unreachable entry in its image cache forever.
   */
  public static async loadImageDef(
    imageDef: { uri?: string; bufferView?: number; mimeType?: string },
    json: GltfJson,
    folderPath: string,
    buffers: ArrayBuffer[],
    assetManager: AssetManager,
    defaultMimeType: string,
  ): Promise<ImageBitmap | HTMLImageElement | null> {
    if (imageDef.uri) {
      const url = imageDef.uri.startsWith("data:") ? imageDef.uri : folderPath + imageDef.uri;
      // glTF 2.0 defines texture coordinates with origin (0, 0) at the upper-left corner of the
      // image, so glTF textures must NOT be flipped on decode (flipY = false).
      return assetManager.loadImage(url, undefined, false);
    }
    const bv =
      imageDef.bufferView !== undefined && json.bufferViews
        ? json.bufferViews[imageDef.bufferView]
        : undefined;
    const buffer = bv ? buffers[bv.buffer] : undefined;
    if (!bv || !buffer) return null;
    const byteOffset = bv.byteOffset || 0;
    const chunk = buffer.slice(byteOffset, byteOffset + bv.byteLength);
    const blob = new Blob([chunk], { type: imageDef.mimeType || defaultMimeType });
    try {
      return await createImageBitmap(blob, {
        colorSpaceConversion: "none",
        imageOrientation: "from-image" as ImageOrientation,
      });
    } catch {
      return createImageBitmap(blob, { colorSpaceConversion: "none", imageOrientation: "none" });
    }
  }

  private static async _resolveTextureUncached(
    texIdx: number,
    json: GltfJson,
    folderPath: string,
    buffers: ArrayBuffer[],
    assetManager: AssetManager,
    readCtx: GltfReadContext,
  ): Promise<Texture | null> {
    const textureDef = json.textures?.[texIdx];
    if (!textureDef) {
      console.warn(`[GltfMaterialParser] texture index ${texIdx} does not exist; slot ignored.`);
      return null;
    }

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
        if (tex) {
          this.applySampler(tex, textureDef.sampler, json);
          return tex;
        }
      }
    }

    // 2. Standard image resolution fallback
    if (textureDef.source === undefined) {
      console.warn(`[GltfMaterialParser] texture ${texIdx} has no image source; slot ignored.`);
      return null;
    }
    const imageDef = json.images?.[textureDef.source];
    if (!imageDef) {
      console.warn(
        `[GltfMaterialParser] texture ${texIdx} references missing image ${textureDef.source}; slot ignored.`,
      );
      return null;
    }

    const img = await GltfMaterialParser.loadImageDef(
      imageDef,
      json,
      folderPath,
      buffers,
      assetManager,
      "image/jpeg",
    );
    if (!img) {
      console.warn(
        `[GltfMaterialParser] image ${textureDef.source} of texture ${texIdx} has no resolvable data (missing bufferView/buffer); slot ignored.`,
      );
      return null;
    }
    const texture = Texture.fromImage(img);
    this.applySampler(texture, textureDef.sampler, json);
    return texture;
  }
}

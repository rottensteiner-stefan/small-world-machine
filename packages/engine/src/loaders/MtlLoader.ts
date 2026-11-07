import { AbstractLoader } from "./AbstractLoader.js";
import { EventType, TextureFilter } from "../enums/index.js";
import { PhongMaterial } from "../core/materials/index.js";
import { Texture } from "../core/textures/index.js";
import type { LoaderOptions } from "../interfaces/index.js";

export class MtlLoader extends AbstractLoader<Map<string, PhongMaterial>> {
  /**
   * Creates a new MtlLoader.
   * @param options Optional configuration options.
   */
  constructor(options: LoaderOptions = {}) {
    super(options);
  }

  public override async load(url: string): Promise<Map<string, PhongMaterial>> {
    const fullUrl: string = this.basePath + url;
    this.dispatchEvent(EventType.LOADER_START, { url: fullUrl });

    try {
      const text: string = await this._assetManager.loadText(
        fullUrl,
        (loaded: number, total: number): void => {
          this.dispatchEvent(EventType.LOADER_PROGRESS, { url: fullUrl, loaded, total });
        },
      );

      const folderPath: string = MtlLoader.getFolderPath(fullUrl);
      const materials: Map<string, PhongMaterial> = await this._parse(text, folderPath);

      this.dispatchEvent(EventType.LOADER_END, { url: fullUrl, data: materials });
      return materials;
    } catch (error: unknown) {
      this.dispatchEvent(EventType.LOADER_ERROR, { url: fullUrl, error });
      throw error;
    }
  }

  private async _parse(text: string, folderPath: string): Promise<Map<string, PhongMaterial>> {
    const materials: Map<string, PhongMaterial> = new Map<string, PhongMaterial>();
    let currentMat: PhongMaterial | undefined = undefined;

    const lines: string[] = text.split("\n");
    for (let line of lines) {
      line = line.trim();

      if (0 === line.length || line.startsWith("#")) {
        continue;
      }

      const parts: string[] = line.split(/\s+/);
      const type: string = parts[0]!;

      if ("newmtl" === type) {
        currentMat = new PhongMaterial();
        const matName = parts[1];
        if (matName) {
          materials.set(matName, currentMat);
        }
      } else if ("Kd" === type && currentMat) {
        currentMat.color.set(
          parseFloat(parts[1] ?? "1"),
          parseFloat(parts[2] ?? "1"),
          parseFloat(parts[3] ?? "1"),
        );
      } else if ("Ks" === type && currentMat) {
        const r = parseFloat(parts[1] ?? "1");
        const g = parseFloat(parts[2] ?? "1");
        const b = parseFloat(parts[3] ?? "1");
        // Ensure some specularity if defined, but not zero
        currentMat.specularColor.set(Math.max(r, 0.05), Math.max(g, 0.05), Math.max(b, 0.05));
      } else if ("Ns" === type && currentMat) {
        currentMat.shininess = parseFloat(parts[1] ?? "32");
      } else if ("map_Kd" === type && currentMat) {
        const texPath: string = line.substring(line.indexOf(" ") + 1).trim();
        const texUrl: string = folderPath + texPath;

        // --- THE FIX: We use the AssetManager with flipY = true ---
        // The renderer NO LONGER handles flipping; it's done during image creation!
        try {
          const image: ImageBitmap | HTMLImageElement = await this._assetManager.loadImage(
            texUrl,
            undefined,
            true,
          );
          currentMat.diffuseMap = Texture.fromImage(image, {
            magFilter: TextureFilter.NEAREST,
            minFilter: TextureFilter.NEAREST,
          });
        } catch (e) {
          console.error(`[MtlLoader] Failed to load texture: ${texUrl}`, e);
        }
      } else if (("map_Bump" === type || "bump" === type) && currentMat) {
        const texPath: string = line.substring(line.indexOf(" ") + 1).trim();
        const texUrl: string = folderPath + texPath;

        try {
          const image: ImageBitmap | HTMLImageElement = await this._assetManager.loadImage(
            texUrl,
            undefined,
            true,
          );
          currentMat.normalMap = Texture.fromImage(image, {
            magFilter: TextureFilter.NEAREST,
            minFilter: TextureFilter.NEAREST,
          });
        } catch (e) {
          console.error(`[MtlLoader] Failed to load bump texture: ${texUrl}`, e);
        }
      }
    }

    return materials;
  }
}

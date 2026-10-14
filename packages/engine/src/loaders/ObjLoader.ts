import { AbstractLoader } from "./AbstractLoader.js";
import { MtlLoader } from "./MtlLoader.js";
import { EventType } from "../enums/index.js";
import { ModelGeometry } from "../geometry/index.js";
import { Object3D } from "../core/index.js";
import { PhongMaterial } from "../core/materials/index.js";
import { LoaderOptions } from "../interfaces/index.js";

// Helper class to sort geometry parts by material
class MaterialGroup {
  public outVertices: number[] = [];
  public outUVs: number[] = [];
  public outNormals: number[] = [];
  public outIndices: number[] = [];
  public vertexCache: Map<string, number> = new Map<string, number>();
  public indexCounter: number = 0;
  /** True once at least one face-vertex supplied a real (in-range) vn index. */
  public hasExplicitNormals: boolean = false;
  constructor(public name: string) {}
}

export class ObjLoader extends AbstractLoader<Object3D> {
  /**
   * Creates a new ObjLoader.
   * @param options Optional configuration options.
   */
  constructor(options: LoaderOptions = {}) {
    super(options);
  }

  public override async load(url: string): Promise<Object3D> {
    const fullUrl: string = this.basePath + url;
    this.dispatchEvent(EventType.LOADER_START, { url: fullUrl });

    try {
      const text: string = await this._assetManager.loadText(
        fullUrl,
        (loaded: number, total: number): void => {
          this.dispatchEvent(EventType.LOADER_PROGRESS, { url: fullUrl, loaded, total });
        },
      );

      // Extract folder path to know where to look for the .mtl file
      const folderPath: string = ObjLoader.getFolderPath(fullUrl);

      const rootObject: Object3D = await this._parse(text, folderPath);

      this.dispatchEvent(EventType.LOADER_END, { url: fullUrl, data: rootObject });
      return rootObject;
    } catch (error: unknown) {
      this.dispatchEvent(EventType.LOADER_ERROR, { url: fullUrl, error });
      throw error;
    }
  }

  private async _parse(text: string, folderPath: string): Promise<Object3D> {
    const tempVertices: number[] = [];
    const tempUVs: number[] = [];
    const tempNormals: number[] = [];

    let materials: Map<string, PhongMaterial> = new Map<string, PhongMaterial>();
    const groups: Map<string, MaterialGroup> = new Map<string, MaterialGroup>();

    // Fallback group if no material is defined in the OBJ
    let currentGroup: MaterialGroup = new MaterialGroup("default");
    groups.set("default", currentGroup);

    let pos: number = 0;
    while (pos < text.length) {
      let nextNL: number = text.indexOf("\n", pos);
      if (-1 === nextNL) {
        nextNL = text.length;
      }

      const line: string = text.substring(pos, nextNL).trim();
      pos = nextNL + 1;

      if (0 === line.length || line.startsWith("#")) {
        continue;
      }

      const parts: string[] = line.split(/\s+/);
      if (2 > parts.length) {
        continue;
      }

      const type: string = parts[0]!;

      if ("mtllib" === type) {
        try {
          const mtlLoader: MtlLoader = new MtlLoader({
            basePath: folderPath,
            assetManager: this._assetManager,
          });
          materials = await mtlLoader.load(parts[1]!);
        } catch (e) {
          // A missing/broken `.mtl` (common with OBJ/MTL pairs from third-party exporters)
          // should not sink the whole `.obj` load -- fall back to neutral default materials so
          // the geometry still loads and renders, mirroring the tolerance MtlLoader already shows
          // for individual textures within a `.mtl`.
          console.warn(
            `[ObjLoader] Failed to load material library "${parts[1]}". Falling back to default materials.`,
            e,
          );
        }
      } else if ("usemtl" === type) {
        const matName: string = parts[1]!;
        if (!groups.has(matName)) {
          groups.set(matName, new MaterialGroup(matName));
        }
        currentGroup = groups.get(matName)!;
      } else if ("v" === type) {
        // Only take first 3 components, ignore vertex colors if present
        tempVertices.push(parseFloat(parts[1]!), parseFloat(parts[2]!), parseFloat(parts[3]!));
      } else if ("vt" === type) {
        tempUVs.push(parseFloat(parts[1]!), parseFloat(parts[2]!));
      } else if ("vn" === type) {
        tempNormals.push(parseFloat(parts[1]!), parseFloat(parts[2]!), parseFloat(parts[3]!));
      } else if ("f" === type) {
        const v1: number = this._parseFaceVertex(
          parts[1]!,
          tempVertices,
          tempUVs,
          tempNormals,
          currentGroup,
        );
        for (let i: number = 2; i < parts.length - 1; i++) {
          const v2: number = this._parseFaceVertex(
            parts[i]!,
            tempVertices,
            tempUVs,
            tempNormals,
            currentGroup,
          );
          const v3: number = this._parseFaceVertex(
            parts[i + 1]!,
            tempVertices,
            tempUVs,
            tempNormals,
            currentGroup,
          );
          currentGroup.outIndices.push(v1, v2, v3);
        }
      }
    }

    // Assemble the final scene object
    const root: Object3D = new Object3D("ModelRoot");

    groups.forEach((group: MaterialGroup, name: string): void => {
      // Ignore empty groups (e.g. "default" if OBJ starts directly with usemtl)
      if (0 === group.outIndices.length) {
        return;
      }

      const child: Object3D = new Object3D(name);
      // ModelGeometry only auto-computes normals when handed an empty array; a group that never
      // saw a real vn must pass [] rather than its (0,0,0)-padded placeholder array, or every
      // vertex would ship with a zero normal instead of a computed one.
      child.geometry = new ModelGeometry(
        group.outVertices,
        group.outUVs,
        group.hasExplicitNormals ? group.outNormals : [],
        group.outIndices,
      ).getGeometryData();
      child.material = materials.get(name) || new PhongMaterial();

      root.add(child);
    });

    return root;
  }

  private _parseFaceVertex(
    faceStr: string,
    tempV: number[],
    tempVT: number[],
    tempVN: number[],
    group: MaterialGroup,
  ): number {
    const parts: string[] = faceStr.split("/");

    // 1. Position (Mandatory)
    // OBJ indices are 1-based; negative indices are relative to the last vertex parsed so far
    // (e.g. -1 == most recently defined vertex), commonly emitted by Blender's exporter.
    const vRaw: number = parseInt(parts[0]!);
    const totalV = tempV.length / 3;
    const absV: number = vRaw < 0 ? totalV + vRaw + 1 : vRaw;
    const vIdx: number = (absV - 1) * 3;

    // 2. UV Coordinates (Optional)
    let absVT = 0;
    let vtIdx = -1;
    if (parts.length > 1 && parts[1] !== "") {
      const vtRaw = parseInt(parts[1]!);
      const totalVT = tempVT.length / 2;
      absVT = vtRaw < 0 ? totalVT + vtRaw + 1 : vtRaw;
      vtIdx = (absVT - 1) * 2;
    }

    // 3. Normals (Optional)
    let absVN = 0;
    let vnIdx = -1;
    if (parts.length > 2 && parts[2] !== "") {
      const vnRaw = parseInt(parts[2]!);
      const totalVN = tempVN.length / 3;
      absVN = vnRaw < 0 ? totalVN + vnRaw + 1 : vnRaw;
      vnIdx = (absVN - 1) * 3;
    }

    // Key cache on resolved absolute indices so negative relative indices (e.g. -1) referring
    // to different vertices across time do not collide.
    const cacheKey = `${absV}/${absVT || ""}/${absVN || ""}`;
    if (group.vertexCache.has(cacheKey)) {
      return group.vertexCache.get(cacheKey)!;
    }

    if (!Number.isFinite(vRaw) || absV <= 0 || vIdx < 0 || vIdx + 2 >= tempV.length) {
      console.warn(
        `[ObjLoader] Malformed face vertex index "${parts[0]}" in "${faceStr}", using (0,0,0).`,
      );
      group.outVertices.push(0, 0, 0);
    } else {
      group.outVertices.push(tempV[vIdx]!, tempV[vIdx + 1]!, tempV[vIdx + 2]!);
    }

    if (absVT > 0 && vtIdx >= 0 && vtIdx + 1 < tempVT.length) {
      group.outUVs.push(tempVT[vtIdx]!, tempVT[vtIdx + 1]!);
    } else {
      group.outUVs.push(0, 0);
    }

    if (absVN > 0 && vnIdx >= 0 && vnIdx + 2 < tempVN.length) {
      group.outNormals.push(tempVN[vnIdx]!, tempVN[vnIdx + 1]!, tempVN[vnIdx + 2]!);
      group.hasExplicitNormals = true;
    } else {
      // Push a placeholder to keep outNormals aligned 1:1 with outVertices, matching the UV
      // branch above -- otherwise a face-vertex with a missing/out-of-range vn shifts every
      // subsequent vertex's normal by one slot. `parse()` discards this array entirely (falling
      // back to auto-computed normals) unless `hasExplicitNormals` is true for the group.
      group.outNormals.push(0, 0, 0);
    }

    const newIndex: number = group.indexCounter++;
    group.vertexCache.set(cacheKey, newIndex);
    return newIndex;
  }
}

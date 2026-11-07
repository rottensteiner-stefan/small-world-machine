import type { IAssetSource } from "./types.js";

export type IngestTargetKind =
  "image" | "svg" | "pbr-set" | "gltf" | "json" | "zip" | "files" | "archive" | "text" | "any";

export interface PbrSetMatch {
  name: string;
  albedo?: File | Blob;
  normal?: File | Blob;
  roughness?: File | Blob;
  metallic?: File | Blob;
  ao?: File | Blob;
  height?: File | Blob;
  emissive?: File | Blob;
}

export interface IngestFileItem {
  name: string;
  path: string;
  size: number;
  mimeType: string;
  data: Uint8Array;
  blob: Blob;
}

export type IngestResult =
  | {
      kind: "image";
      image: HTMLImageElement;
      blob: Blob;
      dataUrl: string;
      name: string;
      width: number;
      height: number;
    }
  | {
      /**
       * Vector image. `blob`/`dataUrl`/`svgText` hold the SVG with an explicit pixel size
       * (see `normalizeSvg`), so consumers get a predictable raster size and can re-rasterise
       * `svgText` at any resolution.
       */
      kind: "svg";
      svgText: string;
      blob: Blob;
      dataUrl: string;
      name: string;
      width: number;
      height: number;
    }
  | {
      kind: "pbr-set";
      pbrSet: PbrSetMatch;
      name: string;
    }
  | {
      kind: "gltf";
      source: IAssetSource;
      mainFile: string;
      name: string;
    }
  | {
      kind: "json";
      data: unknown;
      rawText: string;
      name: string;
    }
  | {
      kind: "text";
      text: string;
      name: string;
    }
  | {
      kind: "archive";
      files: IngestFileItem[];
      name: string;
    }
  | {
      kind: "files";
      files: File[];
      name: string;
    };

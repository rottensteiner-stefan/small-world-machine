import type { IngestResult, PbrSetMatch } from "./UniversalIngestTypes.js";

/** An image found inside an archive or a plain file list. */
export interface IngestImageItem {
  name: string;
  blob: Blob;
}

/** First texture of a PBR set (albedo preferred), or undefined for an empty set. */
export function primaryPbrTexture(set: PbrSetMatch): File | Blob | undefined {
  return (
    set.albedo ??
    set.height ??
    set.normal ??
    set.roughness ??
    set.metallic ??
    set.ao ??
    set.emissive
  );
}

/** File name of a texture, falling back to `fallback` for anonymous blobs. */
export function textureName(texture: File | Blob, fallback: string): string {
  return texture instanceof File ? texture.name : fallback;
}

/** First image inside an archive or a plain list of dropped files. */
export function firstImageItem(
  result: Extract<IngestResult, { kind: "archive" | "files" }>,
): IngestImageItem | undefined {
  if ("archive" === result.kind) {
    const item = result.files.find(
      (file) => file.mimeType.startsWith("image/") || file.blob.type.startsWith("image/"),
    );
    return undefined === item ? undefined : { name: item.name, blob: item.blob };
  }
  const file = result.files.find((candidate) => candidate.type.startsWith("image/"));
  return undefined === file ? undefined : { name: file.name, blob: file };
}

/** Reads a blob as a data URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(reader.result as string);
    reader.onerror = (): void => reject(new Error("Fehler beim Konvertieren der Datei in Base64."));
    reader.readAsDataURL(blob);
  });
}

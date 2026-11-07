/**
 * Security and validation policies for external asset inputs (ZIP, Drop, Folders).
 * Prevents Zip-Slip path traversal, enforces size limits and file type whitelists.
 */

export interface SecurityOptions {
  /** Maximum total size in bytes (default: 250 MB) */
  maxTotalBytes?: number;
  /** Maximum single file size in bytes (default: 50 MB) */
  maxFileBytes?: number;
  /** Allowed file extensions (lowercase without dot, e.g. ["gltf", "bin", "png", "json"]) */
  allowedExtensions?: string[];
}

export class SecurityValidator {
  public static readonly DEFAULT_MAX_TOTAL_BYTES = 250 * 1024 * 1024; // 250 MB
  public static readonly DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

  public static readonly DEFAULT_ALLOWED_EXTENSIONS = [
    "json",
    "gltf",
    "glb",
    "bin",
    "png",
    "jpg",
    "jpeg",
    "webp",
    "hdr",
    "svg",
    "txt",
    "wgsl",
  ];

  private readonly _maxTotalBytes: number;
  private readonly _maxFileBytes: number;
  private readonly _allowedExtensions: Set<string>;

  constructor(options: SecurityOptions = {}) {
    this._maxTotalBytes = options.maxTotalBytes ?? SecurityValidator.DEFAULT_MAX_TOTAL_BYTES;
    this._maxFileBytes = options.maxFileBytes ?? SecurityValidator.DEFAULT_MAX_FILE_BYTES;
    const extensions = options.allowedExtensions ?? SecurityValidator.DEFAULT_ALLOWED_EXTENSIONS;
    this._allowedExtensions = new Set(
      extensions.map((ext) => ext.toLowerCase().replace(/^\./, "")),
    );
  }

  public get maxFileBytes(): number {
    return this._maxFileBytes;
  }

  /**
   * Cleans and normalizes relative file paths, stripping leading slashes,
   * collapsing `./` and preventing directory traversal `../` (Zip-Slip defense).
   */
  public sanitizePath(rawPath: string): string {
    // Replace backslashes with forward slashes
    let path = rawPath.replace(/\\/g, "/");

    // Remove leading slashes and drive letters
    path = path.replace(/^[a-zA-Z]:[/\\]/, "").replace(/^\/+/, "");

    const segments = path.split("/");
    const safeSegments: string[] = [];

    for (const segment of segments) {
      if (!segment || segment === ".") {
        continue;
      }
      if (segment === "..") {
        // Zip-Slip attempt: silently disallow escaping root
        continue;
      }
      // Strip control chars or illegal characters
      const sanitizedSegment = segment.replace(/[\0<>:"|?*]/g, "");
      if (sanitizedSegment) {
        safeSegments.push(sanitizedSegment);
      }
    }

    return safeSegments.join("/");
  }

  /**
   * Validates if a relative path is safe and does not escape its parent root.
   */
  public validatePath(rawPath: string): { valid: boolean; reason?: string } {
    if (rawPath.includes("\0")) {
      return { valid: false, reason: "Path contains null bytes" };
    }
    const normalized = rawPath.replace(/\\/g, "/");
    if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
      return { valid: false, reason: "Absolute paths not permitted" };
    }
    const parts = normalized.split("/");
    let depth = 0;
    for (const part of parts) {
      if (part === "..") {
        depth--;
        if (depth < 0) {
          return { valid: false, reason: "Path traversal out of root (Zip-Slip attempt)" };
        }
      } else if (part !== "." && part !== "") {
        depth++;
      }
    }
    return { valid: true };
  }

  /**
   * Asserts single file and total payload size against configured thresholds, throwing if limits are exceeded.
   */
  public assertSize(fileBytes: number, totalBytesAccumulator: number = 0): void {
    if (fileBytes > this._maxFileBytes) {
      const mb = (this._maxFileBytes / (1024 * 1024)).toFixed(0);
      throw new Error(
        `File size (${(fileBytes / 1024 / 1024).toFixed(2)} MB) exceeds limit of ${mb} MB`,
      );
    }
    if (totalBytesAccumulator + fileBytes > this._maxTotalBytes) {
      const mb = (this._maxTotalBytes / (1024 * 1024)).toFixed(0);
      throw new Error(`Total payload size exceeds maximum limit of ${mb} MB`);
    }
  }

  /**
   * Checks single file and total payload size against configured thresholds.
   * Alias for `assertSize`.
   */
  public validateSize(fileBytes: number, totalBytesAccumulator: number = 0): void {
    this.assertSize(fileBytes, totalBytesAccumulator);
  }

  /**
   * Checks if the file extension is on the whitelist.
   */
  public isExtensionAllowed(path: string): boolean {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return this._allowedExtensions.has(ext);
  }

  public static sanitizePath(rawPath: string): string {
    return new SecurityValidator().sanitizePath(rawPath);
  }

  public static validatePath(rawPath: string): { valid: boolean; reason?: string } {
    return new SecurityValidator().validatePath(rawPath);
  }

  /**
   * Checks if single file size is within the allowed limit.
   */
  public static isSizeAllowed(
    fileBytes: number,
    maxBytes: number = SecurityValidator.DEFAULT_MAX_FILE_BYTES,
  ): boolean {
    return fileBytes <= maxBytes;
  }

  public static validateSize(
    fileBytes: number,
    maxBytes: number = SecurityValidator.DEFAULT_MAX_FILE_BYTES,
  ): boolean {
    return SecurityValidator.isSizeAllowed(fileBytes, maxBytes);
  }

  public static isExtensionAllowed(path: string, allowed?: string[]): boolean {
    const validator = allowed
      ? new SecurityValidator({ allowedExtensions: allowed })
      : new SecurityValidator();
    return validator.isExtensionAllowed(path);
  }

  public static getMimeType(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    switch (ext) {
      case "json":
        return "application/json";
      case "gltf":
        return "model/gltf+json";
      case "glb":
        return "model/gltf-binary";
      case "bin":
        return "application/octet-stream";
      case "png":
        return "image/png";
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "webp":
        return "image/webp";
      case "svg":
        return "image/svg+xml";
      case "txt":
      case "wgsl":
        return "text/plain";
      default:
        return "application/octet-stream";
    }
  }
}

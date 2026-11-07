/**
 * Unified I/O contracts for Small World Machine tools.
 * Symmetrical AssetSource (input) and AssetSink (output) abstractions.
 */

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  path?: string;
  message: string;
  severity: ValidationSeverity;
  code?: string;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface AssetEntry {
  path: string;
  size: number;
  lastModified?: number;
  mimeType?: string;
}

/**
 * Universal read contract for asset sources (HTTP, Directory, Drop, ZIP).
 * Keeps engine decoupled from tool UI implementations.
 */
export interface IAssetSource {
  /** Unique identifier of the source instance */
  readonly id: string;
  /** Human-readable display label (e.g. "Bunker Kit (ZIP)", "Local Folder") */
  readonly name: string;
  /** Lists all available normalized file paths in this source */
  list(pattern?: string): Promise<string[]>;
  /** Checks if a normalized relative file path exists in this source */
  has(path: string): Promise<boolean>;
  /** Reads a binary file as Uint8Array */
  read(path: string): Promise<Uint8Array>;
  /** Reads a UTF-8 text file */
  readText(path: string): Promise<string>;
  /** Reads and parses a JSON document */
  readJson<T = unknown>(path: string): Promise<T>;
  /**
   * Produces a virtual fetch handler for AssetManager / KitRegistry.
   * Resolves URLs matching the mountPrefix (e.g. "sw-asset://<id>/") directly from the source.
   */
  toFetch(mountPrefix?: string): (url: string, init?: RequestInit) => Promise<Response>;
  /** Releases resources (object URLs, worker pools, in-memory buffers) */
  dispose?(): void;
}

/**
 * Universal write contract for asset sinks (ZIP, Directory, Single-File Download).
 */
export interface IAssetSink {
  /** Unique identifier of the sink instance */
  readonly id: string;
  /** Writes file content into the sink */
  write(path: string, data: Uint8Array | string): Promise<void>;
  /** Finalizes writing and generates output (e.g. Blob download or folder flush) */
  finalize(): Promise<Blob | void>;
  /** Releases resources */
  dispose?(): void;
}

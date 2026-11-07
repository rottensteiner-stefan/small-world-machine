import { unzip } from "fflate";
import type { SecurityValidator } from "./Security.js";

export interface SafeUnzipOptions {
  /** Skip entries whose extension is not on the validator's whitelist. */
  enforceExtensions?: boolean;
}

/**
 * Unzips with limits enforced from the central directory before any entry is inflated,
 * so a zip bomb is rejected instead of exhausting memory. Unsafe paths (Zip-Slip) are skipped.
 */
export function safeUnzip(
  bytes: Uint8Array,
  security: SecurityValidator,
  options: SafeUnzipOptions = {},
): Promise<Record<string, Uint8Array>> {
  return new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    let declaredTotal = 0;
    try {
      unzip(
        bytes,
        {
          filter: (file): boolean => {
            if (file.name.endsWith("/")) {
              return false;
            }
            const pathValidation = security.validatePath(file.name);
            if (!pathValidation.valid) {
              console.warn(
                `[safeUnzip] Skipping unsafe entry '${file.name}': ${pathValidation.reason}`,
              );
              return false;
            }
            if (options.enforceExtensions === true && !security.isExtensionAllowed(file.name)) {
              console.warn(`[safeUnzip] Skipping entry with disallowed extension '${file.name}'`);
              return false;
            }
            security.assertSize(file.originalSize, declaredTotal);
            declaredTotal += file.originalSize;
            return true;
          },
        },
        (err, data) => {
          if (err) {
            reject(new Error(`Failed to decompress ZIP archive: ${err.message}`));
            return;
          }
          resolve(data);
        },
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

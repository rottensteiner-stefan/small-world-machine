/**
 * Headless IBL core alias. The deterministic, browser-free IBL generator already lives
 * in `ibl-gen/ibl-gen-core.ts` (validated headless template per M5); this module only
 * re-exports those pure pieces under the `core/` namespace -- no relocation needed.
 */

export * from "../ibl-gen/ibl-gen-core.js";

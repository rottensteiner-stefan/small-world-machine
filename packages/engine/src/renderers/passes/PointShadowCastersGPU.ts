import { ShadowCasterCollector } from "./ShadowCasterCollector.js";

/**
 * Backwards-compatible alias for {@link ShadowCasterCollector} (ADR 0052 / R2).
 */
export class PointShadowCastersGPU extends ShadowCasterCollector {}
export { ShadowCasterCollector };


import type { RenderManifest } from "@small-world-machine/engine";

/**
 * Packs `[x, y, z, w]` into the `u_matParamN` lane of a render manifest (ADR 0039), reusing the
 * stored array. Local twin of the engine's `writeLane` (`core/materials/MaterialLanes.ts`), which
 * is not part of the engine's public index; swap to the engine export once it is exposed.
 */
export function writeLane(
  manifest: RenderManifest,
  lane: `u_matParam${number}`,
  value: readonly [number, number, number, number],
): void {
  const arr = manifest.properties[lane] as number[];
  arr[0] = value[0];
  arr[1] = value[1];
  arr[2] = value[2];
  arr[3] = value[3];
}

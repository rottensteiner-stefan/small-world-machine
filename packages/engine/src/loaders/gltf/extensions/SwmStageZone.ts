import { StageZone } from "../../../core/stage/StageZone.js";
import { StageZoneMarker } from "../../../core/stage/StageZoneMarker.js";
import type { GltfExtensionPlugin } from "../GltfExtensionPlugin.js";

/**
 * `SWM_stage_zone` -- a 2.5D stage movement zone (see ADR 0016), given a scene-graph presence as a
 * `StageZoneMarker` node. Entirely node-local (unlike `KHR_lights_punctual`, no root-level array
 * is needed: every point a zone needs lives directly on its own node's extension payload).
 */
export const swmStageZone: GltfExtensionPlugin = {
  name: "SWM_stage_zone",

  readNode(_nodeIndex, nodeDef, name, _ctx) {
    const def = nodeDef.extensions?.SWM_stage_zone;
    if (!def) return undefined;
    return new StageZoneMarker(
      new StageZone({
        id: name,
        name: def.displayName ?? name,
        points: def.points,
        scaleGradient: def.scaleGradient,
        useScaleGradient: def.useScaleGradient,
      }),
    );
  },

  writeNode(obj, node) {
    if (!(obj instanceof StageZoneMarker)) return;
    node.extensions = {
      ...node.extensions,
      SWM_stage_zone: {
        displayName: obj.zone.name,
        points: obj.zone.points.map((p) => ({ u: p.u, v: p.v, scale: p.scale })),
        ...(obj.zone.scaleGradient ? { scaleGradient: obj.zone.scaleGradient } : {}),
        ...(obj.zone.useScaleGradient ? { useScaleGradient: true } : {}),
      },
    };
  },
};

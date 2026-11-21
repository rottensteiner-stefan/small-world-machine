import type { GltfJson } from "./types.js";
import { GltfBinaryParser } from "./GltfBinaryParser.js";
import type { Object3D } from "../../core/Object3D.js";
import type { TrackType, InterpolationType } from "../../core/animation/index.js";
import { AnimationClip, KeyframeTrack } from "../../core/animation/index.js";

/**
 * Parser for glTF animations, keyframe samplers, and tracks.
 */
export class GltfAnimationParser {
  /**
   * Parses glTF animation clips targeting the given node objects.
   */
  public static parseAnimations(
    json: GltfJson,
    buffers: ArrayBuffer[],
    nodeObjects: Object3D[],
  ): AnimationClip[] {
    if (!json.animations || !json.accessors) return [];
    const clips: AnimationClip[] = [];

    for (let a = 0; a < json.animations.length; a++) {
      const animDef = json.animations[a];
      if (!animDef) continue;
      const tracks: KeyframeTrack[] = [];

      for (const channel of animDef.channels) {
        if (channel.target.node === undefined) continue;
        const targetObj = nodeObjects[channel.target.node];
        if (!targetObj) continue;

        const sampler = animDef.samplers[channel.sampler];
        if (!sampler) continue;

        const timeRaw = GltfBinaryParser.getBufferData(
          json.accessors[sampler.input],
          json,
          buffers,
        );
        const valueRaw = GltfBinaryParser.getBufferData(
          json.accessors[sampler.output],
          json,
          buffers,
        );

        if (timeRaw && valueRaw) {
          const propPath = channel.target.path;
          if (
            propPath === "translation" ||
            propPath === "rotation" ||
            propPath === "scale" ||
            propPath === "weights"
          ) {
            const timeData = timeRaw instanceof Float32Array ? timeRaw : new Float32Array(timeRaw);
            const valueData =
              valueRaw instanceof Float32Array ? valueRaw : new Float32Array(valueRaw);
            const track = new KeyframeTrack(
              targetObj.name,
              propPath as TrackType,
              timeData,
              valueData,
              (sampler.interpolation as InterpolationType) || "LINEAR",
              targetObj,
            );
            tracks.push(track);
          }
        }
      }

      const clip = new AnimationClip(animDef.name || `Animation_${a}`, -1, tracks);
      clips.push(clip);
    }

    return clips;
  }
}

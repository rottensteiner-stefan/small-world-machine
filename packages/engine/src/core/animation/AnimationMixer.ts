import type { Object3D } from "../Object3D.js";
import { Quaternion } from "../../math/Quaternion.js";
import type { AnimationClip } from "./AnimationClip.js";
import { AnimationAction } from "./AnimationAction.js";

// Mixamo appends a session-dependent numeric suffix to its rig prefix ("mixamorig:" vs.
// "mixamorig1:", "mixamorig2:", ...) unrelated to which character was exported -- a mesh and an
// animation clip pulled from separate Mixamo export sessions can end up with different suffixes
// on what is otherwise the same joint name. Stripping it from both sides before comparing (rather
// than guessing a fixed list of candidate prefixes) matches regardless of either side's suffix.
const MIXAMO_RIG_PREFIX_RE = /^mixamorig\d*:/;

type VecProperty = "translation" | "scale";

interface VecBlendState {
  target: Object3D;
  property: VecProperty;
  x: number;
  y: number;
  z: number;
  w: number;
  si: number;
}

interface QuatBlendState {
  target: Object3D;
  q: Quaternion;
  total: number;
  si: number;
}

/**
 * The AnimationMixer is the player for animations on a particular object in the scene.
 */
export class AnimationMixer {
  public root: Object3D;
  private _actions: Map<AnimationClip, AnimationAction> = new Map();
  private _actionList: AnimationAction[] = [];
  private _bindings: Map<string, Object3D | undefined> = new Map();

  // Reused per-frame blend accumulators. Instead of building a fresh list of weighted samples per
  // track/frame, each touched target's state is folded in incrementally and a generation stamp
  // (`si !== _frameIndex`) tells whether this is the first contribution of the current `update()`
  // call. This keeps the hot path fully zero-allocation: states are created once and never cleared.
  private _frameIndex: number = 0;
  private _vecStateMap: Map<Object3D, { translation?: VecBlendState; scale?: VecBlendState }> =
    new Map();
  private _vecStateList: VecBlendState[] = [];
  private _quatStateMap: Map<Object3D, QuatBlendState> = new Map();
  private _quatStateList: QuatBlendState[] = [];

  constructor(root: Object3D) {
    this.root = root;
  }

  /**
   * Returns an AnimationAction for the passed clip.
   */
  public clipAction(clip: AnimationClip): AnimationAction {
    let action = this._actions.get(clip);
    if (!action) {
      action = new AnimationAction(this, clip);
      this._actions.set(clip, action);
      this._actionList.push(action);
    }
    return action;
  }

  /**
   * Stops all active actions on this mixer.
   */
  public stopAllAction(): this {
    const actionList = this._actionList;
    const len = actionList.length;
    for (let i = 0; i < len; i++) {
      actionList[i]!.stop();
    }
    return this;
  }

  /**
   * Advances the animation time and evaluates tracks. Actions targeting the same bone/property
   * simultaneously (e.g. during a crossfade) are blended by their relative `weight` rather than
   * having the last-evaluated action simply overwrite the others.
   * @param deltaTime Elapsed time in seconds.
   */
  public update(deltaTime: number): void {
    this._frameIndex++;
    const frameIndex = this._frameIndex;

    const actionList = this._actionList;
    const actionCount = actionList.length;
    for (let a = 0; a < actionCount; a++) {
      const action = actionList[a]!;
      if (!action.isPlaying || action.weight <= 0) continue;

      action.update(deltaTime);

      const tracks = action.clip.tracks;
      const trackCount = tracks.length;
      for (let i = 0; i < trackCount; i++) {
        const track = tracks[i];
        if (!track) continue;

        let target = this._bindings.get(track.targetName);
        if (target === undefined) {
          target = this.root.getObjectByName(track.targetName);
          if (!target) {
            const normalized = track.targetName.replace(MIXAMO_RIG_PREFIX_RE, "");
            target = this._findByNormalizedMixamoName(this.root, normalized);
          }
          this._bindings.set(track.targetName, target);
        }
        if (!target) continue;

        if ("rotation" === track.property) {
          const sampled = track.sampleQuaternion(action.time);
          let st = this._quatStateMap.get(target);
          if (!st) {
            st = { target, q: new Quaternion(), total: 0, si: 0 };
            this._quatStateMap.set(target, st);
            this._quatStateList.push(st);
          }
          if (st.si !== frameIndex) {
            // First contribution of this frame seeds the blend.
            st.q.copyFrom(sampled);
            st.total = action.weight;
            st.si = frameIndex;
          } else {
            // Incremental weighted slerp, folded in proportional to its share of the total.
            st.total += action.weight;
            st.q.slerp(sampled, action.weight / st.total);
          }
        } else {
          const sampled = track.sampleVector(action.time);
          const property = track.property as VecProperty;
          let byTarget = this._vecStateMap.get(target);
          if (!byTarget) {
            byTarget = {};
            this._vecStateMap.set(target, byTarget);
          }
          let st = byTarget[property];
          if (!st) {
            st = { target, property, x: 0, y: 0, z: 0, w: 0, si: 0 };
            byTarget[property] = st;
            this._vecStateList.push(st);
          }
          if (st.si !== frameIndex) {
            st.x = sampled.x * action.weight;
            st.y = sampled.y * action.weight;
            st.z = sampled.z * action.weight;
            st.w = action.weight;
            st.si = frameIndex;
          } else {
            st.x += sampled.x * action.weight;
            st.y += sampled.y * action.weight;
            st.z += sampled.z * action.weight;
            st.w += action.weight;
          }
        }
      }
    }

    const vecList = this._vecStateList;
    const vecCount = vecList.length;
    for (let i = 0; i < vecCount; i++) {
      const st = vecList[i]!;
      if (st.si !== frameIndex || st.w <= 0) continue;
      const dest = "translation" === st.property ? st.target.position : st.target.scale;
      const invW = 1 / st.w;
      dest.set(st.x * invW, st.y * invW, st.z * invW);
    }

    const quatList = this._quatStateList;
    const quatCount = quatList.length;
    for (let i = 0; i < quatCount; i++) {
      const st = quatList[i]!;
      if (st.si !== frameIndex) continue;
      st.target.quaternion = (st.target.quaternion || new Quaternion()).copyFrom(st.q);
    }
  }

  /** Last-resort target lookup for a track name that didn't match any node exactly, and whose
   * Mixamo rig prefix (if any) was already stripped into `normalized`. Walks the tree comparing
   * each node's own name with its rig prefix stripped the same way, so it matches regardless of
   * which numeric suffix (if any) the node's own name happens to carry -- see `MIXAMO_RIG_PREFIX_RE`'s
   * comment for why a fixed list of candidate prefixes isn't enough. */
  private _findByNormalizedMixamoName(node: Object3D, normalized: string): Object3D | undefined {
    if (node.name.replace(MIXAMO_RIG_PREFIX_RE, "") === normalized) return node;
    for (const child of node.children) {
      const found = this._findByNormalizedMixamoName(child, normalized);
      if (found) return found;
    }
    return undefined;
  }
}

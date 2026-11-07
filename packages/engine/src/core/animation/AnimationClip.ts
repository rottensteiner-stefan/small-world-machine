import type { KeyframeTrack } from "./KeyframeTrack.js";

/**
 * An AnimationClip holds a collection of KeyframeTracks representing an animation sequence.
 */
export class AnimationClip {
  public name: string;
  public duration: number;
  public tracks: KeyframeTrack[];

  constructor(name: string, duration: number = -1, tracks: KeyframeTrack[] = []) {
    this.name = name;
    this.tracks = tracks;

    if (duration < 0) {
      // Calculate max duration from tracks
      let maxDuration = 0;
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        if (track && track.times.length > 0) {
          const trackMax = track.times[track.times.length - 1]!;
          if (trackMax > maxDuration) {
            maxDuration = trackMax;
          }
        }
      }
      this.duration = maxDuration;
    } else {
      this.duration = duration;
    }
  }

  /**
   * Finds a track by target name and property.
   */
  public findTrack(targetName: string, property: string): KeyframeTrack | undefined {
    for (let i = 0; i < this.tracks.length; i++) {
      const track = this.tracks[i];
      if (track?.targetName === targetName && track?.property === property) {
        return track;
      }
    }
    return undefined;
  }
}

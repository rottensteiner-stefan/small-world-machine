import type { AnimationClip } from "./AnimationClip.js";
import type { AnimationMixer } from "./AnimationMixer.js";

/**
 * Controls the playback of a specific AnimationClip within an AnimationMixer.
 */
export class AnimationAction {
  public clip: AnimationClip;
  public mixer: AnimationMixer;

  public time: number = 0;
  public timeScale: number = 1.0;
  public weight: number = 1.0;
  public loop: boolean = true;
  public isPlaying: boolean = false;

  constructor(mixer: AnimationMixer, clip: AnimationClip) {
    this.mixer = mixer;
    this.clip = clip;
  }

  public play(): this {
    this.isPlaying = true;
    return this;
  }

  public stop(): this {
    this.isPlaying = false;
    this.reset();
    return this;
  }

  public pause(): this {
    this.isPlaying = false;
    return this;
  }

  public reset(): this {
    this.time = 0;
    return this;
  }

  public setLoop(loop: boolean): this {
    this.loop = loop;
    return this;
  }

  public update(deltaTime: number): void {
    if (!this.isPlaying || this.weight <= 0) return;

    this.time += deltaTime * this.timeScale;

    if (this.clip.duration > 0) {
      if (this.loop) {
        this.time = this.time % this.clip.duration;
        if (this.time < 0) {
          this.time += this.clip.duration;
        }
      } else {
        if (this.time > this.clip.duration) {
          this.time = this.clip.duration;
          this.isPlaying = false;
        } else if (this.time < 0) {
          this.time = 0;
          this.isPlaying = false;
        }
      }
    }
  }
}

import type { Vector3D } from "../math/index.js";
import { MathUtils } from "../math/index.js";
import type { CameraInterfaceData, Events } from "../interfaces/index.js";
import { EventType } from "../enums/index.js";
import type { SoundHandle } from "./SynthSFX.js";
import { SynthSFX } from "./SynthSFX.js";

/**
 * A basic Audio System that wraps the Web Audio API.
 * Supports loading sounds and playing them globally or spatially.
 */
export class AudioSystem {
  public context: AudioContext;
  private _buffers: Map<string, AudioBuffer> = new Map();

  // Audio Mixer Nodes
  public masterGain!: GainNode;
  public sfxGain!: GainNode;
  public musicGain!: GainNode;
  private _reverbNode!: ConvolverNode;
  private _reverbGain!: GainNode;

  /** Procedurally synthesized sound effects (no sample files needed) -- see `SynthSFX`. */
  private _synthSFX!: SynthSFX;

  /** Endless drone/fire graphs (`SynthSFX.startDrone`/`startFire`) still awaiting `stop()` --
   * tracked so `dispose()` can guarantee every one of them is torn down, even if the caller lost
   * or never held its handle. */
  private _activeEndlessSounds: Set<SoundHandle> = new Set();

  /** Optional per-instance event bus for non-fatal audio lifecycle events (e.g. `AUDIO_LOADED`).
   * Injected (never a global) by the owning `SmallWorldMachine` instance. */
  private readonly _events: Events | undefined;

  /**
   * @param context An `AudioContext` to use instead of creating one -- lets tests (and any code
   * that already owns a shared context) inject their own instead of relying on the global
   * `window.AudioContext`.
   * @param events An optional per-instance event bus on which non-fatal audio events (like
   * `AUDIO_LOADED`) are dispatched. Errors are deliberately **not** routed here -- `load()` throws
   * so callers keep an explicit failure path, consistent with the other loaders.
   */
  constructor(context?: AudioContext, events?: Events) {
    this._events = events;
    if (context) {
      this.context = context;
    } else {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.context = new AudioContextClass();
    }
    this._buildMixer();
    this._synthSFX = new SynthSFX(
      this.context,
      this.sfxGain,
      this.musicGain,
      this._reverbNode,
      () => this.resume(),
    );
  }

  private _buildMixer(): void {
    this.masterGain = this.context.createGain();
    this.sfxGain = this.context.createGain();
    this.musicGain = this.context.createGain();

    this.sfxGain.connect(this.masterGain);
    this.musicGain.connect(this.masterGain);
    this.masterGain.connect(this.context.destination);

    // Procedural Reverb (Dungeon Hall)
    this._reverbNode = this.context.createConvolver();
    this._reverbGain = this.context.createGain();
    this._reverbGain.gain.value = 0.3; // Default reverb level

    const rate = this.context.sampleRate;
    const length = rate * 2.0; // 2 seconds decay
    const impulse = this.context.createBuffer(2, length, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);
    for (let i = 0; i < length; i++) {
      const decay = Math.exp(-i / (rate * 0.5));
      left[i] = (Math.random() * 2 - 1) * decay;
      right[i] = (Math.random() * 2 - 1) * decay;
    }
    this._reverbNode.buffer = impulse;

    // Route SFX through reverb as a send effect
    this.sfxGain.connect(this._reverbNode);
    this._reverbNode.connect(this._reverbGain);
    this._reverbGain.connect(this.masterGain);
  }

  /** Set the global master volume (0.0 to 1.0) */
  public setMasterVolume(value: number): void {
    this.masterGain.gain.value = MathUtils.clamp(value, 0, 1);
  }
  /** Set the SFX volume (0.0 to 1.0) */
  public setSFXVolume(value: number): void {
    this.sfxGain.gain.value = MathUtils.clamp(value, 0, 1);
  }
  /** Set the Music volume (0.0 to 1.0) */
  public setMusicVolume(value: number): void {
    this.musicGain.gain.value = MathUtils.clamp(value, 0, 1);
  }
  /** Set the Reverb level (0.0 to 1.0) */
  public setReverbLevel(value: number): void {
    this._reverbGain.gain.value = MathUtils.clamp(value, 0, 1);
  }

  /** Must be called after a user interaction to resume the audio context on some browsers. */
  public resume(): void {
    if (this.context.state === "suspended") {
      this.context.resume().catch(console.error);
    }
  }

  /**
   * Loads an audio file and decodes it into a buffer.
   * @param url The URL of the audio file.
   * @param name The unique name to identify the sound.
   */
  public async load(url: string, name: string): Promise<void> {
    if (this._buffers.has(name)) return;
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
    this._buffers.set(name, audioBuffer);
    if (this._events) {
      this._events.dispatchEvent(EventType.AUDIO_LOADED, { name, url });
    }
  }

  /**
   * Plays a global (non-spatial) sound.
   */
  public play(
    name: string,
    loop: boolean = false,
    volume: number = 1.0,
  ): AudioBufferSourceNode | null {
    const buffer = this._buffers.get(name);
    if (!buffer) return null;

    this.resume();

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;

    const gainNode = this.context.createGain();
    gainNode.gain.value = volume;

    source.connect(gainNode);
    gainNode.connect(this.sfxGain);

    source.start(0);
    return source;
  }

  /**
   * Plays a global (non-spatial) music track through the music bus, so it responds to
   * `setMusicVolume()` independently of sound effects.
   */
  public playMusic(
    name: string,
    loop: boolean = true,
    volume: number = 1.0,
  ): AudioBufferSourceNode | null {
    const buffer = this._buffers.get(name);
    if (!buffer) return null;

    this.resume();

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;

    const gainNode = this.context.createGain();
    gainNode.gain.value = volume;

    source.connect(gainNode);
    gainNode.connect(this.musicGain);

    source.start(0);
    return source;
  }

  /**
   * Plays a 3D spatial sound at a given position.
   */
  public playSpatial(
    name: string,
    position: Vector3D,
    loop: boolean = false,
    volume: number = 1.0,
    refDistance: number = 2.0,
    maxDistance: number = 20.0,
  ): { source: AudioBufferSourceNode; panner: PannerNode } | null {
    const buffer = this._buffers.get(name);
    if (!buffer) return null;

    this.resume();

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;

    const panner = this.context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = refDistance;
    panner.maxDistance = maxDistance;
    panner.rolloffFactor = 1;

    if (panner.positionX) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } else {
      // Fallback for older browsers
      panner.setPosition(position.x, position.y, position.z);
    }

    const gainNode = this.context.createGain();
    gainNode.gain.value = volume;

    source.connect(panner);
    panner.connect(gainNode);
    gainNode.connect(this.sfxGain);

    source.start(0);
    return { source, panner };
  }

  /**
   * Updates the global listener position and orientation based on the camera.
   */
  public updateListener(camera: CameraInterfaceData): void {
    const listener = this.context.listener;

    const posX = camera.position.x;
    const posY = camera.position.y;
    const posZ = camera.position.z;

    // Calculate forward vector (assuming right-handed system: -Z is forward, but rotation depends on theta/phi)
    // SmallWorldMachine uses: theta for Y-axis rotation, phi for X-axis
    const sinTheta = Math.sin(camera.theta);
    const cosTheta = Math.cos(camera.theta);
    const sinPhi = Math.sin(camera.phi);
    const cosPhi = Math.cos(camera.phi);

    const forwardX = -sinTheta * cosPhi;
    const forwardY = sinPhi;
    const forwardZ = -cosTheta * cosPhi;

    const upX = 0;
    const upY = 1;
    const upZ = 0;

    if (listener.positionX) {
      listener.positionX.value = posX;
      listener.positionY.value = posY;
      listener.positionZ.value = posZ;
      listener.forwardX.value = forwardX;
      listener.forwardY.value = forwardY;
      listener.forwardZ.value = forwardZ;
      listener.upX.value = upX;
      listener.upY.value = upY;
      listener.upZ.value = upZ;
    } else {
      listener.setPosition(posX, posY, posZ);
      listener.setOrientation(forwardX, forwardY, forwardZ, upX, upY, upZ);
    }
  }

  /**
   * Starts a creepy, pulsing low-frequency background drone. See `SynthSFX.startDrone`. The drone
   * loops forever -- call `.stop()` on the returned handle to end it (also done automatically by
   * `dispose()`).
   */
  public startDrone(): SoundHandle {
    return this._trackEndlessSound(this._synthSFX.startDrone());
  }

  /**
   * Starts a procedural fire crackling noise at a specific 3D location. See `SynthSFX.startFire`.
   * The noise loops forever -- call `.stop()` on the returned handle to end it (also done
   * automatically by `dispose()`).
   */
  public startFire(position: Vector3D, volume: number = 1.0): SoundHandle {
    return this._trackEndlessSound(this._synthSFX.startFire(position, volume));
  }

  /** Wraps a raw `SynthSFX` handle so stopping it (directly or via `dispose()`) also drops it
   * from `_activeEndlessSounds`. */
  private _trackEndlessSound(handle: SoundHandle): SoundHandle {
    const tracked: SoundHandle = {
      stop: (): void => {
        handle.stop();
        this._activeEndlessSounds.delete(tracked);
      },
    };
    this._activeEndlessSounds.add(tracked);
    return tracked;
  }

  /**
   * Generates a retro synthesized footstep thud. See `SynthSFX.playFootstep`.
   */
  public playFootstep(): void {
    this._synthSFX.playFootstep();
  }

  /**
   * Generates a retro "Pew Pew" laser/gunshot sound. See `SynthSFX.playShoot`.
   */
  public playShoot(): void {
    this._synthSFX.playShoot();
  }

  /**
   * Generates a retro "Ugh!" hurt sound. See `SynthSFX.playHurt`.
   */
  public playHurt(): void {
    this._synthSFX.playHurt();
  }

  /**
   * Generates a procedural synth tone (e.g., for musical instruments or physical impacts).
   * See `SynthSFX.playTone`.
   * @param frequency The base frequency in Hz.
   * @param duration The duration of the tone in seconds.
   * @param volume The starting volume.
   * @param type The oscillator type.
   */
  public playTone(
    frequency: number = 440,
    duration: number = 0.5,
    volume: number = 0.5,
    type: OscillatorType = "sine",
  ): void {
    this._synthSFX.playTone(frequency, duration, volume, type);
  }

  /**
   * Plays a short one-shot burst of genuine white noise (impact "fuzz"/static crackle).
   * See `SynthSFX.playWhiteNoiseBurst`.
   * @param duration Seconds the burst plays for.
   * @param volume Peak burst volume (0..1).
   * @param centerFreq Center of the band-pass shaping the fuzz character.
   * @param q Band-pass resonance.
   */
  public playWhiteNoiseBurst(
    duration: number = 0.15,
    volume: number = 0.4,
    centerFreq: number = 1800,
    q: number = 1.0,
  ): void {
    this._synthSFX.playWhiteNoiseBurst(duration, volume, centerFreq, q);
  }

  /**
   * Stops every still-running endless sound (`startDrone`/`startFire` graphs) and closes the
   * `AudioContext`. Call this when tearing down the engine instance that owns this `AudioSystem`
   * -- without it, both the endless sound graphs and the context itself outlive the instance for
   * the lifetime of the page (browsers cap the number of concurrently open `AudioContext`s).
   */
  public dispose(): void {
    for (const handle of [...this._activeEndlessSounds]) {
      handle.stop();
    }
    this._activeEndlessSounds.clear();

    if (this.context.state !== "closed") {
      this.context.close().catch(console.error);
    }
  }
}

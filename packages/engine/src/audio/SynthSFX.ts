import { Vector3D } from "../math/index.js";

/** A handle to an endlessly-looping/never-auto-stopping sound graph, returned so its caller can
 * later tear it down. Unlike the one-shot `playX()` methods (which schedule their own `stop()`
 * and rely on the Web Audio spec's automatic cleanup of ended, unreferenced source nodes), the
 * graphs behind this handle never end on their own -- `stop()` is the only way to release them. */
export interface SoundHandle {
  /** Stops every source node and disconnects the whole graph. Safe to call more than once. */
  stop(): void;
}

/**
 * Procedurally synthesized sound effects built directly from Web Audio oscillator/noise graphs
 * (no sample files needed). Kept separate from `AudioSystem` itself, which owns the actual mixer
 * graph and sample playback -- this class only ever reads from the nodes it's given, it doesn't
 * manage them.
 */
export class SynthSFX {
  /**
   * @param _context The shared Web Audio context.
   * @param _sfxGain The SFX bus every generated sound is routed into.
   * @param _musicGain The music bus (used by `startDrone`, which is more music-bed than SFX).
   * @param _reverbNode The shared reverb send.
   * @param _resume Called before generating a sound, to resume the context on browsers that
   * suspend it until a user interaction.
   */
  constructor(
    private readonly _context: AudioContext,
    private readonly _sfxGain: GainNode,
    private readonly _musicGain: GainNode,
    private readonly _reverbNode: ConvolverNode,
    private readonly _resume: () => void,
  ) {}

  /**
   * Starts a creepy, pulsing low-frequency background drone using the Web Audio API. The drone
   * loops forever until `stop()` is called on the returned handle -- there is no natural end.
   */
  public startDrone(): SoundHandle {
    this._resume();

    // 1. GIGANTIC SUB-BASS (The Black Hole's mass)
    const subOsc = this._context.createOscillator();
    subOsc.type = "sine";
    subOsc.frequency.value = 42; // Deep rumble

    const subOsc2 = this._context.createOscillator();
    subOsc2.type = "triangle";
    subOsc2.frequency.value = 43.5; // Beating effect for slow pulsing

    // 2. GHOSTLY CHOIR / DRONE (Atonal minor 9th cluster)
    // We create a very slow, hollow pad sound using a few sine waves
    const pad1 = this._context.createOscillator();
    pad1.type = "sine";
    pad1.frequency.value = 110; // A2

    const pad2 = this._context.createOscillator();
    pad2.type = "sine";
    pad2.frequency.value = 164.81; // E3 (Perfect 5th)

    const pad3 = this._context.createOscillator();
    pad3.type = "sine";
    pad3.frequency.value = 233.08; // Bb3 (Minor 9th, creates dark dissonance)

    // 3. BROWN NOISE (Cosmic Wind)
    const bufferSize = this._context.sampleRate * 2;
    const noiseBuffer = this._context.createBuffer(1, bufferSize, this._context.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      let u1 = Math.random();
      const u2 = Math.random();
      if (u1 === 0) u1 = 1e-7;
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      output[i] = Math.max(-1.0, Math.min(1.0, z0 * 0.25));
    }
    const noiseSrc = this._context.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    noiseSrc.loop = true;

    // 4. BREATHING LOWPASS FILTER (LFO Modulation)
    // Instead of a static bandpass, we use a lowpass that opens and closes
    const windFilter = this._context.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 250; // Base cutoff
    windFilter.Q.value = 2.0; // Adds a slight resonant whistle

    const windLFO = this._context.createOscillator();
    windLFO.type = "sine";
    windLFO.frequency.value = 0.05; // 20-second cycle! "Breathing"

    const windLFOGain = this._context.createGain();
    windLFOGain.gain.value = 200; // Modulates cutoff by +/- 200Hz

    windLFO.connect(windLFOGain);
    windLFOGain.connect(windFilter.frequency);

    // 5. MIXING GAINS
    const subGain = this._context.createGain();
    subGain.gain.value = 0.8;

    const padGain = this._context.createGain();
    padGain.gain.value = 0.05; // Extremely quiet, ghostly presence

    const windGain = this._context.createGain();
    windGain.gain.value = 0.6; // Prominent, but softened by lowpass

    const mainGain = this._context.createGain();
    mainGain.gain.value = 0.8;

    // 6. ROUTING
    subOsc.connect(subGain);
    subOsc2.connect(subGain);
    subGain.connect(mainGain);

    pad1.connect(padGain);
    pad2.connect(padGain);
    pad3.connect(padGain);
    padGain.connect(mainGain);

    noiseSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(mainGain);

    // 7. ENDLESS VOID (Reverb)
    mainGain.connect(this._reverbNode);
    // Add a tiny bit of dry signal to keep the rumble punchy
    mainGain.connect(this._musicGain);

    // 8. START THE ENGINES
    subOsc.start();
    subOsc2.start();
    pad1.start();
    pad2.start();
    pad3.start();
    noiseSrc.start();
    windLFO.start();

    const sources: (OscillatorNode | AudioBufferSourceNode)[] = [
      subOsc,
      subOsc2,
      pad1,
      pad2,
      pad3,
      noiseSrc,
      windLFO,
    ];
    const nodes: AudioNode[] = [
      ...sources,
      windLFOGain,
      windFilter,
      subGain,
      padGain,
      windGain,
      mainGain,
    ];

    let stopped = false;
    return {
      stop: (): void => {
        if (stopped) return;
        stopped = true;
        for (const source of sources) {
          try {
            source.stop();
          } catch {
            // Already stopped/ended -- nothing left to do for this node.
          }
        }
        for (const node of nodes) {
          node.disconnect();
        }
      },
    };
  }

  /**
   * Starts a procedural fire crackling noise at a specific 3D location. The noise loops forever
   * until `stop()` is called on the returned handle -- there is no natural end.
   */
  public startFire(position: Vector3D, volume: number = 1.0): SoundHandle {
    this._resume();

    const bufferSize = this._context.sampleRate * 2; // 2 seconds of noise
    const buffer = this._context.createBuffer(1, bufferSize, this._context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = this._context.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;

    // Filter to make it sound like fire (lowpass for rumble, bandpass for crackle)
    const filter = this._context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;

    const panner = this._context.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1.0;
    panner.maxDistance = 15.0;
    panner.rolloffFactor = 1.5;

    if (panner.positionX) {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } else {
      panner.setPosition(position.x, position.y, position.z);
    }

    const gainNode = this._context.createGain();
    gainNode.gain.value = volume;

    noiseSource.connect(filter);
    filter.connect(panner);
    panner.connect(gainNode);
    gainNode.connect(this._sfxGain);

    noiseSource.start(0);

    const nodes: AudioNode[] = [noiseSource, filter, panner, gainNode];
    let stopped = false;
    return {
      stop: (): void => {
        if (stopped) return;
        stopped = true;
        try {
          noiseSource.stop();
        } catch {
          // Already stopped/ended -- nothing left to do.
        }
        for (const node of nodes) {
          node.disconnect();
        }
      },
    };
  }

  /**
   * Generates a retro synthesized footstep thud.
   */
  public playFootstep(): void {
    this._resume();
    const osc = this._context.createOscillator();
    osc.type = "sine";

    // Quick pitch drop for a thud
    osc.frequency.setValueAtTime(150, this._context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.01, this._context.currentTime + 0.1);

    const gain = this._context.createGain();
    gain.gain.setValueAtTime(0.3, this._context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this._context.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this._sfxGain);

    osc.start();
    osc.stop(this._context.currentTime + 0.1);
  }

  /**
   * Generates a retro "Pew Pew" laser/gunshot sound.
   */
  public playShoot(): void {
    this._resume();
    const osc = this._context.createOscillator();
    osc.type = "square";

    // Classic laser pitch drop
    osc.frequency.setValueAtTime(880, this._context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, this._context.currentTime + 0.15);

    const gain = this._context.createGain();
    gain.gain.setValueAtTime(0.4, this._context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this._context.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(this._sfxGain);

    osc.start();
    osc.stop(this._context.currentTime + 0.15);
  }

  /**
   * Generates a retro "Ugh!" hurt sound.
   */
  public playHurt(): void {
    this._resume();
    const osc = this._context.createOscillator();
    osc.type = "sawtooth";

    // Quick grunting pitch drop
    osc.frequency.setValueAtTime(250, this._context.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, this._context.currentTime + 0.3);

    const gain = this._context.createGain();
    gain.gain.setValueAtTime(0.6, this._context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this._context.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(this._sfxGain);

    osc.start();
    osc.stop(this._context.currentTime + 0.3);
  }

  /**
   * Generates a procedural synth tone (e.g., for musical instruments or physical impacts).
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
    this._resume();
    const osc = this._context.createOscillator();
    osc.type = type;

    osc.frequency.setValueAtTime(frequency, this._context.currentTime);

    const gain = this._context.createGain();
    // Quick attack, exponential decay for a percussive strike
    gain.gain.setValueAtTime(volume, this._context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this._context.currentTime + duration);

    osc.connect(gain);
    gain.connect(this._sfxGain);

    osc.start();
    osc.stop(this._context.currentTime + duration);
  }

  /**
   * Plays a short one-shot burst of genuine white noise (an impact "fuzz"/static crackle).
   * Band-passed and enveloped so impacts read as gritty static instead of a broadband rumble,
   * and tuned by the caller per-event via `centerFreq`/`q`. Unlike `startFire` this is a
   * fire-and-forget burst that stops and auto-cleans on its own.
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
    this._resume();

    const start = this._context.currentTime;
    const bufferSize = Math.max(1, Math.floor(duration * this._context.sampleRate));
    const buffer = this._context.createBuffer(1, bufferSize, this._context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      // True white noise, kept at half amplitude so later gain stages never clip.
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }

    const source = this._context.createBufferSource();
    source.buffer = buffer;

    const filter = this._context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = centerFreq;
    filter.Q.value = q;

    const gain = this._context.createGain();
    // Quick attack, exponential decay -- a percussive crackle without a click.
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this._sfxGain);

    source.start();
    source.stop(start + duration);
  }
}

import type { Mock } from "vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SynthSFX, Vector3D } from "../../src/index.js";
import { makeMockAudioContext } from "./mockAudioContext.js";

describe("SynthSFX", () => {
  let context: AudioContext;
  let resume: Mock<() => void>;
  let sfx: SynthSFX;

  beforeEach(() => {
    context = makeMockAudioContext();
    resume = vi.fn<() => void>();
    const sfxGain = context.createGain();
    const musicGain = context.createGain();
    const reverbNode = context.createConvolver();
    sfx = new SynthSFX(context, sfxGain, musicGain, reverbNode, resume);
  });

  it("should call resume before generating any sound", () => {
    sfx.playTone();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("should play a tone with the given frequency, duration, and oscillator type", () => {
    sfx.playTone(880, 0.2, 0.6, "square");
    expect(context.createOscillator).toHaveBeenCalledTimes(1);

    const osc = (context.createOscillator as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    expect(osc.type).toBe("square");
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(880, context.currentTime);
    expect(osc.start).toHaveBeenCalledTimes(1);
    expect(osc.stop).toHaveBeenCalledWith(context.currentTime + 0.2);
  });

  it("should default to a sine tone at 440Hz for half a second", () => {
    sfx.playTone();
    const osc = (context.createOscillator as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    expect(osc.type).toBe("sine");
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(440, context.currentTime);
    expect(osc.stop).toHaveBeenCalledWith(context.currentTime + 0.5);
  });

  it("should generate a footstep as a short sine thud", () => {
    sfx.playFootstep();
    const osc = (context.createOscillator as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    expect(osc.type).toBe("sine");
    expect(osc.stop).toHaveBeenCalledWith(context.currentTime + 0.1);
  });

  it("should generate a shoot sound as a square wave pitch drop", () => {
    sfx.playShoot();
    const osc = (context.createOscillator as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    expect(osc.type).toBe("square");
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(880, context.currentTime);
  });

  it("should generate a hurt sound as a sawtooth wave", () => {
    sfx.playHurt();
    const osc = (context.createOscillator as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    expect(osc.type).toBe("sawtooth");
  });

  it("should start looping noise at the given 3D position for fire", () => {
    sfx.startFire(new Vector3D(1, 2, 3), 0.5);

    expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    const noiseSource = (context.createBufferSource as ReturnType<typeof vi.fn>).mock.results[0]!
      .value;
    expect(noiseSource.loop).toBe(true);
    expect(noiseSource.start).toHaveBeenCalledWith(0);

    const panner = (context.createPanner as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    expect(panner.positionX.value).toBe(1);
    expect(panner.positionY.value).toBe(2);
    expect(panner.positionZ.value).toBe(3);
  });

  it("should start multiple oscillators and a looping noise buffer for the drone", () => {
    sfx.startDrone();

    // 5 oscillators: subOsc, subOsc2, pad1, pad2, pad3, windLFO = 6 total
    expect(context.createOscillator).toHaveBeenCalledTimes(6);
    expect(context.createBufferSource).toHaveBeenCalledTimes(1);

    const noiseSrc = (context.createBufferSource as ReturnType<typeof vi.fn>).mock.results[0]!
      .value;
    expect(noiseSrc.loop).toBe(true);
    expect(noiseSrc.start).toHaveBeenCalledTimes(1);
  });
});

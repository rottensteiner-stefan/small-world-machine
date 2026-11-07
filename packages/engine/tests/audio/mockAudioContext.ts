import { vi } from "vitest";

/**
 * A minimal, hand-rolled stand-in for the Web Audio API's `AudioContext` -- there's no real
 * implementation available in the Node test environment. Every node factory returns a plain
 * object shaped enough to satisfy `AudioSystem`/`SynthSFX`'s actual usage (connect/start/stop,
 * plus spy-able `AudioParam`-like `.value`/`setValueAtTime`/`exponentialRampToValueAtTime`
 * sub-objects), not a full spec-accurate mock.
 */
function makeAudioParam(initial = 0): {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
} {
  return {
    value: initial,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

export function makeMockAudioContext(): AudioContext {
  const context = {
    sampleRate: 44100,
    currentTime: 0,
    state: "running" as AudioContextState,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),

    createGain: vi.fn(() => ({
      gain: makeAudioParam(1),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),

    createBufferSource: vi.fn(() => ({
      buffer: null,
      loop: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),

    createPanner: vi.fn(() => ({
      panningModel: "",
      distanceModel: "",
      refDistance: 0,
      maxDistance: 0,
      rolloffFactor: 0,
      positionX: makeAudioParam(0),
      positionY: makeAudioParam(0),
      positionZ: makeAudioParam(0),
      setPosition: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),

    createConvolver: vi.fn(() => ({
      buffer: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),

    createBiquadFilter: vi.fn(() => ({
      type: "",
      frequency: makeAudioParam(0),
      Q: makeAudioParam(0),
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),

    createOscillator: vi.fn(() => ({
      type: "sine" as OscillatorType,
      frequency: makeAudioParam(0),
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),

    createBuffer: vi.fn((numChannels: number, length: number) => ({
      getChannelData: vi.fn(() => new Float32Array(length)),
      numChannels,
    })),

    decodeAudioData: vi.fn(() => Promise.resolve({ duration: 1 })),

    listener: {
      positionX: makeAudioParam(0),
      positionY: makeAudioParam(0),
      positionZ: makeAudioParam(0),
      forwardX: makeAudioParam(0),
      forwardY: makeAudioParam(0),
      forwardZ: makeAudioParam(0),
      upX: makeAudioParam(0),
      upY: makeAudioParam(0),
      upZ: makeAudioParam(0),
      setPosition: vi.fn(),
      setOrientation: vi.fn(),
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return context as any as AudioContext;
}

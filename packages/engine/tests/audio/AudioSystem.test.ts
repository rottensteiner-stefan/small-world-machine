import { describe, it, expect, vi, beforeEach } from "vitest";
import { AudioSystem, Vector3D } from "../../src/index.js";
import { makeMockAudioContext } from "./mockAudioContext.js";

describe("AudioSystem", () => {
  let context: AudioContext;
  let audio: AudioSystem;

  beforeEach(() => {
    context = makeMockAudioContext();
    audio = new AudioSystem(context);
  });

  it("should build the mixer graph on construction", () => {
    expect(context.createGain).toHaveBeenCalledTimes(4); // master, sfx, music, reverb send
    expect(audio.masterGain).toBeDefined();
    expect(audio.sfxGain).toBeDefined();
    expect(audio.musicGain).toBeDefined();
  });

  it("should clamp master volume between 0 and 1", () => {
    audio.setMasterVolume(0.5);
    expect(audio.masterGain.gain.value).toBe(0.5);
    audio.setMasterVolume(5);
    expect(audio.masterGain.gain.value).toBe(1);
    audio.setMasterVolume(-5);
    expect(audio.masterGain.gain.value).toBe(0);
  });

  it("should clamp SFX and music volume between 0 and 1", () => {
    audio.setSFXVolume(2);
    expect(audio.sfxGain.gain.value).toBe(1);
    audio.setMusicVolume(-1);
    expect(audio.musicGain.gain.value).toBe(0);
  });

  it("should resume a suspended context", () => {
    (context as unknown as { state: string }).state = "suspended";
    audio.resume();
    expect(context.resume).toHaveBeenCalledTimes(1);
  });

  it("should not resume a running context", () => {
    audio.resume();
    expect(context.resume).not.toHaveBeenCalled();
  });

  it("should return null when playing a sound that was never loaded", () => {
    expect(audio.play("does-not-exist")).toBeNull();
  });

  it("should return null when playing a spatial sound that was never loaded", () => {
    expect(audio.playSpatial("does-not-exist", new Vector3D())).toBeNull();
  });

  it("should load and play a sound", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      }),
    ) as unknown as typeof fetch;

    await audio.load("./explosion.wav", "explosion");
    const source = audio.play("explosion", true, 0.5);

    expect(source).not.toBeNull();
    expect(context.createBufferSource).toHaveBeenCalled();
  });

  it("should not re-fetch a sound that's already loaded", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      }),
    ) as unknown as typeof fetch;

    await audio.load("./explosion.wav", "explosion");
    await audio.load("./explosion.wav", "explosion");

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("should dispatch AUDIO_LOADED on the injected bus after a successful load", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    ) as unknown as typeof fetch;
    const events: import("../../src/index.js").Events = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    const subscribed = new AudioSystem(makeMockAudioContext(), events);

    await subscribed.load("./explosion.wav", "boom");

    expect(events.dispatchEvent).toHaveBeenCalledWith(
      "AudioLoaded",
      expect.objectContaining({ name: "boom", url: "./explosion.wav" }),
    );
  });

  it("should reject a failed download with the URL instead of decoding the error page", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      }),
    ) as unknown as typeof fetch;

    await expect(audio.load("./missing.mp3", "missing")).rejects.toThrow("./missing.mp3: HTTP 404");
    expect(context.decodeAudioData).not.toHaveBeenCalled();
  });

  it("should propagate a failed decode to the caller instead of swallowing it", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    ) as unknown as typeof fetch;
    vi.mocked(context.decodeAudioData).mockRejectedValueOnce(new Error("bad audio"));

    await expect(audio.load("./broken.wav", "broken")).rejects.toThrow("bad audio");
  });

  it("should play a spatial sound with the given position", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    ) as unknown as typeof fetch;

    await audio.load("./explosion.wav", "explosion");
    const result = audio.playSpatial("explosion", new Vector3D(1, 2, 3));

    expect(result).not.toBeNull();
    expect(result?.panner.positionX.value).toBe(1);
    expect(result?.panner.positionY.value).toBe(2);
    expect(result?.panner.positionZ.value).toBe(3);
  });

  it("should update the listener position from the camera", () => {
    const camera = {
      position: new Vector3D(1, 2, 3),
      theta: 0,
      phi: 0,
    } as unknown as import("../../src/index.js").CameraInterfaceData;

    audio.updateListener(camera);

    const listener = context.listener;
    expect(listener.positionX.value).toBe(1);
    expect(listener.positionY.value).toBe(2);
    expect(listener.positionZ.value).toBe(3);
    // theta = phi = 0 -> forward should be (0, 0, -1) (looking down -Z)
    expect(listener.forwardX.value).toBeCloseTo(0);
    expect(listener.forwardY.value).toBeCloseTo(0);
    expect(listener.forwardZ.value).toBeCloseTo(-1);
  });

  it("should delegate SynthSFX calls without throwing", () => {
    expect(() => audio.playTone(440, 0.1, 0.5, "sine")).not.toThrow();
    expect(() => audio.playFootstep()).not.toThrow();
    expect(() => audio.playShoot()).not.toThrow();
    expect(() => audio.playHurt()).not.toThrow();
    expect(() => audio.startFire(new Vector3D())).not.toThrow();
    expect(() => audio.startDrone()).not.toThrow();
  });

  describe("endless sound lifecycle (startDrone/startFire leak fix)", () => {
    function oscillatorMocks(): { stop: ReturnType<typeof vi.fn> }[] {
      return (context.createOscillator as ReturnType<typeof vi.fn>).mock.results.map(
        (r) => r.value,
      );
    }
    function bufferSourceMocks(): { stop: ReturnType<typeof vi.fn> }[] {
      return (context.createBufferSource as ReturnType<typeof vi.fn>).mock.results.map(
        (r) => r.value,
      );
    }

    it("startDrone() returns a handle whose stop() stops every oscillator/noise source it created", () => {
      const handle = audio.startDrone();
      const oscillators = oscillatorMocks();
      const buffers = bufferSourceMocks();
      expect(oscillators.length).toBeGreaterThan(0);
      expect(buffers.length).toBeGreaterThan(0);

      handle.stop();

      for (const osc of oscillators) expect(osc.stop).toHaveBeenCalledTimes(1);
      for (const buf of buffers) expect(buf.stop).toHaveBeenCalledTimes(1);
    });

    it("startDrone()'s handle.stop() is idempotent -- calling it twice does not stop nodes twice", () => {
      const handle = audio.startDrone();
      const [firstOscillator] = oscillatorMocks();

      handle.stop();
      handle.stop();

      expect(firstOscillator!.stop).toHaveBeenCalledTimes(1);
    });

    it("startFire() returns a handle whose stop() stops the noise source it created", () => {
      const handle = audio.startFire(new Vector3D());
      const [noiseSource] = bufferSourceMocks();

      handle.stop();

      expect(noiseSource!.stop).toHaveBeenCalledTimes(1);
    });

    it("dispose() stops every still-active drone/fire sound even if the caller never called stop()", () => {
      audio.startDrone();
      audio.startFire(new Vector3D());
      const oscillators = oscillatorMocks();
      const buffers = bufferSourceMocks();

      audio.dispose();

      for (const osc of oscillators) expect(osc.stop).toHaveBeenCalledTimes(1);
      for (const buf of buffers) expect(buf.stop).toHaveBeenCalledTimes(1);
    });

    it("dispose() does not double-stop a sound the caller already stopped itself", () => {
      const handle = audio.startFire(new Vector3D());
      const [noiseSource] = bufferSourceMocks();
      handle.stop();

      audio.dispose();

      expect(noiseSource!.stop).toHaveBeenCalledTimes(1);
    });

    it("dispose() closes the AudioContext", () => {
      audio.dispose();
      expect(context.close).toHaveBeenCalledTimes(1);
    });

    it("dispose() does not try to close an already-closed context", () => {
      (context as unknown as { state: string }).state = "closed";
      audio.dispose();
      expect(context.close).not.toHaveBeenCalled();
    });
  });
});

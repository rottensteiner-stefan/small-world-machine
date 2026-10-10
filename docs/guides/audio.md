# Audio

The Small World Machine ships a lightweight `AudioSystem` that wraps the Web Audio API: sample loading and playback (global or 3D-spatial), a small mixer (master/SFX/music buses plus a send-effect reverb), camera-synced listener positioning, and a set of procedurally synthesized sound effects that need no audio assets at all.

## Accessing the Audio System

Like the render and physics systems, `AudioSystem` is instance-bound - every `SmallWorldMachine` application gets its own via `this.audio`, so multiple engine instances on one page (editors, minimaps, split-screen) never share audio state.

```typescript
// Inside a SmallWorldMachine subclass
protected override async setupScene(): Promise<void> {
  await this.audio.load("./assets/explosion.wav", "explosion");
}
```

Since browsers suspend the `AudioContext` until a user gesture, call `this.audio.resume()` (or simply play a sound - every playback method calls it internally) from a click/keydown handler before audio is expected to be audible.

## Loading and Playing Samples

`load(url, name)` loads and decodes a file once and caches it under `name` for repeated playback.

```typescript
await this.audio.load("./assets/explosion.wav", "explosion");

// Global (non-spatial) playback
this.audio.play("explosion", /* loop */ false, /* volume */ 0.8);
```

For sounds that should be attenuated and panned based on 3D position, use `playSpatial` instead:

```typescript
this.audio.playSpatial("explosion", enemy.position, false, 1.0, /* refDistance */ 2.0, /* maxDistance */ 20.0);
```

`playSpatial` uses an HRTF `PannerNode` with inverse distance falloff. Both methods return the underlying `AudioBufferSourceNode` (and, for spatial sounds, the `PannerNode`), so the running instance can be stopped or otherwise inspected itself - the engine does not track active voices on its own.

## The Mixer

Every sound plays through one of two gain buses, both routed into a master bus:

- `sfxGain` - sound effects (`play`, `playSpatial`, and all `SynthSFX` methods except `startDrone`).
- `musicGain` - background music/ambience.

A single procedural reverb (a fixed 2-second decay impulse, generated at startup) is wired as a send effect on the SFX bus. Adjust levels with:

```typescript
this.audio.setMasterVolume(0.9);
this.audio.setSFXVolume(0.8);
this.audio.setMusicVolume(0.5);
this.audio.setReverbLevel(0.3); // 0 = dry, higher = more reverb send
```

::: tip Direct API & EventBus Control
These four setters directly configure the instance's Web Audio gain nodes. For UI controls, wire them directly to your settings UI, or listen for your own events on your engine instance's `this.events` bus.
:::

## Listener Position (3D Audio)

Spatial audio needs to know where the "ears" are. Synchronize the Web Audio listener with the camera once per frame:

```typescript
protected override update(deltaTime: number): void {
  this.audio.updateListener(this.camera);
  // ...the rest of your game logic
}
```

This does not happen automatically - the engine does not assume audio should always follow the main camera (for example, a spectator camera or a minimap camera shouldn't necessarily move the listener), so call it explicitly from wherever the "ears" actually are.

## Procedural Sound Effects (No Assets Needed)

For rapid prototyping, retro feedback, or ambience that doesn't need a hand-crafted sample, `AudioSystem` also provides a handful of Web-Audio-synthesized effects (implemented in `SynthSFX`, individually importable if you want to build your own):

```typescript
this.audio.playTone(880, 0.15, 0.4, "square"); // A short "laser" blip
this.audio.playFootstep();
this.audio.playShoot();
this.audio.playHurt();
this.audio.startFire(torch.position, 0.4); // Looping crackle at a 3D position
this.audio.startDrone(); // Ambient sub-bass + noise bed, routed to the music bus
```

These are pure oscillator/noise graphs - no network request, no decoding step, and safe to call before any asset has been loaded.

## Limitations

- No built-in voice limiting or pooling: rapidly retriggering the same sound (e.g. a very fast weapon) creates a new `AudioBufferSourceNode` per call, with no cap.
- Only one reverb preset exists; there is no API for swapping in a different impulse response per room.
- No music crossfade/ducking helpers - layering or transitioning between music tracks is left to the caller (manually cross-fade the two `GainNode`s, or route through your own intermediate gain).

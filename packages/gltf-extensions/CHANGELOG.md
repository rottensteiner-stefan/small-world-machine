# Changelog - @small-world-machine/gltf-extensions

All notable changes to this package will be documented in this file.
This package adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-11-22

- **Added:** Tier-aware and device-aware block-compression format selection (`BlockFormatCapabilities`, `detectBestBlockFormatForCapabilities`) covering WebGPU, WebGL2, and WebGL1 without cross-tier downgrade.
- **Added:** `resetCachedBlockFormat()` for multi-context hosts and isolated unit testing.
- **Changed:** Aligned package versioning to independent semantic versioning starting at `0.1.1`.

## [0.1.0] - 2026-11-07

- **Added:** Initial modular release of Small World Machine glTF extensions.
- **Added:** `KHR_draco_mesh_compression` loader with WebAssembly decoder integration.
- **Added:** `KHR_texture_basisu` loader with KTX2 / Basis Universal transcoder (BC7, ASTC, ETC2, BC3, RGBA8 fallback).
- **Added:** Extension registration entry point via `@small-world-machine/gltf-extensions/register`.

# Headless WebGPU/WebGL2 in CI & Containern

**Datum/Quelle:** vom User vermitteltes Wissen (2026-10-07).

**Fakt:** WebGPU **und** WebGL2 laufen inzwischen vollkommen headless in CI- und
Container-Umgebungen — ohne Display/Xvfb — über:

- Chrome **headless** mit den Flags:
  - `--enable-unsafe-webgpu`
  - `--enable-features=Vulkan`
- sowie dem **SwiftShader/Vulkan-Software-Backend** als Rendering-Backend (CPU-Fallback).

**Konsequenz für Small World Machine:** Damit sind echte GPU-Pipeline-Tests (
WebGL2- und WebGPU-Pfade) in CI/Containern möglich, ohne eine echte GPU oder einen
virtuellen Display (wie `xvfb-run`). Kein `--use-gl=swiftshader`-Hack o.ä. mehr nötig.

> Anmerkung: exakte Chrome-Version/Fleet-Kombination (Flags + SwiftShader/Vulkan-Backend) als
> Goldene-Baseline für künftige CI-Setups dokumentieren, sobald ein solches eingerichtet wird.

# Showcase 27 – Shadow Sanctuary – Dev Log

Living log. Newest entries at the bottom, nothing is deleted.

## 2026-10-17 – Volumetric fog with shadowed spot shafts

- The scene now runs the volumetric fog (`density` 0.1, `heightFalloff` 0, `ambientInject` 0.5): the two moving shadow-casting key spots (`volumetricIntensity` 22) cut visible shafts out of the mist, and the columns, the orbiting octahedron and the central structure carve dark wedges into the cones (`VolumetricFogElement.localLightShadows`, on by default, WebGPU and WebGL2).
- QA hook `window.__showcase27` (same convention as 28/39) so `scripts/check-fog-capture.js --showcases 27` can hash frames; it is deterministic on WebGL1/WebGL2/WebGPU but needs `RUN_TIMEOUT_MS=300000` (heavy scene on a software GPU).
- Verified the shadow path with a test plate reparented to the scene root under the key spot: mean brightness with fog shadows on / off was 69 / 110 on WebGPU and 57 / 100 on WebGL2; without the plate on and off were equal (110 / 110 on WebGPU), so there are no phantom shadows. A plate parented to a pillar silently used the pillar's local coordinates in the first attempts, which made early tests look like a bug.

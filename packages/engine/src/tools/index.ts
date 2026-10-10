export * from "./IBLShaders.js";
export * from "./ibl-gen.js";
export * from "./ibl-gen-core.js";
export * from "./forge/ForgeTool.js";
export * from "./procgen/index.js";

// The concrete dev tools (Maker, MaterialStudio, MapGenerator, Pixler, Xtractor) and the Forge
// window manager live in the separate `@small-world-machine/tools` package (ADR 0024) -- the engine core
// only ships the `ForgeTool` extension point above. Import them from `@small-world-machine/tools` if you
// need them; use `attachDevTools(app)` from that package to wire the standard dev-tool suite into
// a running `SmallWorldMachine` app (this used to be hardcoded here behind `config.enableInspector`).

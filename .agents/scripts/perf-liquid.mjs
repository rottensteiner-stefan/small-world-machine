import { performance } from "perf_hooks";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../../dist/small-world-machine.js");

if (!fs.existsSync(distPath)) {
  console.log("📦 dist/small-world-machine.js not found. Running build:lib first...");
  const { execSync } = await import("child_process");
  execSync("npm run build:lib", { stdio: "inherit" });
}

const {
  FluidSurfaceMaterial,
  LavaMaterial,
  SlimeMaterial,
  OpenWaterMaterial,
  StylizedWaterMaterial,
  Object3D,
  MathPool,
  UniformPacker,
  ShaderBootstrap,
  ShaderRegistry,
} = await import("../dist/small-world-machine.js");

async function runBenchmarks() {
  console.log("🌊 ========================================================");
  console.log("🌊 Small World Machine - Liquid Materials & Packing Perf Benchmark");
  console.log("🌊 ========================================================\n");

  const shaderRegistry = new ShaderRegistry();
  await ShaderBootstrap.init(shaderRegistry);

  const materials = [
    { name: "FluidSurfaceMaterial", instance: new FluidSurfaceMaterial() },
    { name: "LavaMaterial", instance: new LavaMaterial() },
    { name: "SlimeMaterial", instance: new SlimeMaterial() },
    { name: "OpenWaterMaterial", instance: new OpenWaterMaterial() },
    { name: "StylizedWaterMaterial", instance: new StylizedWaterMaterial() },
  ];

  const WARMUP_ITERS = 50_000;
  const BENCH_ITERS = 500_000;

  // 1. Benchmark getRenderManifest()
  console.log(`⏱️  [1/3] Benchmarking getRenderManifest() (${BENCH_ITERS.toLocaleString()} iterations)...`);
  const manifestResults = [];

  for (const { name, instance } of materials) {
    // Warmup
    for (let i = 0; i < WARMUP_ITERS; i++) {
      instance.time += 0.016;
      instance.getRenderManifest();
    }

    if (global.gc) global.gc();
    const memBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    for (let i = 0; i < BENCH_ITERS; i++) {
      instance.time += 0.016;
      instance.getRenderManifest();
    }

    const durationMs = performance.now() - start;
    if (global.gc) global.gc();
    const memAfter = process.memoryUsage().heapUsed;

    const opsPerSec = Math.round((BENCH_ITERS / durationMs) * 1000);
    const avgTimeNs = (durationMs * 1_000_000) / BENCH_ITERS;
    const heapDeltaKb = Math.round(((memAfter - memBefore) / 1024) * 100) / 100;

    manifestResults.push({
      Material: name,
      "Ops/sec": `${opsPerSec.toLocaleString()} ops/s`,
      "Avg Latency": `${avgTimeNs.toFixed(2)} ns`,
      "Heap Delta": `${heapDeltaKb} KB`,
    });
  }

  console.table(manifestResults);

  // 2. Benchmark WebGPU ObjectUniform Packing
  console.log(`\n⏱️  [2/3] Benchmarking WebGPU ObjectUniform Packing (${BENCH_ITERS.toLocaleString()} iterations)...`);
  const packingResults = [];

  const scratchObjBufferData = new Float32Array(64);
  const scratchUniformValues = {};
  const scratchModelMatrix = new Float32Array(16);

  for (const { name, instance } of materials) {
    const obj = new Object3D();
    obj.material = instance;
    obj.position.set(12, 34, 56);
    obj.updateMatrixWorld();

    shaderRegistry.ensureProvider(instance.type, instance);
    const shaderDef = shaderRegistry.get(instance.type);
    if (!shaderDef) {
      console.warn(`Shader definition missing for ${instance.type}`);
      continue;
    }

    // Warmup
    for (let i = 0; i < WARMUP_ITERS; i++) {
      instance.time += 0.016;
      const m = instance.getRenderManifest();
      scratchModelMatrix.set(obj.worldMatrix.data);
      for (const k in scratchUniformValues) scratchUniformValues[k] = undefined;
      for (const k in m.properties) scratchUniformValues[k] = m.properties[k];
      scratchUniformValues["u_model"] = scratchModelMatrix;
      if (scratchUniformValues["u_isSkinned"] === undefined) {
        scratchUniformValues["u_isSkinned"] = 0.0;
        scratchUniformValues["u_boneOffset"] = 0.0;
      }
      UniformPacker.packInto(shaderDef.layout, scratchUniformValues, scratchObjBufferData);
    }

    if (global.gc) global.gc();
    const memBefore = process.memoryUsage().heapUsed;
    const start = performance.now();

    for (let i = 0; i < BENCH_ITERS; i++) {
      instance.time += 0.016;
      const m = instance.getRenderManifest();
      scratchModelMatrix.set(obj.worldMatrix.data);
      for (const k in scratchUniformValues) scratchUniformValues[k] = undefined;
      for (const k in m.properties) scratchUniformValues[k] = m.properties[k];
      scratchUniformValues["u_model"] = scratchModelMatrix;
      if (scratchUniformValues["u_isSkinned"] === undefined) {
        scratchUniformValues["u_isSkinned"] = 0.0;
        scratchUniformValues["u_boneOffset"] = 0.0;
      }
      UniformPacker.packInto(shaderDef.layout, scratchUniformValues, scratchObjBufferData);
    }

    const durationMs = performance.now() - start;
    if (global.gc) global.gc();
    const memAfter = process.memoryUsage().heapUsed;

    const opsPerSec = Math.round((BENCH_ITERS / durationMs) * 1000);
    const avgTimeNs = (durationMs * 1_000_000) / BENCH_ITERS;
    const heapDeltaKb = Math.round(((memAfter - memBefore) / 1024) * 100) / 100;

    packingResults.push({
      Material: name,
      "Ops/sec": `${opsPerSec.toLocaleString()} ops/s`,
      "Avg Latency": `${avgTimeNs.toFixed(2)} ns`,
      "Heap Delta": `${heapDeltaKb} KB`,
    });
  }

  console.table(packingResults);

  // 3. Zero-Allocation Invariants Verification
  console.log("\n🛡️  [3/3] Verifying Zero-Allocation Invariants & Buffer Reuse...");
  let assertionsPassed = 0;

  for (const { name, instance } of materials) {
    const m1 = instance.getRenderManifest();
    const p1 = m1.properties;
    const propRefs = new Map();
    for (const [k, v] of Object.entries(p1)) {
      if (typeof v === "object" && v !== null) {
        propRefs.set(k, v);
      }
    }

    const vecBefore = MathPool._VECTOR_POOL.length;
    const matBefore = MathPool._MATRIX_POOL.length;

    for (let frame = 0; frame < 10_000; frame++) {
      instance.time += 0.016;
      const mN = instance.getRenderManifest();
      if (mN !== m1) {
        throw new Error(`[Assertion Error] RenderManifest instance reallocated for ${name}`);
      }
      for (const [k, originalRef] of propRefs) {
        if (mN.properties[k] !== originalRef) {
          throw new Error(`[Assertion Error] Property buffer '${k}' reallocated for ${name}`);
        }
      }
    }

    const vecAfter = MathPool._VECTOR_POOL.length;
    const matAfter = MathPool._MATRIX_POOL.length;

    if (vecBefore !== vecAfter || matBefore !== matAfter) {
      throw new Error(`[Assertion Error] MathPool leaked during loop for ${name}`);
    }

    assertionsPassed++;
    console.log(`  ✅ ${name}: 100% buffer reuse & 0 MathPool leaks confirmed.`);
  }

  console.log(`\n🎉 All ${assertionsPassed}/${materials.length} liquid materials verified zero-allocation sound.\n`);
}

runBenchmarks().catch((err) => {
  console.error("Perf benchmark failed:", err);
  process.exit(1);
});

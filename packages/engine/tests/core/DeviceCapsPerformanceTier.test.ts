import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceCaps, PerformanceTier } from "../../src/core/DeviceCaps.js";
import { classifyGpu, GpuClass } from "../../src/core/GpuClass.js";

interface FakeDevice {
  cores: number;
  memory?: number | undefined;
  renderer?: string;
  coarsePointer?: boolean;
  touch?: boolean;
  innerWidth?: number;
  screenWidth?: number;
  userAgent?: string;
  platform?: string;
}

const DEBUG_RENDERER = 1;
const DEBUG_VENDOR = 2;

function stubDevice(device: FakeDevice): void {
  vi.stubGlobal("navigator", {
    hardwareConcurrency: device.cores,
    deviceMemory: device.memory,
    maxTouchPoints: device.touch ? 5 : 0,
    userAgent: device.userAgent ?? "",
    platform: device.platform ?? "",
    gpu: {},
  });
  vi.stubGlobal("window", {
    matchMedia: (): { matches: boolean } => ({ matches: device.coarsePointer ?? false }),
    innerWidth: device.innerWidth ?? 1920,
    screen: { width: device.screenWidth ?? 1920, height: 1080 },
    devicePixelRatio: 1,
    ...(device.touch ? { ontouchstart: null } : {}),
  });
  const gl = {
    getParameter: (param: number): unknown => {
      if (param === DEBUG_RENDERER) return device.renderer ?? "Unknown";
      if (param === DEBUG_VENDOR) return "Vendor";
      return 1;
    },
    getExtension: (name: string): unknown => {
      if (name === "WEBGL_lose_context") return { loseContext: vi.fn() };
      if (name === "WEBGL_debug_renderer_info" && device.renderer) {
        return { UNMASKED_RENDERER_WEBGL: DEBUG_RENDERER, UNMASKED_VENDOR_WEBGL: DEBUG_VENDOR };
      }
      return null;
    },
  };
  vi.stubGlobal("document", {
    createElement: (): { getContext: () => unknown } => ({ getContext: (): unknown => gl }),
  });
}

describe("classifyGpu", () => {
  it.each([
    ["Mali-G52 MC2", GpuClass.LOW],
    ["Adreno (TM) 610", GpuClass.LOW],
    ["ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)", GpuClass.LOW],
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)", GpuClass.HIGH],
    ["ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)", GpuClass.HIGH],
    ["Adreno (TM) 740", GpuClass.HIGH],
    ["Mali-G710 MC10", GpuClass.HIGH],
    ["Apple GPU", GpuClass.UNKNOWN],
    ["Google SwiftShader", GpuClass.LOW],
    ["llvmpipe (LLVM 15.0.7, 256 bits)", GpuClass.LOW],
    ["Unknown", GpuClass.UNKNOWN],
  ])("classifies %s as %s", (renderer, expected) => {
    expect(classifyGpu(renderer)).toBe(expected);
  });
});

describe("DeviceCaps.getPerformanceTier()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rates a desktop browser that does not report deviceMemory (Safari/Firefox) as HIGH", () => {
    stubDevice({ cores: 8, memory: undefined, renderer: "Apple GPU" });
    expect(new DeviceCaps().getPerformanceTier()).toBe(PerformanceTier.HIGH);
  });

  it("demotes an 8-core phone with a weak Mali GPU to LOW", () => {
    stubDevice({
      cores: 8,
      memory: 8,
      renderer: "Mali-G52 MC2",
      coarsePointer: true,
      touch: true,
      screenWidth: 720,
      innerWidth: 360,
    });
    expect(new DeviceCaps().getPerformanceTier()).toBe(PerformanceTier.LOW);
  });

  it("rates a 6-core iPhone (masked Apple GPU, no deviceMemory) as MEDIUM, not LOW", () => {
    stubDevice({
      cores: 6,
      memory: undefined,
      renderer: "Apple GPU",
      coarsePointer: true,
      touch: true,
      screenWidth: 390,
      innerWidth: 390,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    const caps = new DeviceCaps();
    expect(caps.isAppleMobile()).toBe(true);
    expect(caps.getPerformanceTier()).toBe(PerformanceTier.MEDIUM);
  });

  it("recognises iPadOS (desktop UA, MacIntel + multi-touch) as Apple mobile", () => {
    stubDevice({
      cores: 8,
      memory: undefined,
      renderer: "Apple GPU",
      coarsePointer: true,
      touch: true,
      screenWidth: 820,
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });
    expect(new DeviceCaps().isAppleMobile()).toBe(true);
  });

  it("does not treat a desktop Mac as Apple mobile", () => {
    stubDevice({ cores: 8, renderer: "Apple GPU", platform: "MacIntel" });
    expect(new DeviceCaps().isAppleMobile()).toBe(false);
  });

  it("does not treat a touch laptop with a narrow window as mobile", () => {
    stubDevice({ cores: 8, memory: 8, touch: true, innerWidth: 800, screenWidth: 1920 });
    const caps = new DeviceCaps();
    expect(caps.isMobile()).toBe(false);
    expect(caps.getPerformanceTier()).toBe(PerformanceTier.HIGH);
  });

  it("lets forcedTier bypass detection", () => {
    stubDevice({ cores: 8, memory: 8, renderer: "Google SwiftShader" });
    const caps = new DeviceCaps();
    expect(caps.getPerformanceTier()).toBe(PerformanceTier.MEDIUM);
    caps.forcedTier = PerformanceTier.HIGH;
    expect(caps.getPerformanceTier()).toBe(PerformanceTier.HIGH);
  });

  it("reads a forced tier from the ?tier= URL parameter", () => {
    stubDevice({ cores: 2, memory: 2 });
    vi.stubGlobal("window", {
      ...(globalThis as unknown as { window: object }).window,
      location: { search: "?tier=High" },
    });
    expect(new DeviceCaps().getPerformanceTier()).toBe(PerformanceTier.HIGH);
  });

  it("does not count WebGPU presence towards the performance score", () => {
    stubDevice({ cores: 4, memory: 6 });
    expect(new DeviceCaps().getPerformanceTier()).toBe(PerformanceTier.LOW);
  });
});

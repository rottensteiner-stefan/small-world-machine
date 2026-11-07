// @vitest-environment jsdom
import type { SmallWorldMachine } from "@small-world-machine/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoldenCapture as Capture10, parseGoldenSpec as parse10 } from "../10/GoldenCapture.js";
import { GoldenCapture as Capture38, parseGoldenSpec as parse38 } from "../38/GoldenCapture.js";
import { GoldenCapture as Capture39, parseGoldenSpec as parse39 } from "../39/GoldenCapture.js";
import { GoldenCapture as Capture43, parseGoldenSpec as parse43 } from "../43/GoldenCapture.js";
import { GoldenCapture as Capture45, parseGoldenSpec as parse45 } from "../45/GoldenCapture.js";
import { GoldenCapture as Capture46, parseGoldenSpec as parse46 } from "../46/GoldenCapture.js";
import { resolveVariant } from "../46/Variants.js";
import {
  GOLDEN_FRAMES_DEFAULT,
  GOLDEN_FRAME_TIME,
  GOLDEN_SOAK_MS,
  GoldenSession,
  lookupOwn,
  parseGoldenSpecFrom,
  type GoldenSpec,
  type GoldenWindowFlags,
} from "../shared/GoldenCapture.js";

// ── Oracles: the pre-refactor parsers, copied verbatim from 10/ (views) and 38/..46/ (main). ──
interface OracleSpec {
  poolKeyRaw: string;
  view: string;
  frames: number;
}
function oracle10(search: string): OracleSpec | undefined {
  const params = new URLSearchParams(search);
  const poolKeyRaw = params.get("__golden");
  if (!poolKeyRaw) return undefined;
  const rawView = params.get("__goldenView");
  const view = rawView === "oblique" ? "oblique" : "top";
  const rawFrames = Number.parseInt(params.get("__goldenFrames") ?? "", 10);
  const frames = Number.isInteger(rawFrames) && rawFrames > 0 ? rawFrames : 60;
  return { poolKeyRaw, view, frames };
}
function oracleMain(search: string): OracleSpec | undefined {
  const params = new URLSearchParams(search);
  const poolKeyRaw = params.get("__golden");
  if (!poolKeyRaw) return undefined;
  const rawFrames = Number.parseInt(params.get("__goldenFrames") ?? "", 10);
  const frames = Number.isInteger(rawFrames) && rawFrames > 0 ? rawFrames : 60;
  return { poolKeyRaw, view: "main", frames };
}

const QUERIES: readonly string[] = [
  "",
  "?",
  "?rendererType=WEB_GL2",
  "?__golden=",
  "?__golden",
  "?__golden=clear-water",
  "?__golden=clear-water&__goldenView=oblique",
  "?__golden=clear-water&__goldenView=top",
  "?__golden=clear-water&__goldenView=OBLIQUE",
  "?__golden=clear-water&__goldenView=",
  "?__golden=clear-water&__goldenView=garbage",
  "?__golden=pbr38-siq&__goldenFrames=12",
  "?__golden=pbr38-siq&__goldenFrames=0",
  "?__golden=pbr38-siq&__goldenFrames=-5",
  "?__golden=pbr38-siq&__goldenFrames=3.9",
  "?__golden=pbr38-siq&__goldenFrames=abc",
  "?__golden=pbr38-siq&__goldenFrames=",
  "?__golden=pbr38-siq&__goldenFrames=7abc",
  "?__golden=pbr38-siq&__goldenFrames=1e3",
  "?__golden=pbr38-siq&__goldenFrames=99999999999999999999",
  "?rendererType=WEB_GPU&__golden=fire45-overview&__goldenView=oblique&__goldenFrames=30",
  "?__golden=a%20b&__goldenFrames=%2B5",
  "?__golden=constructor",
  "?__golden=toString&__goldenView=oblique",
  "?__golden=__proto__&__goldenFrames=2",
  "?__golden=x&__golden=y&__goldenFrames=4&__goldenFrames=9",
];

function setSearch(search: string): void {
  window.history.replaceState(null, "", `/${search}`);
}

describe("parseGoldenSpec equivalence with the pre-refactor parsers", () => {
  afterEach(() => setSearch(""));

  it.each(QUERIES)("showcase 10 (views) matches oracle for %j", (query) => {
    setSearch(query);
    expect(parse10()).toEqual(oracle10(query));
  });

  const mainParsers: ReadonlyArray<[string, () => GoldenSpec | undefined]> = [
    ["38", parse38],
    ["39", parse39],
    ["43", parse43],
    ["45", parse45],
    ["46", parse46],
  ];
  for (const [id, parse] of mainParsers) {
    it.each(QUERIES)(`showcase ${id} (main) matches oracle for %j`, (query) => {
      setSearch(query);
      expect(parse()).toEqual(oracleMain(query));
    });
  }

  it("shared parser applies the default frame count and the view resolver", () => {
    const spec = parseGoldenSpecFrom("?__golden=k&__goldenView=v", (raw) => `view:${raw}`);
    expect(spec).toEqual({ poolKeyRaw: "k", view: "view:v", frames: GOLDEN_FRAMES_DEFAULT });
    expect(parseGoldenSpecFrom("?other=1", () => "x")).toBeUndefined();
  });
});

describe("pool-key resolution", () => {
  it("lookupOwn ignores prototype members but finds own keys", () => {
    const table: Readonly<Record<string, number>> = { a: 0, b: 1 };
    expect(lookupOwn(table, "a")).toBe(0);
    expect(lookupOwn(table, "b")).toBe(1);
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty", "missing"]) {
      expect(lookupOwn(table, key)).toBeUndefined();
    }
  });

  it("resolveVariant (46) falls back to overview for prototype keys", () => {
    for (const key of ["constructor", "toString", "__proto__", "valueOf", "nope", "", null]) {
      expect(resolveVariant(key).id).toBe("overview");
    }
    expect(resolveVariant("forge").id).toBe("forge");
  });
});

// ── Fake host: just enough surface for GoldenSession / the per-showcase classes. ──
interface FakeHost {
  host: SmallWorldMachine;
  canvas: HTMLCanvasElement;
  step: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  camera: {
    aspect: number;
    updateProjectionMatrix: ReturnType<typeof vi.fn>;
    behaviors: unknown[];
  };
  frameInfo: Record<string, number>;
}

function makeHost(): FakeHost {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const step = vi.fn();
  const stop = vi.fn();
  const setSize = vi.fn();
  const frameInfo: Record<string, number> = {
    time: 5,
    deltaTime: 5,
    realTime: 5,
    realDeltaTime: 5,
    frameIndex: 5,
  };
  const camera = { aspect: 0, updateProjectionMatrix: vi.fn(), behaviors: [] };
  const host = {
    canvas,
    stop,
    step,
    camera,
    renderer: { type: "WEB_GL2", setSize, frameInfo },
  } as unknown as SmallWorldMachine;
  return { host, canvas, step, stop, setSize, camera, frameInfo };
}

const flags = (): GoldenWindowFlags => window as unknown as GoldenWindowFlags;

/** Resolves the soak `setTimeout` and the promise chain after it. */
async function finishRun(run: Promise<void>): Promise<void> {
  await vi.advanceTimersByTimeAsync(GOLDEN_SOAK_MS);
  await run;
}

describe("GoldenSession", () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cancelSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
    cancelSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    delete flags().__goldenReady;
    delete flags().__goldenMeta;
  });

  afterEach(() => {
    vi.useRealTimers();
    rafSpy.mockRestore();
    cancelSpy.mockRestore();
    document.body.innerHTML = "";
  });

  const spec = (frames = 3): GoldenSpec => ({ poolKeyRaw: "k", view: "main", frames });

  it("runs the hook order, steps N fixed frames and sets ready + meta", async () => {
    const h = makeHost();
    const order: string[] = [];
    h.stop.mockImplementation(() => order.push("stop"));
    h.step.mockImplementation((dt: number) => order.push(`step:${dt}`));
    const session = new GoldenSession(h.host, {
      width: 640,
      height: 360,
      zeroFrameClock: true,
      extraHiddenSelectors: [],
    });
    const run = session.run(spec(2), true, {
      prepare: () => order.push("prepare"),
      beforeSoak: () => order.push("beforeSoak"),
      afterSoak: () => order.push("afterSoak"),
      afterSteps: () => order.push("afterSteps"),
    });
    await finishRun(run);
    expect(order).toEqual([
      "stop",
      "prepare",
      "beforeSoak",
      "afterSoak",
      `step:${GOLDEN_FRAME_TIME}`,
      `step:${GOLDEN_FRAME_TIME}`,
      "afterSteps",
    ]);
    expect(flags().__goldenReady).toBe(true);
    expect(flags().__goldenMeta).toEqual({
      poolKey: "k",
      view: "main",
      frames: 2,
      rendererType: "WEB_GL2",
    });
    expect(rafSpy).toHaveBeenCalledTimes(1);
    session.dispose();
  });

  it("pins surface + camera aspect, zeroes the frame clock and hides the overlay UI", async () => {
    const h = makeHost();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<button id="b"></button><header id="info"></header><div class="app-footer"></div>' +
        '<div id="extra"></div><div id="keep"></div>',
    );
    const session = new GoldenSession(h.host, {
      width: 640,
      height: 360,
      zeroFrameClock: true,
      extraHiddenSelectors: ["#extra", "#absent"],
    });
    await finishRun(session.run(spec(1), true, {}));
    expect(h.canvas.width).toBe(640);
    expect(h.canvas.height).toBe(360);
    expect(h.canvas.style.width).toBe("640px");
    expect(h.canvas.style.height).toBe("360px");
    expect(h.setSize).toHaveBeenCalledWith(640, 360);
    expect(h.camera.aspect).toBeCloseTo(640 / 360, 12);
    expect(h.camera.updateProjectionMatrix).toHaveBeenCalled();
    expect(Object.values(h.frameInfo)).toEqual([0, 0, 0, 0, 0]);
    const display = (sel: string): string =>
      (document.querySelector(sel) as HTMLElement).style.display;
    expect(display("#b")).toBe("none");
    expect(display("header#info")).toBe("none");
    expect(display(".app-footer")).toBe("none");
    expect(display("#extra")).toBe("none");
    expect(display("#keep")).toBe("");
    session.dispose();
  });

  it("leaves the frame clock alone when zeroFrameClock is false", async () => {
    const h = makeHost();
    const session = new GoldenSession(h.host, {
      width: 64,
      height: 64,
      zeroFrameClock: false,
      extraHiddenSelectors: [],
    });
    await finishRun(session.run(spec(1), true, {}));
    expect(h.frameInfo["time"]).toBe(5);
    session.dispose();
  });

  it("re-applies the surface on resize and stops doing so after dispose", async () => {
    const h = makeHost();
    const session = new GoldenSession(h.host, {
      width: 640,
      height: 360,
      zeroFrameClock: false,
      extraHiddenSelectors: [],
    });
    await finishRun(session.run(spec(1), true, {}));
    h.canvas.width = 1;
    window.dispatchEvent(new Event("resize"));
    expect(h.canvas.width).toBe(640);

    session.dispose();
    expect(cancelSpy).toHaveBeenCalledWith(42);
    h.canvas.width = 1;
    window.dispatchEvent(new Event("resize"));
    expect(h.canvas.width).toBe(1);
    session.dispose(); // idempotent
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown pool as meta.error without touching the host", async () => {
    const h = makeHost();
    const session = new GoldenSession(h.host, {
      width: 64,
      height: 64,
      zeroFrameClock: true,
      extraHiddenSelectors: [],
    });
    await session.run({ poolKeyRaw: "nope", view: "main", frames: 4 }, false, {});
    expect(flags().__goldenReady).toBeUndefined();
    expect(flags().__goldenMeta?.error).toBe("Unknown __golden pool 'nope'");
    expect(h.stop).not.toHaveBeenCalled();
    expect(h.step).not.toHaveBeenCalled();
  });

  it("turns a hook failure into meta.error and never sets ready", async () => {
    const h = makeHost();
    const session = new GoldenSession(h.host, {
      width: 64,
      height: 64,
      zeroFrameClock: false,
      extraHiddenSelectors: [],
    });
    const run = session.run(spec(1), true, {
      afterSoak: () => {
        throw new Error("boom");
      },
    });
    await finishRun(run);
    expect(flags().__goldenReady).toBeUndefined();
    expect(flags().__goldenMeta?.error).toBe("boom");
    expect(rafSpy).not.toHaveBeenCalled();
    session.dispose();
  });
});

describe("hostile __golden pool keys (prototype members) in every showcase", () => {
  beforeEach(() => {
    delete flags().__goldenReady;
    delete flags().__goldenMeta;
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const hostile = ["constructor", "toString", "__proto__", "hasOwnProperty"];
  const noop = (): void => undefined;
  interface Runner {
    run(poolKey: string): Promise<void>;
    dispose(): void;
  }
  const wrap = (
    capture: { run(spec: never): Promise<void>; dispose(): void },
    view: string,
  ): Runner => ({
    run: (poolKey) =>
      (capture.run as (spec: unknown) => Promise<void>)({ poolKeyRaw: poolKey, view, frames: 1 }),
    dispose: () => capture.dispose(),
  });
  const makers: ReadonlyArray<[string, (host: SmallWorldMachine, spy: () => void) => Runner]> = [
    ["10", (host, spy): Runner => wrap(new Capture10(host, spy), "top")],
    [
      "38",
      (host, spy): Runner =>
        wrap(new Capture38(host, { disableFlicker: spy, applyPreset: spy }), "main"),
    ],
    [
      "39",
      (host, spy): Runner =>
        wrap(new Capture39(host, { resetClock: spy, applyPreset: spy }), "main"),
    ],
    ["43", (host, spy): Runner => wrap(new Capture43(host, { applyMaterial: spy }), "main")],
    [
      "45",
      (host, spy): Runner =>
        wrap(new Capture45(host, { freezeForCapture: spy, applyPreset: spy }), "main"),
    ],
    [
      "46",
      (host, spy): Runner =>
        wrap(
          new Capture46(host, { freezeForCapture: spy, applyVariant: spy, applyCameraPool: spy }),
          "main",
        ),
    ],
  ];

  for (const [id, make] of makers) {
    it.each(hostile)(`showcase ${id} rejects '%s' as an unknown pool`, async (key) => {
      const h = makeHost();
      const spy = vi.fn(noop);
      const capture = make(h.host, spy);
      await capture.run(key);
      expect(flags().__goldenReady).toBeUndefined();
      expect(flags().__goldenMeta?.error).toBe(`Unknown __golden pool '${key}'`);
      expect(spy).not.toHaveBeenCalled();
      expect(h.stop).not.toHaveBeenCalled();
      capture.dispose();
    });
  }
});

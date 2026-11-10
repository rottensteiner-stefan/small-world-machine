// Shared vegetation wind field (ADR 0059 step 1b). Function chunk only: the consumer owns the
// binding and passes the 4 x vec4f block written by `WindField.uniforms`. CPU mirror: WindField.ts.
//
// p0 = (dirX, dirZ, scroll [gust cells, wraps at SWM_WIND_PERIOD], flutterPhase [rad, wraps at tau])
// p1 = (strength, gustStrength, 1 / gustLength, 1 / (gustLength * crossStretch))
// p2 = (calm, flutterStrength, 1 / boundaryHeight, groundFactor)
// p3 = (maxLean, 1 / (1 - calm), 0, 0)

const SWM_WIND_PERIOD: f32 = 256.0;
const SWM_WIND_TAU: f32 = 6.283185307179586;
const SWM_WIND_CROSS_FLUTTER: f32 = 0.35;
const SWM_WIND_FLUTTER_FLOOR: f32 = 0.25;

struct SwmWind {
  p0: vec4f,
  p1: vec4f,
  p2: vec4f,
  p3: vec4f,
}

fn swmWindHash(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise, periodic in x with `period` lattice cells so the scroll offset can wrap seamlessly.
fn swmWindNoise(p: vec2f, period: f32) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let x0 = i.x - period * floor(i.x / period);
  let x1 = (x0 + 1.0) - period * floor((x0 + 1.0) / period);
  let a = swmWindHash(vec2f(x0, i.y));
  let b = swmWindHash(vec2f(x1, i.y));
  let c = swmWindHash(vec2f(x0, i.y + 1.0));
  let d = swmWindHash(vec2f(x1, i.y + 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Gust envelope 0..1 at a world XZ position; gust blobs travel downwind and are stretched across it.
fn swmWindGust(w: SwmWind, xz: vec2f) -> f32 {
  let dir = w.p0.xy;
  let along = dot(xz, dir) * w.p1.z - w.p0.z;
  let across = dot(xz, vec2f(-dir.y, dir.x)) * w.p1.w;
  let n1 = swmWindNoise(vec2f(along, across), SWM_WIND_PERIOD);
  let n2 = swmWindNoise(vec2f(2.0 * along, 2.0 * across + 17.0), 2.0 * SWM_WIND_PERIOD);
  let n = (2.0 * n1 + n2) * (1.0 / 3.0);
  let g = clamp((n - w.p2.x) * w.p3.y, 0.0, 1.0);
  return g * g * (3.0 - 2.0 * g);
}

// Horizontal lean (tangent of the tip lean, world XZ) for one plant rooted at `rootXZ`.
// `height` = plant height in metres (vertical wind profile), `shelter` = 0 open field .. 1 fully sheltered.
fn swmWindLean(w: SwmWind, rootXZ: vec2f, height: f32, shelter: f32) -> vec2f {
  let dir = w.p0.xy;
  let g = swmWindGust(w, rootXZ);
  let profile = mix(w.p2.w, 1.0, clamp(height * w.p2.z, 0.0, 1.0));
  let phase = w.p0.w + SWM_WIND_TAU * swmWindHash(rootXZ * 0.73 + vec2f(11.1, 3.7));
  let flutter = w.p2.y * (SWM_WIND_FLUTTER_FLOOR + g);
  let alongLean = w.p1.x + w.p1.y * g + flutter * sin(phase);
  let crossLean = SWM_WIND_CROSS_FLUTTER * flutter * cos(phase);
  let lean = (dir * alongLean + vec2f(-dir.y, dir.x) * crossLean) * (profile * (1.0 - shelter));
  let len = length(lean);
  return lean * min(1.0, w.p3.x / max(len, 1e-5));
}

// Bends a vertex given relative to the plant root in world-aligned axes (after instance rotation and
// scale, before translation). Quadratic profile keeps the base planted. For horizontal deflection
// d(y) = lean*h*k^2 (k = y/h), the second-order inextensible vertical drop is the exact arc-length
// integral (1/2) * integral_0^y |d'(eta)|^2 d(eta) = (2/3) * |d(y)|^2 / y -- NOT a constant divisor
// heuristic; clamped to 45% of the vertex height so extreme leans cannot collapse the stem.
fn swmWindBend(offset: vec3f, lean: vec2f, height: f32) -> vec3f {
  let h = max(height, 1e-4);
  let k = clamp(offset.y / h, 0.0, 1.0);
  let d = lean * (h * k * k);
  let effY = max(offset.y, 1e-4);
  let drop = min((2.0 / 3.0) * dot(d, d) / effY, offset.y * 0.45);
  return vec3f(offset.x + d.x, offset.y - drop, offset.z + d.y);
}

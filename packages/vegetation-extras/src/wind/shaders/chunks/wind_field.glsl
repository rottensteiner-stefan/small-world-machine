// Shared vegetation wind field (ADR 0059 step 1b), GLSL ES 1.00 + 3.00 compatible function chunk.
// Mirrors wind_field.wgsl 1:1; uniform layout documented there and in WindField.ts.

const float SWM_WIND_PERIOD = 256.0;
const float SWM_WIND_TAU = 6.283185307179586;
const float SWM_WIND_CROSS_FLUTTER = 0.35;
const float SWM_WIND_FLUTTER_FLOOR = 0.25;

struct SwmWind {
  vec4 p0;
  vec4 p1;
  vec4 p2;
  vec4 p3;
};

float swmWindHash(vec2 p) {
  vec3 p3 = fract(vec3(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float swmWindNoise(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x0 = i.x - period * floor(i.x / period);
  float x1 = (x0 + 1.0) - period * floor((x0 + 1.0) / period);
  float a = swmWindHash(vec2(x0, i.y));
  float b = swmWindHash(vec2(x1, i.y));
  float c = swmWindHash(vec2(x0, i.y + 1.0));
  float d = swmWindHash(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float swmWindGust(SwmWind w, vec2 xz) {
  vec2 dir = w.p0.xy;
  float along = dot(xz, dir) * w.p1.z - w.p0.z;
  float across = dot(xz, vec2(-dir.y, dir.x)) * w.p1.w;
  float n1 = swmWindNoise(vec2(along, across), SWM_WIND_PERIOD);
  float n2 = swmWindNoise(vec2(2.0 * along, 2.0 * across + 17.0), 2.0 * SWM_WIND_PERIOD);
  float n = (2.0 * n1 + n2) * (1.0 / 3.0);
  float g = clamp((n - w.p2.x) * w.p3.y, 0.0, 1.0);
  return g * g * (3.0 - 2.0 * g);
}

vec2 swmWindLean(SwmWind w, vec2 rootXZ, float height, float shelter) {
  vec2 dir = w.p0.xy;
  float g = swmWindGust(w, rootXZ);
  float profile = mix(w.p2.w, 1.0, clamp(height * w.p2.z, 0.0, 1.0));
  float phase = w.p0.w + SWM_WIND_TAU * swmWindHash(rootXZ * 0.73 + vec2(11.1, 3.7));
  float flutter = w.p2.y * (SWM_WIND_FLUTTER_FLOOR + g);
  float alongLean = w.p1.x + w.p1.y * g + flutter * sin(phase);
  float crossLean = SWM_WIND_CROSS_FLUTTER * flutter * cos(phase);
  vec2 lean = (dir * alongLean + vec2(-dir.y, dir.x) * crossLean) * (profile * (1.0 - shelter));
  float len = length(lean);
  return lean * min(1.0, w.p3.x / max(len, 1e-5));
}

vec3 swmWindBend(vec3 offset, vec2 lean, float height) {
  float h = max(height, 1e-4);
  float k = clamp(offset.y / h, 0.0, 1.0);
  vec2 d = lean * (h * k * k);
  float effY = max(offset.y, 1e-4);
  float drop = min((2.0 / 3.0) * dot(d, d) / effY, offset.y * 0.45);
  return vec3(offset.x + d.x, offset.y - drop, offset.z + d.y);
}

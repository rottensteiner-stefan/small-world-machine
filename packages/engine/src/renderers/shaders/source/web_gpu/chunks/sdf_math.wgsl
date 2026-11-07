// Signed Distance Field (SDF) Primitives & Raymarching Mathematics (WGSL)
// Based on formulations by Inigo Quilez (iquilezles.org)

// --- Primitives ---

fn sdfSphere(p: vec3f, r: f32) -> f32 {
    return length(p) - r;
}

fn sdfBox(p: vec3f, b: vec3f) -> f32 {
    let d = abs(p) - b;
    return length(max(d, vec3f(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0);
}

fn sdfRoundBox(p: vec3f, b: vec3f, r: f32) -> f32 {
    let q = abs(p) - b + r;
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

fn sdfTorus(p: vec3f, t: vec2f) -> f32 {
    let q = vec2f(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

fn sdfCylinder(p: vec3f, h: f32, r: f32) -> f32 {
    let d = abs(vec2f(length(p.xz), p.y)) - vec2f(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, vec2f(0.0)));
}

fn sdfCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

fn sdfPlane(p: vec3f, n: vec3f, h: f32) -> f32 {
    // n must be normalized
    return dot(p, n) + h;
}

// --- Combinators & CSG Boolean Operators ---

fn opUnion(d1: f32, d2: f32) -> f32 {
    return min(d1, d2);
}

fn opSubtract(d1: f32, d2: f32) -> f32 {
    return max(-d1, d2);
}

fn opIntersect(d1: f32, d2: f32) -> f32 {
    return max(d1, d2);
}

// Polynomial Smooth Minimum / Union (Inigo Quilez)
fn opSmoothUnion(d1: f32, d2: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (d2 - d1) / max(k, 0.00001), 0.0, 1.0);
    return mix(d2, d1, h) - k * h * (1.0 - h);
}

fn opSmoothSubtract(d1: f32, d2: f32, k: f32) -> f32 {
    let h = clamp(0.5 - 0.5 * (d2 + d1) / max(k, 0.00001), 0.0, 1.0);
    return mix(d2, -d1, h) + k * h * (1.0 - h);
}

fn opSmoothIntersect(d1: f32, d2: f32, k: f32) -> f32 {
    let h = clamp(0.5 - 0.5 * (d2 - d1) / max(k, 0.00001), 0.0, 1.0);
    return mix(d2, d1, h) + k * h * (1.0 - h);
}

// --- Domain Transforms & Modifiers ---

fn opRotate2D(p: vec2f, angle: f32) -> vec2f {
    let s = sin(angle);
    let c = cos(angle);
    return mat2x2f(c, -s, s, c) * p;
}

fn opTwist(p: vec3f, k: f32) -> vec3f {
    let c = cos(k * p.y);
    let s = sin(k * p.y);
    let m = mat2x2f(c, -s, s, c);
    return vec3f(m * p.xz, p.y);
}

fn opRepeat(p: vec3f, c: vec3f) -> vec3f {
    let q = p + 0.5 * c;
    return q - c * floor(q / c) - 0.5 * c;
}

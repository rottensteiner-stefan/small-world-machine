// Signed Distance Field (SDF) Primitives & Raymarching Mathematics (GLSL)
// Based on formulations by Inigo Quilez (iquilezles.org)

// --- Primitives ---

float sdfSphere(vec3 p, float r) {
    return length(p) - r;
}

float sdfBox(vec3 p, vec3 b) {
    vec3 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

float sdfRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdfTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

float sdfCylinder(vec3 p, float h, float r) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdfCapsule(vec3 p, vec3 a, vec3 b, float r) {
    vec3 pa = p - a;
    vec3 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}

float sdfPlane(vec3 p, vec3 n, float h) {
    // n must be normalized
    return dot(p, n) + h;
}

// --- Combinators & CSG Boolean Operators ---

float opUnion(float d1, float d2) {
    return min(d1, d2);
}

float opSubtract(float d1, float d2) {
    return max(-d1, d2);
}

float opIntersect(float d1, float d2) {
    return max(d1, d2);
}

// Polynomial Smooth Minimum / Union (Inigo Quilez)
float opSmoothUnion(float d1, float d2, float k) {
    float h = clamp(0.5 + 0.5 * (d2 - d1) / max(k, 0.00001), 0.0, 1.0);
    return mix(d2, d1, h) - k * h * (1.0 - h);
}

float opSmoothSubtract(float d1, float d2, float k) {
    float h = clamp(0.5 - 0.5 * (d2 + d1) / max(k, 0.00001), 0.0, 1.0);
    return mix(d2, -d1, h) + k * h * (1.0 - h);
}

float opSmoothIntersect(float d1, float d2, float k) {
    float h = clamp(0.5 - 0.5 * (d2 - d1) / max(k, 0.00001), 0.0, 1.0);
    return mix(d2, d1, h) + k * h * (1.0 - h);
}

// --- Domain Transforms & Modifiers ---

vec2 opRotate2D(vec2 p, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c) * p;
}

vec3 opTwist(vec3 p, float k) {
    float c = cos(k * p.y);
    float s = sin(k * p.y);
    mat2 m = mat2(c, -s, s, c);
    return vec3(m * p.xz, p.y);
}

vec3 opRepeat(vec3 p, vec3 c) {
    return mod(p + 0.5 * c, c) - 0.5 * c;
}

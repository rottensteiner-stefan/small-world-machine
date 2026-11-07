let luma = dot(srgb, vec3f(0.299, 0.587, 0.114));
let cold = vec3f(0.05, 0.05, 0.45);
let warm = vec3f(0.85, 0.1, 0.05);
let hot = vec3f(0.95, 0.9, 0.05);
let whiteHot = vec3f(1.0, 1.0, 1.0);

let c1 = mix(cold, warm, clamp(luma / 0.3, 0.0, 1.0));
let c2 = mix(c1, hot, clamp((luma - 0.3) / 0.4, 0.0, 1.0));
srgb = mix(c2, whiteHot, clamp((luma - 0.7) / 0.3, 0.0, 1.0));

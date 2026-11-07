float luma = dot(srgb, vec3(0.299, 0.587, 0.114));
vec3 cold = vec3(0.05, 0.05, 0.45);
vec3 warm = vec3(0.85, 0.1, 0.05);
vec3 hot = vec3(0.95, 0.9, 0.05);
vec3 whiteHot = vec3(1.0, 1.0, 1.0);

vec3 c1 = mix(cold, warm, clamp(luma / 0.3, 0.0, 1.0));
vec3 c2 = mix(c1, hot, clamp((luma - 0.3) / 0.4, 0.0, 1.0));
srgb = mix(c2, whiteHot, clamp((luma - 0.7) / 0.3, 0.0, 1.0));

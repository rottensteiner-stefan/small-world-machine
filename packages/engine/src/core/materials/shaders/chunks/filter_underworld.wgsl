srgb.x *= 1.35;
srgb.y *= 0.88;
srgb.z *= 0.52;
srgb = pow(clamp(srgb, vec3f(0.0), vec3f(1.0)), vec3f(1.3));

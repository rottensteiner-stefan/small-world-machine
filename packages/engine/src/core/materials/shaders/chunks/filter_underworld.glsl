srgb.r *= 1.35;
srgb.g *= 0.88;
srgb.b *= 0.52;
srgb = pow(clamp(srgb, 0.0, 1.0), vec3(1.3));

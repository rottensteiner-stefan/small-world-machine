srgb.r *= 1.25;
srgb.g *= 0.75;
srgb.b *= 1.5;
srgb = pow(clamp(srgb, 0.0, 1.0), vec3(1.2));
float grid = sin(distortUv.y * 450.0) * 0.05;
srgb -= vec3(grid);

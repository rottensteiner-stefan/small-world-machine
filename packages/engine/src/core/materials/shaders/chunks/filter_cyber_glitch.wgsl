srgb.x *= 1.25;
srgb.y *= 0.75;
srgb.z *= 1.5;
srgb = pow(clamp(srgb, vec3f(0.0), vec3f(1.0)), vec3f(1.2));
let grid = sin(distortUv.y * 450.0) * 0.05;
srgb -= vec3f(grid);

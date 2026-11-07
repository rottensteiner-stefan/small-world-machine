float luma = dot(srgb, vec3(0.2126, 0.7152, 0.0722));

// Hard comic-contrast S-curve: deep crushed ink blacks, crisp white highlights
float highContrast = smoothstep(0.06, 0.88, luma);
float ink = pow(highContrast, 1.35);
vec3 noirBase = vec3(ink * 1.05, ink * 1.02, ink * 0.98);

// Selective Color Isolation (Amber Lantern, Crimson Blood, Emerald Toxins)
// 1. Crimson / Red (Blood, Warning Signs)
float redDiff = srgb.r - max(srgb.g, srgb.b);
float isRed = smoothstep(0.10, 0.30, redDiff) * smoothstep(0.22, 0.70, srgb.r);

// 2. Amber / Gold (Grandfather's Lantern, Halogen Glow, Candlelight)
float amberDiff = min(srgb.r, srgb.g * 1.35) - srgb.b * 1.35;
float isAmber = smoothstep(0.07, 0.26, amberDiff) * smoothstep(0.18, 0.65, srgb.r) * step(0.0, srgb.r - srgb.g * 0.65);

// 3. Emerald Green (Alchemy, Poisons, Penicillin)
float greenDiff = srgb.g - max(srgb.r * 1.05, srgb.b);
float isEmerald = smoothstep(0.08, 0.28, greenDiff) * smoothstep(0.18, 0.60, srgb.g);

// Combine masks with a punchy boost for isolated vivid colors
float colorMask = clamp(isRed * 1.35 + isAmber * 1.30 + isEmerald * 1.35, 0.0, 1.0);
vec3 vibrantColor = srgb * vec3(1.25, 1.15, 1.05);

srgb = mix(noirBase, vibrantColor, colorMask);

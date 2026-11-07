let luma = dot(srgb, vec3f(0.2126, 0.7152, 0.0722));

// Hard comic-contrast S-curve: deep crushed ink blacks, crisp white highlights
let highContrast = smoothstep(0.06, 0.88, luma);
let ink = pow(highContrast, 1.35);
let noirBase = vec3f(ink * 1.05, ink * 1.02, ink * 0.98);

// Selective Color Isolation (Amber Lantern, Crimson Blood, Emerald Toxins)
// 1. Crimson / Red (Blood, Warning Signs)
let redDiff = srgb.r - max(srgb.g, srgb.b);
let isRed = smoothstep(0.10, 0.30, redDiff) * smoothstep(0.22, 0.70, srgb.r);

// 2. Amber / Gold (Grandfather's Lantern, Halogen Glow, Candlelight)
let amberDiff = min(srgb.r, srgb.g * 1.35) - srgb.b * 1.35;
let isAmber = smoothstep(0.07, 0.26, amberDiff) * smoothstep(0.18, 0.65, srgb.r) * select(0.0, 1.0, srgb.r >= srgb.g * 0.65);

// 3. Emerald Green (Alchemy, Poisons, Penicillin)
let greenDiff = srgb.g - max(srgb.r * 1.05, srgb.b);
let isEmerald = smoothstep(0.08, 0.28, greenDiff) * smoothstep(0.18, 0.60, srgb.g);

// Combine masks with a punchy boost for isolated vivid colors
let colorMask = clamp(isRed * 1.35 + isAmber * 1.30 + isEmerald * 1.35, 0.0, 1.0);
let vibrantColor = srgb * vec3f(1.25, 1.15, 1.05);

srgb = mix(noirBase, vibrantColor, colorMask);

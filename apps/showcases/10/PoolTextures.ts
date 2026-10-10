import { Texture } from "@small-world-machine/engine";
import { GROUT_THICKNESS_PX } from "./PoolLayout.js";

/** Random source for procedural textures; golden mode injects a seeded one so tiles reproduce. */
export type RandomSource = () => number;

interface TilePalette {
  grout: string;
  groutSpeckle: string;
  /** Five subtle glaze gradient variants (4 stops each) scattered randomly across tiles. */
  variants: Array<[string, string, string, string]>;
  /** Alpha of the white glaze reflection and top/left bevel (dark tiles get less). */
  shine: number;
}

export type TilePaletteName = "pool" | "murk" | "basalt" | "toxic" | "graphite" | "salt";

/** Pool frame palettes: 5 harmonious subtle shade variations per palette scattered organically across tiles. */
const TILE_PALETTES: Record<TilePaletteName, TilePalette> = {
  pool: {
    grout: "#ffffff",
    groutSpeckle: "#edf5fa",
    variants: [
      ["#6de6f8", "#50d6f0", "#36c3e6", "#20b0d8"], // Variant 1: Pale aqua-cyan highlight
      ["#4ecbec", "#36b7de", "#20a3ca", "#1290bb"], // Variant 2: Sky pool cyan
      ["#38bee8", "#24a7d4", "#1294c0", "#0880aa"], // Variant 3: Vibrant aqua-blue
      ["#2aaedc", "#1898c6", "#0c83b0", "#047098"], // Variant 4: Deep ocean cyan
      ["#5cecf0", "#3edee4", "#26c9d0", "#14b3ba"], // Variant 5: Cool minty cyan
    ],
    shine: 1.0,
  },
  murk: {
    grout: "#2a3432",
    groutSpeckle: "#222c2a",
    variants: [
      ["#4a726b", "#3f635c", "#34544d", "#2a4640"],
      ["#3d5e58", "#34524c", "#2b4540", "#233a36"],
      ["#324e49", "#29423d", "#213632", "#1a2c28"],
      ["#436961", "#385b54", "#2e4d46", "#253f39"],
      ["#395650", "#2f4843", "#253b37", "#1d2f2b"],
    ],
    shine: 0.35,
  },
  basalt: {
    grout: "#120e0c",
    groutSpeckle: "#1b1612",
    variants: [
      ["#584c45", "#483e37", "#39302a", "#2b231d"],
      ["#4a403a", "#3c332e", "#2e2723", "#231e1b"],
      ["#3d342e", "#312923", "#251e19", "#1c1511"],
      ["#52453e", "#433730", "#352a23", "#281e18"],
      ["#443a34", "#372e28", "#2a221c", "#1f1813"],
    ],
    shine: 0.2,
  },
  toxic: {
    grout: "#172012",
    groutSpeckle: "#202a18",
    variants: [
      ["#6e7f45", "#5e6e39", "#4f5d2d", "#404d22"],
      ["#5d6b3a", "#4f5c32", "#404b2a", "#333c22"],
      ["#4d5a2d", "#404c23", "#333e1b", "#273014"],
      ["#667640", "#576634", "#485628", "#3a461e"],
      ["#546233", "#465329", "#38441f", "#2b3517"],
    ],
    shine: 0.3,
  },
  graphite: {
    grout: "#0a0b0d",
    groutSpeckle: "#141618",
    variants: [
      ["#484e57", "#3d434c", "#32373f", "#262b32"],
      ["#3a3f46", "#31353b", "#272a30", "#1e2126"],
      ["#2f3339", "#262a2f", "#1e2125", "#16181c"],
      ["#424750", "#373c44", "#2c3137", "#21252b"],
      ["#353940", "#2c3036", "#23262b", "#1a1d21"],
    ],
    shine: 0.25,
  },
  salt: {
    grout: "#d9d2c3",
    groutSpeckle: "#e6e0d3",
    variants: [
      ["#f1ece0", "#e6dfd0", "#dbd3c1", "#cfc6b2"],
      ["#ece5d6", "#e1d9c7", "#d6cdb9", "#cac0aa"],
      ["#e6dfcf", "#dbd3c1", "#d0c7b3", "#c4baa4"],
      ["#f4efe5", "#e9e3d5", "#ded6c5", "#d2c9b6"],
      ["#e9e2d2", "#ded6c4", "#d3cab6", "#c7bda8"],
    ],
    shine: 0.5,
  },
};

/**
 * Generates a graphic-novel comic tile texture: flat slate/charcoal grey tiles with sharp white
 * grout lines, thin ink boundary strokes, and randomized deep-black accent tiles.
 */
export function createNoirPoolTileTexture(random: RandomSource): Texture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.empty();

  const tilesPerAxis = 8;
  const tileSize = size / tilesPerAxis; // 128px
  const groutSize = 9.0; // Bold white comic grout lines (18px between tiles)

  // Background: Crisp stark white grout lines for the comic deck rim and floor
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  // Draw flat comic inked tiles with occasional solid black accent tiles
  for (let y = 0; y < tilesPerAxis; y++) {
    for (let x = 0; x < tilesPerAxis; x++) {
      const tx = x * tileSize + groutSize;
      const ty = y * tileSize + groutSize;
      const tw = tileSize - groutSize * 2;
      const th = tileSize - groutSize * 2;

      const rand = random();
      if (rand < 0.16) {
        // Deep solid ink black accent tile
        ctx.fillStyle = "#0a0a0d";
      } else if (rand < 0.58) {
        ctx.fillStyle = "#4c525c"; // Classic comic slate grey
      } else if (rand < 0.86) {
        ctx.fillStyle = "#666d7a"; // Light slate grey
      } else {
        ctx.fillStyle = "#272a30"; // Dark charcoal
      }

      ctx.fillRect(tx, ty, tw, th);

      // Thin sharp comic border outline
      ctx.strokeStyle = "#08080a";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(tx, ty, tw, th);
    }
  }

  return Texture.fromCanvas(canvas, {
    anisotropy: 16,
    generateMipmaps: true,
  });
}

/**
 * Generates a ceramic tile texture from a palette: glazed tiles with grout lines
 * (bright aqua for the water pools, dark ceramics for the dark liquids).
 */
export function createPoolTileTexture(paletteName: TilePaletteName, random: RandomSource): Texture {
  const palette = TILE_PALETTES[paletteName];
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.empty();

  const tilesPerAxis = 8;
  const tileSize = size / tilesPerAxis; // 128px
  const groutSize = GROUT_THICKNESS_PX; // Double-thickness grout (11px between tiles)

  ctx.fillStyle = palette.grout;
  ctx.fillRect(0, 0, size, size);

  // Subtle fine grout texture
  ctx.fillStyle = palette.groutSpeckle;
  for (let i = 0; i < 900; i++) {
    const gx = random() * size;
    const gy = random() * size;
    ctx.fillRect(gx, gy, 2.0, 2.0);
  }

  // Draw glossy ceramic tiles with randomized shade variants
  for (let y = 0; y < tilesPerAxis; y++) {
    for (let x = 0; x < tilesPerAxis; x++) {
      const tx = x * tileSize + groutSize;
      const ty = y * tileSize + groutSize;
      const tw = tileSize - groutSize * 2;
      const th = tileSize - groutSize * 2;

      const variant = palette.variants[Math.floor(random() * palette.variants.length)]!;
      const grad = ctx.createLinearGradient(tx, ty, tx + tw, ty + th);
      grad.addColorStop(0.0, variant[0]);
      grad.addColorStop(0.35, variant[1]);
      grad.addColorStop(0.7, variant[2]);
      grad.addColorStop(1.0, variant[3]);

      ctx.fillStyle = grad;
      ctx.fillRect(tx, ty, tw, th);

      // Radial glaze reflection in upper-left quadrant
      const radialGrad = ctx.createRadialGradient(
        tx + tw * 0.25,
        ty + th * 0.25,
        2,
        tx + tw * 0.3,
        ty + th * 0.3,
        tw * 0.65,
      );
      radialGrad.addColorStop(0.0, `rgba(255, 255, 255, ${0.45 * palette.shine})`);
      radialGrad.addColorStop(0.5, `rgba(255, 255, 255, ${0.12 * palette.shine})`);
      radialGrad.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");
      ctx.fillStyle = radialGrad;
      ctx.fillRect(tx, ty, tw, th);

      // 3D Inner Bevel Highlight (Top & Left edges)
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * palette.shine})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(tx, ty + th);
      ctx.lineTo(tx, ty);
      ctx.lineTo(tx + tw, ty);
      ctx.stroke();

      // 3D Inner Bevel Shadow (Bottom & Right edges)
      ctx.strokeStyle = "rgba(10, 48, 75, 0.4)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(tx + tw, ty);
      ctx.lineTo(tx + tw, ty + th);
      ctx.lineTo(tx, ty + th);
      ctx.stroke();
    }
  }

  return Texture.fromCanvas(canvas, {
    anisotropy: 16,
    generateMipmaps: true,
  });
}

export function createBuoyTexture(
  topColor: string,
  bottomColor: string,
  beltColor: string,
): Texture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.empty();

  const beltThickness = size * 0.14;
  const beltTop = (size - beltThickness) / 2;
  const beltBottom = (size + beltThickness) / 2;

  // 1. Upper Hemisphere (Red / topColor)
  ctx.fillStyle = topColor;
  ctx.fillRect(0, 0, size, beltTop);

  // Subtle curvature highlight on upper hemisphere
  const topGrad = ctx.createLinearGradient(0, 0, 0, beltTop);
  topGrad.addColorStop(0.0, "rgba(255, 255, 255, 0.18)");
  topGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.0)");
  topGrad.addColorStop(1.0, "rgba(0, 0, 0, 0.12)");
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, size, beltTop);

  // 2. Lower Hemisphere (White / bottomColor)
  ctx.fillStyle = bottomColor;
  ctx.fillRect(0, beltBottom, size, size - beltBottom);

  // Subtle curvature shading on lower hemisphere
  const botGrad = ctx.createLinearGradient(0, beltBottom, 0, size);
  botGrad.addColorStop(0.0, "rgba(0, 0, 0, 0.08)");
  botGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.0)");
  botGrad.addColorStop(1.0, "rgba(200, 215, 230, 0.25)");
  ctx.fillStyle = botGrad;
  ctx.fillRect(0, beltBottom, size, size - beltBottom);

  // 3. Equator Belt (Black / beltColor)
  ctx.fillStyle = beltColor;
  ctx.fillRect(0, beltTop, size, beltThickness);

  // Center button: the canvas maps 2:1 onto the sphere (360 x 180 degrees), so the ellipse is
  // squeezed horizontally to read as a circle on the surface.
  const buttonX = size * 0.5;
  const buttonY = size * 0.5;
  const buttonRadius = beltThickness * 0.95;
  const drawButton = (radius: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(buttonX, buttonY, radius * 0.5, radius, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  drawButton(buttonRadius, beltColor);
  drawButton(buttonRadius * 0.78, bottomColor);
  drawButton(buttonRadius * 0.5, beltColor);
  drawButton(buttonRadius * 0.38, bottomColor);

  return Texture.fromCanvas(canvas, {
    anisotropy: 16,
    generateMipmaps: true,
  });
}

/**
 * Generates a stylized pine wooden crate texture matching classic framed cargo crates:
 * 4-sided outer perimeter frame, recessed vertical planks with wood grain and knots,
 * diagonal Z-brace cross-strut casting 3D drop shadow, and iron L-brackets with rivets in the corners.
 */
export function createWoodCrateTexture(): Texture {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.empty();

  const frameW = 148;
  const innerX = frameW;
  const innerY = frameW;
  const innerW = size - frameW * 2; // 728
  const innerH = size - frameW * 2; // 728

  // Helper: draw wood grain lines
  const drawWoodGrain = (
    clipRect: [number, number, number, number],
    vertical: boolean,
    density: number,
    baseAlpha: number = 0.18,
  ): void => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(...clipRect);
    ctx.clip();
    const [rx, ry, rw, rh] = clipRect;
    for (let i = 0; i < density; i++) {
      const t = i / density;
      const isDark = i % 2 === 0;
      ctx.strokeStyle = isDark
        ? `rgba(110, 65, 22, ${baseAlpha * (0.6 + 0.4 * Math.sin(i * 1.3))})`
        : `rgba(255, 235, 195, ${baseAlpha * (0.5 + 0.5 * Math.cos(i * 1.7))})`;
      ctx.lineWidth = 1.0 + (i % 3) * 0.8;
      ctx.beginPath();
      if (vertical) {
        const gx = rx + t * rw;
        ctx.moveTo(gx, ry);
        ctx.bezierCurveTo(
          gx + Math.sin(i * 1.5) * 8,
          ry + rh * 0.33,
          gx + Math.cos(i * 1.2) * 8,
          ry + rh * 0.66,
          gx,
          ry + rh,
        );
      } else {
        const gy = ry + t * rh;
        ctx.moveTo(rx, gy);
        ctx.bezierCurveTo(
          rx + rw * 0.33,
          gy + Math.sin(i * 1.5) * 8,
          rx + rw * 0.66,
          gy + Math.cos(i * 1.2) * 8,
          rx + rw,
          gy,
        );
      }
      ctx.stroke();
    }
    ctx.restore();
  };

  // Helper: draw a natural pine wood knot
  const drawWoodKnot = (
    cx: number,
    cy: number,
    radiusX: number,
    radiusY: number,
    angle: number = 0,
  ): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    // Outer halo
    ctx.fillStyle = "rgba(160, 95, 35, 0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 0, radiusX * 1.6, radiusY * 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Rings
    for (let r = 5; r >= 1; r--) {
      const f = r / 5;
      ctx.strokeStyle = r % 2 === 0 ? "rgba(95, 48, 15, 0.45)" : "rgba(220, 160, 90, 0.4)";
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.ellipse(0, 0, radiusX * f, radiusY * f, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Core knot
    ctx.fillStyle = "#633513";
    ctx.beginPath();
    ctx.ellipse(0, 0, radiusX * 0.35, radiusY * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // Helper: draw metal rivet/nail head
  const drawRivet = (
    cx: number,
    cy: number,
    radius: number = 6.5,
    metalDark: boolean = false,
  ): void => {
    // Shadow
    ctx.fillStyle = "rgba(15, 8, 3, 0.65)";
    ctx.beginPath();
    ctx.arc(cx + 1.5, cy + 2.0, radius + 1.0, 0, Math.PI * 2);
    ctx.fill();
    // Base
    const rGrad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, 1, cx, cy, radius);
    if (metalDark) {
      rGrad.addColorStop(0.0, "#9aa0aa");
      rGrad.addColorStop(0.5, "#42464e");
      rGrad.addColorStop(1.0, "#1d1f23");
    } else {
      rGrad.addColorStop(0.0, "#f0f2f5");
      rGrad.addColorStop(0.4, "#a8afb9");
      rGrad.addColorStop(1.0, "#4a5059");
    }
    ctx.fillStyle = rGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(15, 20, 25, 0.8)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Center slot / specular dot
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.beginPath();
    ctx.arc(cx - radius * 0.35, cy - radius * 0.35, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
  };

  // ==========================================
  // 1. RECESSED INNER PANEL (VERTICAL PLANKS)
  // ==========================================
  const numPlanks = 6;
  const plankW = innerW / numPlanks;
  const plankTones = ["#dfb577", "#d5a666", "#e4bd80", "#d1a05e", "#deb375", "#d7a869"];

  for (let p = 0; p < numPlanks; p++) {
    const px = innerX + p * plankW;
    const grad = ctx.createLinearGradient(px, innerY, px + plankW, innerY);
    grad.addColorStop(0.0, plankTones[p]!);
    grad.addColorStop(0.5, "#ebd098");
    grad.addColorStop(1.0, plankTones[(p + 1) % numPlanks]!);
    ctx.fillStyle = grad;
    ctx.fillRect(px, innerY, plankW, innerH);

    // Vertical wood grain
    drawWoodGrain([px, innerY, plankW, innerH], true, 30, 0.22);

    // Plank separator groove
    if (p > 0) {
      ctx.fillStyle = "rgba(45, 25, 10, 0.9)";
      ctx.fillRect(px - 2.5, innerY, 5, innerH);
      ctx.fillStyle = "rgba(255, 240, 210, 0.4)";
      ctx.fillRect(px + 2.5, innerY, 1.5, innerH);
    }
  }

  // Knots on vertical planks
  drawWoodKnot(innerX + 180, innerY + 240, 22, 34, 0.1);
  drawWoodKnot(innerX + 540, innerY + 480, 26, 40, -0.15);
  drawWoodKnot(innerX + 320, innerY + 610, 18, 28, 0.05);

  // Deep inner shadow cast by the frame onto the recessed panel
  const topShadow = ctx.createLinearGradient(0, innerY, 0, innerY + 45);
  topShadow.addColorStop(0.0, "rgba(20, 10, 4, 0.75)");
  topShadow.addColorStop(1.0, "rgba(20, 10, 4, 0.0)");
  ctx.fillStyle = topShadow;
  ctx.fillRect(innerX, innerY, innerW, 45);

  const leftShadow = ctx.createLinearGradient(innerX, 0, innerX + 45, 0);
  leftShadow.addColorStop(0.0, "rgba(20, 10, 4, 0.75)");
  leftShadow.addColorStop(1.0, "rgba(20, 10, 4, 0.0)");
  ctx.fillStyle = leftShadow;
  ctx.fillRect(innerX, innerY, 45, innerH);

  // ==========================================
  // 2. DIAGONAL CROSS-BRACE (Z-STRUT)
  // ==========================================
  const braceW = 138;
  const p1x = innerX;
  const p1y = innerY + innerH;
  const p2x = innerX + innerW;
  const p2y = innerY;
  const dx = p2x - p1x;
  const dy = p2y - p1y;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx); // ~ -45 deg

  ctx.save();
  // Clip diagonal brace to inner box
  ctx.beginPath();
  ctx.rect(innerX, innerY, innerW, innerH);
  ctx.clip();

  ctx.translate(p1x, p1y);
  ctx.rotate(angle);

  // 3D Drop shadow underneath the diagonal brace onto the planks
  const shadowOffset = 20;
  const bShadow = ctx.createLinearGradient(0, braceW * 0.5, 0, braceW * 0.5 + shadowOffset);
  bShadow.addColorStop(0.0, "rgba(15, 8, 3, 0.75)");
  bShadow.addColorStop(1.0, "rgba(15, 8, 3, 0.0)");
  ctx.fillStyle = bShadow;
  ctx.fillRect(-50, braceW * 0.5, len + 100, shadowOffset);

  // Diagonal brace wooden plank
  const bGrad = ctx.createLinearGradient(0, -braceW * 0.5, 0, braceW * 0.5);
  bGrad.addColorStop(0.0, "#eed5a4");
  bGrad.addColorStop(0.25, "#e0b678");
  bGrad.addColorStop(0.75, "#cf9f5d");
  bGrad.addColorStop(1.0, "#b37f3e");
  ctx.fillStyle = bGrad;
  ctx.fillRect(-50, -braceW * 0.5, len + 100, braceW);

  // Wood grain lines along the brace
  drawWoodGrain([-50, -braceW * 0.5, len + 100, braceW], false, 35, 0.24);

  // Knot on diagonal brace
  drawWoodKnot(len * 0.52, -4, 16, 26, 0.4);

  // Bevel highlights & edge shadows on diagonal brace
  ctx.fillStyle = "rgba(255, 245, 225, 0.7)";
  ctx.fillRect(-50, -braceW * 0.5, len + 100, 3);
  ctx.fillStyle = "rgba(35, 18, 6, 0.75)";
  ctx.fillRect(-50, braceW * 0.5 - 3, len + 100, 3);

  // Rivets on diagonal brace ends
  drawRivet(70, 0, 7);
  drawRivet(len - 70, 0, 7);

  ctx.restore();

  // ==========================================
  // 3. OUTER BORDER FRAME (4 PERIMETER BEAMS)
  // ==========================================
  const drawFrameBeam = (
    rect: [number, number, number, number],
    vertical: boolean,
    tones: [string, string, string],
    knot?: [number, number, number, number, number],
  ): void => {
    const [bx, by, bw, bh] = rect;
    const grad = vertical
      ? ctx.createLinearGradient(bx, by, bx + bw, by)
      : ctx.createLinearGradient(bx, by, bx, by + bh);
    grad.addColorStop(0.0, tones[0]);
    grad.addColorStop(0.5, tones[1]);
    grad.addColorStop(1.0, tones[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, bw, bh);

    // Wood grain
    drawWoodGrain(rect, vertical, 36, 0.25);

    // Knot if specified
    if (knot) {
      drawWoodKnot(...knot);
    }

    // Outer highlight and inner shadow bevels
    if (vertical) {
      ctx.fillStyle = "rgba(255, 245, 220, 0.55)";
      ctx.fillRect(bx, by, 3, bh);
      ctx.fillStyle = "rgba(40, 20, 5, 0.75)";
      ctx.fillRect(bx + bw - 3, by, 3, bh);
    } else {
      ctx.fillStyle = "rgba(255, 245, 220, 0.55)";
      ctx.fillRect(bx, by, bw, 3);
      ctx.fillStyle = "rgba(40, 20, 5, 0.75)";
      ctx.fillRect(bx, by + bh - 3, bw, 3);
    }
  };

  // Top beam
  drawFrameBeam(
    [0, 0, size, frameW],
    false,
    ["#edd3a0", "#dfb476", "#c89753"],
    [size * 0.4, frameW * 0.5, 24, 16, 0.05],
  );
  // Bottom beam
  drawFrameBeam(
    [0, size - frameW, size, frameW],
    false,
    ["#e4be82", "#d5a463", "#bc8541"],
    [size * 0.42, size - frameW * 0.5, 22, 15, 0.1],
  );
  // Left beam
  drawFrameBeam(
    [0, 0, frameW, size],
    true,
    ["#ebd09d", "#dfb375", "#c69450"],
    [frameW * 0.5, size * 0.62, 16, 26, 0.12],
  );
  // Right beam
  drawFrameBeam(
    [size - frameW, 0, frameW, size],
    true,
    ["#e2ba7c", "#d19f5c", "#b67d38"],
    [size - frameW * 0.5, size * 0.7, 16, 25, -0.08],
  );

  // Outer frame corner joint lines
  ctx.strokeStyle = "rgba(35, 18, 6, 0.85)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, frameW);
  ctx.lineTo(frameW, frameW);
  ctx.moveTo(size - frameW, frameW);
  ctx.lineTo(size, frameW);
  ctx.moveTo(0, size - frameW);
  ctx.lineTo(frameW, size - frameW);
  ctx.moveTo(size - frameW, size - frameW);
  ctx.lineTo(size, size - frameW);
  ctx.stroke();

  // Rivets on outer wooden frame
  drawRivet(size * 0.5, frameW * 0.5, 6.5);
  drawRivet(size * 0.5, size - frameW * 0.5, 6.5);
  drawRivet(frameW * 0.5, size * 0.32, 6.5);
  drawRivet(frameW * 0.5, size * 0.78, 6.5);
  drawRivet(size - frameW * 0.5, size * 0.32, 6.5);
  drawRivet(size - frameW * 0.5, size * 0.78, 6.5);

  // ==========================================
  // 4. METAL CORNER BRACKETS (L-BRACKETS)
  // ==========================================
  const armL = 136;
  const armW = 38;

  const drawCornerBracket = (
    cornerX: number,
    cornerY: number,
    dirX: 1 | -1,
    dirY: 1 | -1,
  ): void => {
    ctx.save();
    ctx.translate(cornerX, cornerY);
    ctx.scale(dirX, dirY);

    // Bracket drop shadow
    ctx.fillStyle = "rgba(10, 5, 2, 0.65)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(armL + 4, 0);
    ctx.lineTo(armL + 4, armW + 4);
    ctx.lineTo(armW + 4, armW + 4);
    ctx.lineTo(armW + 4, armL + 4);
    ctx.lineTo(0, armL + 4);
    ctx.closePath();
    ctx.fill();

    // Metal base gradient
    const mGrad = ctx.createLinearGradient(0, 0, armL, armL);
    mGrad.addColorStop(0.0, "#606672");
    mGrad.addColorStop(0.3, "#474b53");
    mGrad.addColorStop(0.7, "#303339");
    mGrad.addColorStop(1.0, "#202226");
    ctx.fillStyle = mGrad;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(armL, 0);
    ctx.lineTo(armL, armW);
    ctx.lineTo(armW, armW);
    ctx.lineTo(armW, armL);
    ctx.lineTo(0, armL);
    ctx.closePath();
    ctx.fill();

    // 3D Bevel highlight & shadow on metal edges
    ctx.strokeStyle = "rgba(220, 230, 245, 0.75)";
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(0, armL);
    ctx.lineTo(0, 0);
    ctx.lineTo(armL, 0);
    ctx.stroke();

    ctx.strokeStyle = "rgba(12, 14, 18, 0.9)";
    ctx.beginPath();
    ctx.moveTo(armL, 0);
    ctx.lineTo(armL, armW);
    ctx.lineTo(armW, armW);
    ctx.lineTo(armW, armL);
    ctx.lineTo(0, armL);
    ctx.stroke();

    // Rivets on bracket arms
    drawRivet(armL - 26, armW * 0.5, 5.5, true);
    drawRivet(armW * 0.5, armL - 26, 5.5, true);

    ctx.restore();
  };

  // 4 corners: Top-Left, Top-Right, Bottom-Left, Bottom-Right
  drawCornerBracket(0, 0, 1, 1);
  drawCornerBracket(size, 0, -1, 1);
  drawCornerBracket(0, size, 1, -1);
  drawCornerBracket(size, size, -1, -1);

  // Outer border dark vignette
  ctx.strokeStyle = "rgba(20, 12, 5, 0.5)";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  return Texture.fromCanvas(canvas, {
    anisotropy: 16,
    generateMipmaps: true,
  });
}

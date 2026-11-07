import {
  cropImage,
  autocropImage,
  flipImage,
  rotateImage,
  scaleImage,
  padToPowerOfTwo,
  recolorImage,
  adjustImage,
  grayscaleImage,
  invertImage,
  sepiaImage,
  posterizeImage,
  autoLevelsImage,
  outlineImage,
  chromaKeyImage,
  despeckleImage,
  generateEmissiveMap,
  generateAoMap,
  type AdjustOptions,
} from "./CanvasOps.js";
import { generateNormalMap, generateDepthMap, removeBackground } from "./BackgroundRemoval.js";

export interface CanvasActionChip {
  id: string;
  label: string;
  icon: string;
  category: "transform" | "color" | "cleanup" | "maps" | "sprites";
  execute: (
    src: ImageData,
  ) =>
    | ImageData
    | { normalMap?: ImageData; depthMap?: ImageData; sliceCount?: number; autoSprites?: boolean };
}

/**
 * Parses raw AI text and extracts all actionable command chips with execution handlers.
 */
export function parseActionChips(text: string): CanvasActionChip[] {
  const chips: CanvasActionChip[] = [];
  const seen = new Set<string>();

  function addChip(chip: CanvasActionChip): void {
    if (!seen.has(chip.id)) {
      seen.add(chip.id);
      chips.push(chip);
    }
  }

  // 1. [REMBG]
  if (/\[REMBG\]/i.test(text)) {
    addChip({
      id: "rembg",
      label: "Hintergrund entfernen",
      icon: "🪄",
      category: "cleanup",
      execute: (src) => removeBackground(src, { tolerance: 28, feather: 2 }),
    });
  }

  // 2. [AUTOCROP] or [TRIM]
  if (/\[AUTOCROP\]|\[TRIM\]/i.test(text)) {
    addChip({
      id: "autocrop",
      label: "Transparenten Rand trimmen",
      icon: "✂️",
      category: "transform",
      execute: (src) => autocropImage(src),
    });
  }

  // 3. [CROP: x, y, w, h]
  const cropMatch = text.match(/\[CROP:\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/i);
  if (cropMatch) {
    const x = parseInt(cropMatch[1]!, 10);
    const y = parseInt(cropMatch[2]!, 10);
    const w = parseInt(cropMatch[3]!, 10);
    const h = parseInt(cropMatch[4]!, 10);
    addChip({
      id: `crop_${x}_${y}_${w}_${h}`,
      label: `Zuschneiden (${w}x${h}px)`,
      icon: "📐",
      category: "transform",
      execute: (src) => cropImage(src, x, y, w, h),
    });
  }

  // 4. [FLIP_H] / [FLIP_V]
  if (/\[FLIP_H\]/i.test(text)) {
    addChip({
      id: "flip_h",
      label: "Horizontal spiegeln",
      icon: "🪞",
      category: "transform",
      execute: (src) => flipImage(src, true, false),
    });
  }
  if (/\[FLIP_V\]/i.test(text)) {
    addChip({
      id: "flip_v",
      label: "Vertikal spiegeln",
      icon: "🔃",
      category: "transform",
      execute: (src) => flipImage(src, false, true),
    });
  }

  // 5. [ROTATE: 90|-90|180|270]
  const rotMatch = text.match(/\[ROTATE:\s*(-?\d+)\s*\]/i);
  // Only right-angle rotations are offered: `rotateImage` throws for anything else, and the
  // chip's execute has no error path, so an unsupported angle must not become a clickable chip.
  if (rotMatch && [0, 90, 180, 270].includes(((parseInt(rotMatch[1]!, 10) % 360) + 360) % 360)) {
    const deg = parseInt(rotMatch[1]!, 10);
    addChip({
      id: `rotate_${deg}`,
      label: `Drehen (${deg}°)`,
      icon: "🔄",
      category: "transform",
      execute: (src) => rotateImage(src, deg),
    });
  }

  // 6. [SCALE: 2x|4x|0.5x]
  const scaleMatch = text.match(/\[SCALE:\s*([\d.]+)x?\]/i);
  if (scaleMatch) {
    const factor = parseFloat(scaleMatch[1]!);
    addChip({
      id: `scale_${factor}`,
      label: `Pixel-Scale (${factor}x)`,
      icon: "🔍",
      category: "transform",
      execute: (src) => scaleImage(src, factor),
    });
  }

  // 7. [PAD_POT] (Power of Two)
  if (/\[PAD_POT\]/i.test(text)) {
    addChip({
      id: "pad_pot",
      label: "Auf Power of 2 erweitern",
      icon: "⬛",
      category: "transform",
      execute: (src) => padToPowerOfTwo(src),
    });
  }

  // 8. [RECOLOR: #from -> #to]
  const recolorMatches = text.matchAll(
    /\[RECOLOR:\s*(#[0-9a-fA-F]{3,6})\s*->\s*(#[0-9a-fA-F]{3,6})(?:,\s*(\d+))?\]/gi,
  );
  for (const m of recolorMatches) {
    const fromHex = m[1]!;
    const toHex = m[2]!;
    const tol = m[3] ? parseInt(m[3], 10) : 35;
    addChip({
      id: `recolor_${fromHex}_${toHex}`,
      label: `Umfärben (${fromHex} → ${toHex})`,
      icon: "🎨",
      category: "color",
      execute: (src) => recolorImage(src, fromHex, toHex, tol),
    });
  }

  // 9. [ADJUST: ...]
  const adjustMatch = text.match(/\[ADJUST:\s*([^\]]+)\]/i);
  if (adjustMatch) {
    const params = adjustMatch[1]!;
    const bMatch = params.match(/brightness=([\d.]+)/i);
    const cMatch = params.match(/contrast=([\d.]+)/i);
    const sMatch = params.match(/saturation=([\d.]+)/i);
    const hMatch = params.match(/hue=([\d.]+)/i);
    const gMatch = params.match(/gamma=([\d.]+)/i);

    const options: AdjustOptions = {};
    if (bMatch) options.brightness = parseFloat(bMatch[1]!);
    if (cMatch) options.contrast = parseFloat(cMatch[1]!);
    if (sMatch) options.saturation = parseFloat(sMatch[1]!);
    if (hMatch) options.hue = parseFloat(hMatch[1]!);
    if (gMatch) options.gamma = parseFloat(gMatch[1]!);

    addChip({
      id: `adjust_${params}`,
      label: "Farbkorrektur / Filter anwenden",
      icon: "🎛️",
      category: "color",
      execute: (src) => adjustImage(src, options),
    });
  }

  // 10. [GRAYSCALE]
  if (/\[GRAYSCALE\]/i.test(text)) {
    addChip({
      id: "grayscale",
      label: "In Graustufen umwandeln",
      icon: "⚪",
      category: "color",
      execute: (src) => grayscaleImage(src),
    });
  }

  // 11. [INVERT]
  if (/\[INVERT\]/i.test(text)) {
    addChip({
      id: "invert",
      label: "Farben invertieren",
      icon: "☯️",
      category: "color",
      execute: (src) => invertImage(src),
    });
  }

  // 12. [SEPIA]
  if (/\[SEPIA\]/i.test(text)) {
    addChip({
      id: "sepia",
      label: "Sepia Retro-Ton",
      icon: "📜",
      category: "color",
      execute: (src) => sepiaImage(src),
    });
  }

  // 13. [POSTERIZE: N]
  const postMatch = text.match(/\[POSTERIZE:\s*(\d+)\]/i);
  if (postMatch) {
    const levels = parseInt(postMatch[1]!, 10);
    addChip({
      id: `posterize_${levels}`,
      label: `Palette reduzieren (${levels} Stufen)`,
      icon: "🕹️",
      category: "color",
      execute: (src) => posterizeImage(src, levels),
    });
  }

  // 14. [AUTO_LEVELS]
  if (/\[AUTO_LEVELS\]/i.test(text)) {
    addChip({
      id: "auto_levels",
      label: "Auto-Kontrast & Dynamik",
      icon: "⚡",
      category: "color",
      execute: (src) => autoLevelsImage(src),
    });
  }

  // 15. [OUTLINE: #hex, thickness]
  const outlineMatch = text.match(/\[OUTLINE:\s*(#[0-9a-fA-F]{3,6})(?:,\s*(\d+))?\]/i);
  if (outlineMatch) {
    const hex = outlineMatch[1]!;
    const thick = outlineMatch[2] ? parseInt(outlineMatch[2], 10) : 1;
    addChip({
      id: `outline_${hex}_${thick}`,
      label: `Pixel-Outline (${hex}, ${thick}px)`,
      icon: "🖊️",
      category: "cleanup",
      execute: (src) => outlineImage(src, hex, thick),
    });
  }

  // 16. [CHROMA_KEY: #hex]
  const chromaMatch = text.match(/\[CHROMA_KEY:\s*(#[0-9a-fA-F]{3,6})(?:,\s*(\d+))?\]/i);
  if (chromaMatch) {
    const hex = chromaMatch[1]!;
    const tol = chromaMatch[2] ? parseInt(chromaMatch[2], 10) : 35;
    addChip({
      id: `chromakey_${hex}`,
      label: `Farbe entfernen (${hex})`,
      icon: "🟢",
      category: "cleanup",
      execute: (src) => chromaKeyImage(src, hex, tol),
    });
  }

  // 17. [DESPECKLE]
  if (/\[DESPECKLE\]/i.test(text)) {
    addChip({
      id: "despeckle",
      label: "Isolierte Pixel bereinigen",
      icon: "🧹",
      category: "cleanup",
      execute: (src) => despeckleImage(src),
    });
  }

  // 18. [AUTO_SPRITES]
  if (/\[AUTO_SPRITES\]/i.test(text)) {
    addChip({
      id: "auto_sprites",
      label: "Sprites automatisch erkennen",
      icon: "✨",
      category: "sprites",
      execute: () => ({ autoSprites: true }),
    });
  }

  // 19. [SLICE: N]
  const sliceMatch = text.match(/\[SLICE:\s*(\d+)\]/i);
  if (sliceMatch) {
    const count = parseInt(sliceMatch[1]!, 10);
    addChip({
      id: `slice_${count}`,
      label: `In ${count} Segmente zerschneiden`,
      icon: "✂️",
      category: "sprites",
      execute: () => ({ sliceCount: count }),
    });
  }

  // 20. [NORMAL_MAP]
  if (/\[NORMAL_MAP\]/i.test(text)) {
    addChip({
      id: "normal_map",
      label: "Normal Map berechnen",
      icon: "🏔️",
      category: "maps",
      execute: (src) => ({ normalMap: generateNormalMap(src, 2.5) }),
    });
  }

  // 21. [DEPTH_MAP]
  if (/\[DEPTH_MAP\]/i.test(text)) {
    addChip({
      id: "depth_map",
      label: "Depth Map berechnen",
      icon: "🌊",
      category: "maps",
      execute: (src) => ({ depthMap: generateDepthMap(src) }),
    });
  }

  // 22. [EMISSIVE_MAP]
  if (/\[EMISSIVE_MAP\]/i.test(text)) {
    addChip({
      id: "emissive_map",
      label: "Emissive / Glow Map",
      icon: "💡",
      category: "maps",
      execute: (src) => generateEmissiveMap(src, 200),
    });
  }

  // 23. [AO_MAP]
  if (/\[AO_MAP\]/i.test(text)) {
    addChip({
      id: "ao_map",
      label: "Ambient Occlusion Map",
      icon: "🌑",
      category: "maps",
      execute: (src) => generateAoMap(src, 4),
    });
  }

  return chips;
}

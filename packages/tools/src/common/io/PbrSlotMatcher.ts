import type { PbrSetMatch } from "./UniversalIngestTypes.js";

/**
 * Common PBR map suffix / keyword patterns.
 */
const MAP_PATTERNS = {
  albedo: /(?:_|\b)(?:albedo|alb|basecolor|base_color|color|col|diffuse|diff|d)(?:_|\.|$)/i,
  normal: /(?:_|\b)(?:normal|norm|nor|nrm|normalgl|normaldx|n)(?:_|\.|$)/i,
  roughness: /(?:_|\b)(?:roughness|rough|rgh|r)(?:_|\.|$)/i,
  metallic: /(?:_|\b)(?:metallic|metalness|metal|met|m)(?:_|\.|$)/i,
  ao: /(?:_|\b)(?:ao|ambientocclusion|ambient_occlusion|occlusion|occ)(?:_|\.|$)/i,
  height: /(?:_|\b)(?:height|displacement|disp|depth|bump|h)(?:_|\.|$)/i,
  emissive: /(?:_|\b)(?:emissive|emission|emit|glow|e)(?:_|\.|$)/i,
};

type PbrSlot = keyof typeof MAP_PATTERNS;

const SLOT_ORDER: readonly PbrSlot[] = [
  "normal",
  "roughness",
  "metallic",
  "ao",
  "height",
  "emissive",
  "albedo",
];

/**
 * Finds the slot a file name belongs to. The trailing token wins (`m_albedo.png` is albedo, not
 * metallic); only if it names no slot, a keyword anywhere in the name decides.
 */
function detectSlot(filename: string): PbrSlot | undefined {
  const base = filename.replace(/\.[^/.]+$/, "");
  const lastToken = base.split(/[_\-. ]+/).pop() ?? "";
  for (const slot of SLOT_ORDER) {
    if (MAP_PATTERNS[slot].test(`_${lastToken}.`)) return slot;
  }
  return SLOT_ORDER.find((slot) => MAP_PATTERNS[slot].test(filename));
}

export interface MatchableFile {
  name: string;
  blob: Blob | File;
}

/**
 * Matches a list of files to PBR texture slots by inspecting filenames.
 */
export function matchPbrSlots(files: MatchableFile[]): PbrSetMatch | null {
  const [firstFile] = files;
  if (undefined === firstFile) return null;

  const result: PbrSetMatch = {
    name: extractBaseSetname(firstFile.name),
  };

  let matchedSlotsCount = 0;

  for (const file of files) {
    const filename = file.name.toLowerCase();

    // Check if it's an image file
    if (!/\.(?:png|jpe?g|webp|bmp|tga|dds|exr|hdr)$/i.test(filename)) {
      continue;
    }

    const slot = detectSlot(filename);
    if (undefined !== slot && undefined === result[slot]) {
      result[slot] = file.blob;
      matchedSlotsCount++;
    } else if (undefined === slot && undefined === result.albedo) {
      // Fallback: first unassigned image becomes albedo if no explicit pattern matched
      result.albedo = file.blob;
      matchedSlotsCount++;
    }
  }

  // If at least 2 distinct slots or albedo + normal was found, it's a valid PBR set
  if (matchedSlotsCount >= 2 || (result.albedo && (result.normal || result.roughness))) {
    return result;
  }

  return null;
}

/**
 * Cleans map suffixes to find the base texture set name (e.g. 'brick_wall_01_normal.png' -> 'brick_wall_01').
 */
function extractBaseSetname(filename: string): string {
  return (
    filename
      .replace(/\.[^/.]+$/, "")
      .replace(
        /(?:_|\b)(?:albedo|alb|basecolor|color|diffuse|normal|norm|roughness|rough|metallic|metal|ao|height|disp|emissive|specular)$/i,
        "",
      )
      .replace(/_+$/, "") || "pbr_material"
  );
}

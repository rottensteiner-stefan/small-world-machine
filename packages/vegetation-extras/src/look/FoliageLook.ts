import { PostProcessingEffectType, ToneMappingMode } from "@small-world-machine/engine";
import type {
  ColorGradingElement,
  PostProcessingGroup,
  ToneMappingElement,
  Color,
} from "@small-world-machine/engine";

type Rgb = readonly [number, number, number];

/** Tone curve + parametric grade for one lighting situation. Values are display-referred. */
export interface FoliageLook {
  readonly name: string;
  readonly toneMapping: ToneMappingMode;
  readonly exposure: number;
  readonly contrast: number;
  readonly saturation: number;
  readonly temperature: number;
  readonly tint: number;
  readonly lift: Rgb;
  readonly gamma: Rgb;
  readonly gain: Rgb;
}

const IDENTITY_GRADE = {
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  lift: [0, 0, 0],
  gamma: [1, 1, 1],
  gain: [1, 1, 1],
} as const;

/**
 * Look presets for vegetation scenes, tuned in showcase 52 against the neutral engine default.
 * - Sunlit scenes stay on PBR Neutral: it keeps hue and saturation below ~0.8, so the sky stays
 *   blue; AgX greyed a clear sky even at saturation 1.3. Exposure + a light warm grade lift the
 *   foliage out of the mud.
 * - Shade, backlight and overcast use AgX: its soft shoulder holds the bright sky behind dark
 *   canopies, and the extra exposure/saturation brings the shadowed greens back.
 */
export const FOLIAGE_LOOKS = {
  NEUTRAL: {
    name: "Neutral (engine default)",
    toneMapping: ToneMappingMode.DEFAULT,
    exposure: 1,
    ...IDENTITY_GRADE,
  },
  SUNNY_MEADOW: {
    name: "Sunny meadow",
    toneMapping: ToneMappingMode.PBR_NEUTRAL,
    exposure: 1.25,
    contrast: 1.05,
    saturation: 1.08,
    temperature: 0.04,
    tint: -0.01,
    lift: [0, 0.004, 0.01],
    gamma: [1, 1, 1],
    gain: [1.02, 1, 0.97],
  },
  FOREST_SHADE: {
    name: "Forest shade",
    toneMapping: ToneMappingMode.AGX,
    exposure: 1.35,
    contrast: 1.05,
    saturation: 1.15,
    temperature: 0.02,
    tint: -0.02,
    lift: [0, 0.006, 0.003],
    gamma: [1, 1.02, 1],
    gain: [1.01, 1, 0.98],
  },
  OVERCAST: {
    name: "Overcast",
    toneMapping: ToneMappingMode.AGX,
    exposure: 1.2,
    contrast: 0.98,
    saturation: 0.96,
    temperature: -0.05,
    tint: 0,
    lift: [0.004, 0.006, 0.01],
    gamma: [1, 1, 1],
    gain: [0.99, 1, 1.02],
  },
} as const satisfies Record<string, FoliageLook>;

const setColor = (target: Color, rgb: Rgb): void => {
  target.r = rgb[0];
  target.g = rgb[1];
  target.b = rgb[2];
};

/**
 * Writes a look into the tone-mapping and color-grading elements of a post-processing group and
 * enables both. Grading needs post-processing on (`postProcessing: { enabled: true }`); the forward
 * pass only knows the tone curve.
 */
export function applyFoliageLook(postProcessing: PostProcessingGroup, look: FoliageLook): void {
  const tone = postProcessing.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING);
  if (tone !== undefined) {
    tone.enabled = true;
    tone.mode = look.toneMapping;
    tone.exposure = look.exposure;
  }
  const grade = postProcessing.get<ColorGradingElement>(PostProcessingEffectType.COLOR_GRADING);
  if (grade === undefined) {
    return;
  }
  grade.enabled = true;
  grade.contrast = look.contrast;
  grade.saturation = look.saturation;
  grade.temperature = look.temperature;
  grade.tint = look.tint;
  setColor(grade.lift, look.lift);
  setColor(grade.gamma, look.gamma);
  setColor(grade.gain, look.gain);
}

export const ToolEvents = {
  Pixler: {
    LOAD_BASE64: "tool:pixler:loadBase64",
    IMAGE_SAVED: "tool:pixler:imageSaved",
  },
  Xtractor: {
    EXTRACTED: "tool:xtractor:extracted",
  },
} as const;

export type ToolEvents = typeof ToolEvents;

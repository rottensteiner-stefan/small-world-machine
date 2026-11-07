/**
 * Types of events dispatched by the engine.
 */
export const EventType = {
  /** Dispatched when an audio sample has been fetched and decoded successfully. */
  AUDIO_LOADED: "AudioLoaded",
  /** Dispatched when a loader finishes. */
  LOADER_END: "LoaderEnd",
  /** Dispatched when a loader encounters an error. */
  LOADER_ERROR: "LoaderError",
  /** Dispatched when a loader makes progress. */
  LOADER_PROGRESS: "LoaderProgress",
  /** Dispatched when a loader starts. */
  LOADER_START: "LoaderStart",
} as const;

/** Type definition for EventType. */
export type EventType = (typeof EventType)[keyof typeof EventType];

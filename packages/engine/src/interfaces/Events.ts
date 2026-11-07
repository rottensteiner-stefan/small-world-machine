import type { EventType } from "../enums/index.js";

/** Type for event handler functions. */
export type EventHandler = (event: Record<string, unknown>) => void;

/**
 * Interface for event dispatching and listening.
 */
export interface Events {
  /**
   * Registers an event listener.
   * @param type The event type.
   * @param listener The callback function.
   */
  addEventListener(type: string | EventType, listener: EventHandler): void;

  /**
   * Removes a registered event listener.
   * @param type The event type.
   * @param listener The callback function to remove.
   */
  removeEventListener(type: string | EventType, listener: EventHandler): void;

  /**
   * Dispatches an event.
   * @param type The event type.
   * @param eventData Optional data associated with the event.
   */
  dispatchEvent(type: string | EventType, eventData?: Record<string, unknown>): void;
}

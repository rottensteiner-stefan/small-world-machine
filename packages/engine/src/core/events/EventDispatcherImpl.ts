import type { EventType } from "../../enums/index.js";
import type { Events, EventHandler } from "../../interfaces/index.js";

/**
 * Standard implementation of the Events interface with zero-allocation dispatch.
 */
export class EventDispatcherImpl implements Events {
  private _listeners: Map<string, EventHandler[]> = new Map<string, EventHandler[]>();
  private _dispatchDepth: number = 0;

  /**
   * @inheritdoc
   */
  public addEventListener(type: string | EventType, listener: EventHandler): void {
    const eventName: string = type as string;
    let list = this._listeners.get(eventName);
    if (!list) {
      list = [];
      this._listeners.set(eventName, list);
    } else if (0 < this._dispatchDepth) {
      // Copy-on-write if mutated while actively dispatching
      list = list.slice(0);
      this._listeners.set(eventName, list);
    }
    list.push(listener);
  }

  /**
   * @inheritdoc
   */
  public removeEventListener(type: string | EventType, listener: EventHandler): void {
    const eventName: string = type as string;
    let list = this._listeners.get(eventName);
    if (list) {
      const index: number = list.indexOf(listener);
      if (-1 !== index) {
        if (0 < this._dispatchDepth) {
          // Copy-on-write if mutated while actively dispatching
          list = list.slice(0);
          this._listeners.set(eventName, list);
        }
        list.splice(index, 1);
      }
    }
  }

  /**
   * @inheritdoc
   */
  public dispatchEvent(type: string | EventType, eventData: Record<string, unknown> = {}): void {
    const eventName: string = type as string;
    const listeners: EventHandler[] | undefined = this._listeners.get(eventName);
    if (listeners && 0 < listeners.length) {
      eventData["type"] = eventName;
      this._dispatchDepth++;
      try {
        for (let i = 0; i < listeners.length; i++) {
          listeners[i]!(eventData);
        }
      } finally {
        this._dispatchDepth--;
      }
    }
  }
}

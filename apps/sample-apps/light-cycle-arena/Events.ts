/**
 * Event names Light Cycle Arena dispatches on the shared `EventDispatcherImpl` bus,
 * used to decouple round logic (App) from presentation (Hud).
 */
export const Events = {
  ROUND_OVER: "app:lightCycleArena:roundOver",
} as const;

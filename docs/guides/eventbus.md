# EventBus & Game Loop

In modern 3D applications, UI coupled directly to the 3D engine or the game loop produces spaghetti code and performance bottlenecks. The **Small World Machine** provides a built-in, type-safe, allocation-free **EventBus** (`EventDispatcherImpl`) to cleanly decouple systems.

## The application EventBus

Because Small World Machine enforces strict multi-instantiation (no global singletons), the EventBus is attached to your own `SmallWorldMachine` application instance.

Access it via `app.events` (or pass it via constructor injection):

```typescript
// Assuming `app` is your own SmallWorldMachine instance
app.events.dispatchEvent("MyEvent", { data: 123 });
```

## Defining strongly-typed events

To avoid brittle "magic strings" and typos throughout the codebase, events should always be defined as structured constants (`as const`) or `enums`. This gives maximum autocompletion and type safety.

```typescript
// Event definitions (your own, game-specific registry)
export const MyGameEvents = {
  PLAYER: {
    DAMAGE: "MyGameEvents:PLAYER:DAMAGE",
    HEAL: "MyGameEvents:PLAYER:HEAL",
  },
  WEAPON: {
    FIRE: "MyGameEvents:WEAPON:FIRE",
  }
} as const;
```

::: tip No built-in event registry
The engine itself does not ship a built-in event registry — there is no `AppEvents` export. Each app defines its own local registry following the pattern above. The YAD sample app is a good reference: `apps/sample-apps/yad/Events.ts` defines a plain `Events` constant (e.g. `Events.DAMAGE = "app:yad:damage"`, `Events.SHOOT = "app:yad:shoot"`) dispatched on the shared `EventDispatcherImpl` bus to decouple gameplay logic from presentation. Define an equivalent registry for your own game rather than looking for one to extend.
:::

## Dispatching events

Instead of using the DOM's own `window.dispatchEvent` (which incurs significant garbage-collection overhead and isn't strictly typed), use the engine's built-in `events` property to broadcast game events with your own typed constants.

```typescript
takeDamage(amount: number) {
  this.health -= amount;

  // Dispatch via an injected EventDispatcherImpl (e.g. this.events)
  this.events.dispatchEvent(MyGameEvents.PLAYER.DAMAGE, { amount: 15, source: "lava" });
}
```

## Listening for events

UI components (e.g. a HUD) or other decoupled systems can simply take the `Events` interface and listen for specific events from your own registry.

```typescript
import { MyGameEvents } from "./events.js";

export function buildHUD(app: SmallWorldMachine) {
  const healthLabel = document.createElement("div");

  // The UI listens for application-level events
  app.events.addEventListener(MyGameEvents.PLAYER.DAMAGE, (e: Record<string, unknown>) => {
      const damage = e['amount'] as number;
      console.log(`Player took ${damage} damage!`);
      // Update the UI here...
    });
  }
```

## Why not native DOM events?

Native `CustomEvent` objects in the browser are tightly bound to the DOM tree and consume memory that the garbage collector eventually has to clean up. By using a plain, generic TypeScript `EventDispatcher`, the **Small World Machine** ensures core logic stays decoupled from the browser environment — enabling predictable performance and potentially running your own logic in Web Workers.

# Building Your Own Game

The **Small World Machine** is designed to scale from simple rotating cubes to fully-fledged game loops with custom logic, controllers, and UI.

## The Architecture of a Game

A typical project should be split into the following modular parts:
1. **The app (`MyGameApp.ts`)**: Extends `SmallWorldMachine`. Builds the scene, loads textures, and initializes the camera and UI.
2. **The level builder**: Uses `GridLevelBuilder` or generates the scene graph procedurally.
3. **The controller (`MyController.ts`)**: Extends `FirstPersonController` or `OrbitController`. This is the core logic for input and movement.
4. **The UI (`MyHud.ts`)**: A decoupled HTML overlay that listens to `Events`.

## 1. Creating Your Own Controller

In Small World Machine, controllers are simply `Behavior` components attached to a camera or an object. The built-in controllers can be extended to add game-specific logic such as shooting, raycasting, or item pickup.

```typescript
import { EventDispatcherImpl, FirstPersonController, FirstPersonControllerOptions } from "@small-world-machine/engine";
import { Keys } from "@small-world-machine/engine";

export class MyController extends FirstPersonController {
  constructor(private readonly events: EventDispatcherImpl, options: FirstPersonControllerOptions) {
    super(options);
  }

  public override update(deltaTime: number): void {
    // 1. Let the base class handle WASD movement and collision
    super.update(deltaTime);

    // 2. Add custom logic (e.g. shooting)
    if (this._options.input.isPressed(Keys.SPACE)) {
       // Fire a bullet, perform a raycast...
       console.log("Pew pew!");

       // Use the injected EventBus (passed via the constructor)
       this.events.dispatchEvent("shoot-weapon", { ammoCost: 1 });
    }
  }
}
```

## 2. Starting the Application (Bootstrapping)

Now let's wire up the controller, scene, and UI in our `SmallWorldMachine` subclass.

```typescript
import { SmallWorldMachine } from "@small-world-machine/engine";
import { MyController } from "./MyController.js";
import { MyHud } from "./MyHud.js";

export class MyGameApp extends SmallWorldMachine {
  private _hud!: MyHud;

  protected async setupScene(): Promise<void> {
    // Initialize the UI - pass the event bus explicitly
    this._hud = new MyHud(this.events);

    // Attach our own controller as a behavior on the camera.
    // The behavior system handles the update loop automatically.
    this.camera.addBehavior(
      new MyController(this.events, {
        scene: this.scene,
        input: this.input,
        moveSpeed: 15.0,
      })
    );
  }

  protected override update(deltaTime: number): void {
    // Game loop logic...
  }
}

// Start the game
const app = new MyGameApp();
app.start();
```

This code structure keeps game logic (controller), rendering logic (app/scene), and the user interface (HUD) fully independent and easy to test or refactor!

## Reference Implementation: YAD (Yet Another Dungeon)

The Small World Machine includes a complete, working showcase called **YAD (Yet Another Dungeon)**, located at `apps/sample-apps/yad`. YAD is the canonical reference architecture for building a real game.

YAD demonstrates:
1. **Event-driven decoupling:** How gameplay and presentation communicate through the shared `app.events` bus (`apps/sample-apps/yad/Events.ts`).
2. **Procedural level generation:** How the `GridLevelBuilder` (engine core, wrapped in `yad/core/LevelBuilder.ts`) parses an ASCII string map into 3D meshes, spawning `EnemyBehavior`-driven enemy sprites and pickup sprites.
3. **Enemy logic:** How `EnemyBehavior` implements simple distance-based pursuit logic (detection radius, pursuit, attack range). YAD does not use the engine's `StateMachine`/FSM module for its enemies - it's available (see [State Machines](./state-machines)) if richer state logic is needed.
4. **A custom controller:** `Controller` (in `core/behaviors/Controller.ts`) inherits from `FirstPersonController` and adds footstep sounds (via an injected `AudioSystem` instance), weapon-sway animation (rendered by `Hud`), and raycasted attacks.
5. **Decoupled UI (`Hud`, in `core/Hud.ts`):** A strict HTML overlay that listens to the app's `Events` (`apps/sample-apps/yad/Events.ts`) to update health bars and log chat messages.

When starting a new project, it is strongly recommended to read through `apps/sample-apps/yad` to understand how the architecture scales!

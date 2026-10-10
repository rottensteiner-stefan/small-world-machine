# State Machines (FSM)

Small World Machine provides a built-in, type-safe, allocation-free **finite state machine (FSM)** tool. This framework decouples actor logic, physics update ticks, and phase transitions into clean, isolated classes.

Every FSM callback (`onEnter`/`onUpdate`/`onExit`) receives a **state data** object - the self-defined payload shared by every state of that machine. Not to be confused with the `Context Object` (the engine's constructor-injected dependency container) or the `State` itself (the FSM's current mode, e.g. `"idle"`/`"patrolling"`) - state data is a third, distinct concept: simply the data that a given machine's states read and mutate.

## Features

- **Generic & type-safe:** Constrains transitions and callbacks to predefined states `TState` and events `TEvent` via TypeScript generics.
- **Allocation-free hot path:** FSM transitions and state updates instantiate no new objects or callbacks at runtime, minimizing garbage-collection stutter during heavy simulation ticks.
- **Behavior integration:** Via the `StateMachineBehavior` adapter, state machines tick automatically once attached to any `Object3D`.

## State Machine Configuration

Below is an example of declaring states, configuring enter/update triggers, and mapping auto-transitions.

```typescript
import { StateMachine, StateMachineBehavior, Object3D } from "@small-world-machine/engine";

// 1. Declare the FSM's state data type
interface ActorStateData {
  object: Object3D;
  health: number;
}

// 2. Configure states and callbacks
const actor = new Object3D("Actor");
const stateData: ActorStateData = { object: actor, health: 100 };

const fsm = new StateMachine<"idle" | "patrolling" | "alert", ActorStateData, "SEE_PLAYER">(stateData);

// State: Idle (transitions to patrolling after 5 seconds)
fsm.addState("idle", {
  onEnter: (data, previousState) => {
    console.log(`Entered Idle from: ${previousState}`);
  },
  autoTransition: {
    duration: 5.0,
    nextState: "patrolling",
  },
  transitions: {
    SEE_PLAYER: "alert",
  },
});

// State: Patrolling
fsm.addState("patrolling", {
  onUpdate: (data, deltaTime, stateDuration) => {
    // Allocation-free update logic
    data.object.position.x += 1.0 * deltaTime;
  },
  transitions: {
    SEE_PLAYER: "alert",
  },
});

// State: Alert
fsm.addState("alert", {
  onEnter: (data) => {
    console.warn("Player spotted!");
  },
});

// 3. Attach StateMachineBehavior to the object
const fsmBehavior = new StateMachineBehavior(fsm);
actor.addBehavior(fsmBehavior);

// Start the machine
fsm.transitionTo("idle");
```

## Lifecycle Flow

The FSM lifecycle callbacks are invoked as follows:

1. **`onEnter(stateData, previousState)`**: Runs immediately after a transition.
2. **`onUpdate(stateData, deltaTime, stateDuration)`**: Runs every frame within the behavior tick.
3. **`onExit(stateData, nextState)`**: Runs immediately before the state transitions to a new one.
4. **`autoTransition`**: Automatically triggers a transition to `nextState` once `stateDuration >= duration`.

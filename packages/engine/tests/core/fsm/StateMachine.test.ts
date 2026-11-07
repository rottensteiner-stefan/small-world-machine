import { StateMachine } from "../../../src/core/fsm/StateMachine.js";
import { StateMachineBehavior } from "../../../src/core/behaviors/StateMachineBehavior.js";
import { Object3D } from "../../../src/core/Object3D.js";

describe("StateMachine & StateMachineBehavior", () => {
  it("should enter, update, exit, and transition between states correctly", () => {
    interface TestContext {
      value: number;
      enteredA: number;
      exitedA: number;
      enteredB: number;
    }

    const context: TestContext = {
      value: 0,
      enteredA: 0,
      exitedA: 0,
      enteredB: 0,
    };

    const fsm = new StateMachine<"A" | "B", TestContext, "TO_B">(context);

    fsm.addState("A", {
      onEnter: (ctx, prev) => {
        ctx.enteredA++;
        expect(prev).toBeNull();
      },
      onUpdate: (ctx, deltaTime) => {
        ctx.value += deltaTime;
      },
      onExit: (ctx, next) => {
        ctx.exitedA++;
        expect(next).toBe("B");
      },
      transitions: {
        TO_B: "B",
      },
    });

    fsm.addState("B", {
      onEnter: (ctx, prev) => {
        ctx.enteredB++;
        expect(prev).toBe("A");
      },
    });

    fsm.transitionTo("A");

    expect(fsm.currentState).toBe("A");
    expect(context.enteredA).toBe(1);

    fsm.update(0.5);
    expect(fsm.stateDuration).toBe(0.5);
    expect(context.value).toBe(0.5);

    fsm.sendEvent("TO_B");

    expect(fsm.currentState).toBe("B");
    expect(context.exitedA).toBe(1);
    expect(context.enteredB).toBe(1);
    expect(fsm.stateDuration).toBe(0);
  });

  it("should handle auto transitions based on duration", () => {
    interface TestContext {
      transitioned: boolean;
    }

    const context: TestContext = { transitioned: false };
    const fsm = new StateMachine<"A" | "B", TestContext>(context);

    fsm.addState("A", {
      autoTransition: {
        duration: 1.0,
        nextState: "B",
      },
    });

    fsm.addState("B", {
      onEnter: (ctx) => {
        ctx.transitioned = true;
      },
    });

    fsm.transitionTo("A");
    fsm.update(0.6);
    expect(fsm.currentState).toBe("A");
    expect(context.transitioned).toBe(false);

    fsm.update(0.5); // total duration 1.1 >= 1.0
    expect(fsm.currentState).toBe("B");
    expect(context.transitioned).toBe(true);
  });

  it("should update via StateMachineBehavior attached to Object3D", () => {
    interface TestContext {
      ticks: number;
    }
    const context: TestContext = { ticks: 0 };
    const fsm = new StateMachine<"active", TestContext>(context);
    fsm.addState("active", {
      onUpdate: (ctx) => {
        ctx.ticks++;
      },
    });
    fsm.transitionTo("active");

    const behavior = new StateMachineBehavior(fsm);
    const obj = new Object3D("test");
    obj.addBehavior(behavior);

    expect(context.ticks).toBe(0);
    behavior.update(0.1);
    expect(context.ticks).toBe(1);
  });
});

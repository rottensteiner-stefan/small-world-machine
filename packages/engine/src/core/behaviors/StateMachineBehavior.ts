import { Behavior } from "./Behavior.js";
import type { StateMachine } from "../fsm/index.js";

export class StateMachineBehavior<
  TState extends string,
  TContext,
  TEvent extends string = string,
> extends Behavior {
  public readonly stateMachine: StateMachine<TState, TContext, TEvent>;

  constructor(stateMachine: StateMachine<TState, TContext, TEvent>) {
    super();
    this.stateMachine = stateMachine;
  }

  public override update(deltaTime: number): void {
    if (!this.isActive) {
      return;
    }
    this.stateMachine.update(deltaTime);
  }
}

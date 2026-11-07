export interface StateConfig<TState extends string, TContext, TEvent extends string = string> {
  onEnter?: (context: TContext, previousState: TState | null) => void;
  onUpdate?: (context: TContext, deltaTime: number, stateDuration: number) => void;
  onExit?: (context: TContext, nextState: TState) => void;
  autoTransition?: {
    duration: number;
    nextState: TState;
  };
  transitions?: Partial<Record<TEvent, TState>>;
}

export class StateMachine<TState extends string, TContext, TEvent extends string = string> {
  private _states: Map<TState, StateConfig<TState, TContext, TEvent>> = new Map();
  private _currentState: TState | null = null;
  private _previousState: TState | null = null;
  private _stateDuration: number = 0;

  public readonly context: TContext;

  constructor(context: TContext) {
    this.context = context;
  }

  public addState(state: TState, config: StateConfig<TState, TContext, TEvent>): this {
    this._states.set(state, config);
    return this;
  }

  public get currentState(): TState | null {
    return this._currentState;
  }

  public get previousState(): TState | null {
    return this._previousState;
  }

  public get stateDuration(): number {
    return this._stateDuration;
  }

  public transitionTo(nextState: TState): void {
    if (this._currentState === nextState) {
      return;
    }

    const currentConfig = this._currentState ? this._states.get(this._currentState) : null;
    if (currentConfig?.onExit) {
      currentConfig.onExit(this.context, nextState);
    }

    this._previousState = this._currentState;
    this._currentState = nextState;
    this._stateDuration = 0;

    const nextConfig = this._states.get(nextState);
    if (nextConfig?.onEnter) {
      nextConfig.onEnter(this.context, this._previousState);
    }
  }

  public sendEvent(event: TEvent): void {
    if (!this._currentState) {
      return;
    }
    const currentConfig = this._states.get(this._currentState);
    if (!currentConfig || !currentConfig.transitions) {
      return;
    }
    const nextState = currentConfig.transitions[event];
    if (nextState !== undefined) {
      this.transitionTo(nextState);
    }
  }

  public update(deltaTime: number): void {
    if (!this._currentState) {
      return;
    }
    const config = this._states.get(this._currentState);
    if (!config) {
      return;
    }

    this._stateDuration += deltaTime;

    if (config.autoTransition && this._stateDuration >= config.autoTransition.duration) {
      this.transitionTo(config.autoTransition.nextState);
      return;
    }

    if (config.onUpdate) {
      config.onUpdate(this.context, deltaTime, this._stateDuration);
    }
  }
}

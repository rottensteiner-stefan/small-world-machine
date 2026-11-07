/**
 * Represents a task queued in the ThreadPool.
 */
export interface ThreadTask<TData, TResult> {
  /** Internal task ID. */
  id: number;
  /** The stringified function to execute. */
  fnString: string;
  /** The serializable data to pass to the function. */
  data: TData;
  /** Optional objects to transfer ownership to the worker. */
  transferables: Transferable[];
  /** Resolve callback for the Promise. */
  resolve: (value: TResult) => void;
  /** Reject callback for the Promise. */
  reject: (reason: unknown) => void;
}

/**
 * A generic Web Worker pool for offloading heavy CPU tasks.
 * Uses Blob URLs to dynamically spawn workers without requiring external script files.
 *
 * @example
 * const pool = new ThreadPool();
 * const result = await pool.execute((data) => {
 *   // Heavy calculation here. Runs on a background thread!
 *   // NOTE: Cannot access variables outside this function's scope.
 *   return data.a + data.b;
 * }, { a: 10, b: 20 });
 */
export class ThreadPool {
  private _workers: Worker[] = [];
  private _idleWorkers: Worker[] = [];
  private _taskQueue: ThreadTask<unknown, unknown>[] = [];
  private _taskCounter: number = 0;
  private _taskMap: Map<number, ThreadTask<unknown, unknown>> = new Map();

  /**
   * Creates a new ThreadPool.
   * @param poolSize The number of Web Workers to spawn. Defaults to navigator.hardwareConcurrency (or 4).
   */
  constructor(poolSize?: number) {
    const size =
      poolSize || (typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4);

    // The core worker logic injected into every Blob.
    const workerCode = `
      self.onmessage = async function(e) {
        const { id, fnString, data } = e.data;
        try {
          let fn;
          try {
            // Standard functions or arrow functions
            fn = new Function('return ' + fnString)();
          } catch (e) {
            // Fallback for ES6 class method shorthands e.g., "methodName(data) { ... }"
            const obj = new Function('return { ' + fnString + ' }')();
            fn = Object.values(obj)[0];
          }
          const result = await fn(data);
          
          // Auto-extract transferables (ArrayBuffers) for zero-copy return
          const transferables = new Set();
          const scan = (obj) => {
            if (!obj) return;
            if (obj instanceof ArrayBuffer) transferables.add(obj);
            else if (ArrayBuffer.isView(obj)) transferables.add(obj.buffer);
            else if (typeof obj === 'object') {
              for (const key in obj) scan(obj[key]);
            }
          };
          scan(result);
          
          self.postMessage({ id, success: true, result }, Array.from(transferables));
        } catch (err) {
          self.postMessage({ id, success: false, error: err.message || err.toString() });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: "application/javascript" });
    const workerUrl = URL.createObjectURL(blob);

    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerUrl);
      worker.onmessage = this._onWorkerMessage.bind(this, worker);
      worker.onerror = this._onWorkerError.bind(this, worker);
      this._workers.push(worker);
      this._idleWorkers.push(worker);
    }
  }

  /**
   * Executes a function on a background worker thread.
   *
   * @param fn The function to execute. **WARNING:** This function is serialized to a string.
   *           It cannot access variables, imports, or context outside its own scope.
   *           Everything it needs must be passed in via the `data` parameter.
   * @param data The input data passed to the function. Must be JSON serializable.
   * @param transferables Optional array of Transferable objects to pass by reference (zero-copy).
   * @returns A Promise resolving with the function's return value.
   */
  public async execute<TData, TResult>(
    fn: (data: TData) => TResult | Promise<TResult>,
    data: TData,
    transferables: Transferable[] = [],
  ): Promise<TResult> {
    return new Promise((resolve, reject) => {
      const task: ThreadTask<TData, TResult> = {
        id: ++this._taskCounter,
        fnString: fn.toString(),
        data,
        transferables,
        resolve,
        reject,
      };

      this._taskQueue.push(task as unknown as ThreadTask<unknown, unknown>);
      this._processQueue();
    });
  }

  /**
   * Processes the next task in the queue if an idle worker is available.
   */
  private _processQueue(): void {
    if (this._taskQueue.length === 0 || this._idleWorkers.length === 0) {
      return;
    }

    const worker = this._idleWorkers.pop()!;
    const task = this._taskQueue.shift()!;

    this._taskMap.set(task.id, task);

    worker.postMessage(
      {
        id: task.id,
        fnString: task.fnString,
        data: task.data,
      },
      task.transferables,
    );
  }

  /**
   * Handles messages returned from the Web Worker.
   */
  private _onWorkerMessage(worker: Worker, e: MessageEvent): void {
    const { id, success, result, error } = e.data;
    const task = this._taskMap.get(id);

    if (task) {
      this._taskMap.delete(id);
      if (success) {
        task.resolve(result);
      } else {
        task.reject(new Error(error));
      }
    }

    // Return the worker to the idle pool and process next task
    this._idleWorkers.push(worker);
    this._processQueue();
  }

  /**
   * Handles fatal worker errors.
   */
  private _onWorkerError(_worker: Worker, err: ErrorEvent): void {
    console.error("ThreadPool Worker Error:", err);
  }

  /**
   * Terminates all workers and cleans up memory.
   */
  public destroy(): void {
    for (const worker of this._workers) {
      worker.terminate();
    }
    this._workers = [];
    this._idleWorkers = [];
    this._taskQueue = [];
    this._taskMap.clear();
  }
}

/** A lazy operation. The concurrency slot covers its entire returned promise. */
export type Task<T> = (signal: AbortSignal) => T | PromiseLike<T>;

/** Explicit outcomes keep event submissions safe when their results are ignored. */
export type TaskOutcome<T> =
  { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown };

export interface TaskHandle<T> {
  /** Always resolves, including task failure and queued cancellation. */
  readonly result: Promise<TaskOutcome<T>>;
  /** Cancels queued work or signals running work. Returns false after settlement/abort. */
  cancel(reason?: unknown): boolean;
}

export interface TaskQueueOptions {
  /** Positive safe integer. @default 4 */
  readonly concurrency?: number;
  /** Maximum waiting tasks, excluding running tasks. Nonnegative safe integer. @default 8 */
  readonly maxPending?: number;
}

export interface TaskOptions {
  /** Queued abort removes the task; running abort signals it without releasing its slot. */
  readonly signal?: AbortSignal;
}

export interface TaskQueueCloseOptions {
  /** Remove all waiting tasks instead of running them. @default false */
  readonly cancelPending?: boolean;
  /** Request cooperative cancellation of running tasks. @default false */
  readonly abortRunning?: boolean;
}

export class QueueFullError extends Error {
  constructor() {
    super('Task queue is full');
    this.name = 'QueueFullError';
  }
}

export class QueueClosedError extends Error {
  constructor() {
    super('Task queue is closed');
    this.name = 'QueueClosedError';
  }
}

export class TaskCancelledError extends Error {
  constructor(public readonly reason?: unknown) {
    super('Task was cancelled');
    this.name = 'TaskCancelledError';
  }
}

interface Entry {
  readonly finished: Promise<void>;
  start(): void;
  cancel(reason?: unknown): boolean;
}

/**
 * A bounded FIFO queue for independent, lazy tasks and long-lived event sources.
 *
 * `submit` returns a cancellable, nonrejecting outcome. `add` returns the task's
 * value or rejection. Both admit synchronously and start user code in a microtask.
 * Failures affect only that task. Running cancellation keeps its slot until the
 * operation actually settles. Completed results are not retained by the queue.
 *
 * `onIdle` leaves admission open, `drain` snapshots accepted work, and `close`
 * stops admission immediately before waiting for accepted work to settle.
 *
 * @category Enqueue Input
 */
export class TaskQueue {
  public readonly concurrency: number;
  public readonly maxPending: number;

  // Map insertion order gives FIFO removal and immediate cancellation without tombstones.
  private readonly _pending = new Map<Entry, Entry>();
  private readonly _running = new Set<Entry>();
  private readonly _idleWaiters = new Set<() => void>();
  private readonly _capacityWaiters = new Set<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }>();
  private _closed = false;
  private _closing?: Promise<void>;

  constructor({ concurrency = 4, maxPending = 8 }: TaskQueueOptions = {}) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new TypeError('`concurrency` must be a positive safe integer');
    }
    if (!Number.isSafeInteger(maxPending) || maxPending < 0) {
      throw new TypeError('`maxPending` must be a nonnegative safe integer');
    }
    this.concurrency = concurrency;
    this.maxPending = maxPending;
  }

  /** Number of reserved/running slots, including operations awaiting cooperative abort. */
  public get running(): number {
    return this._running.size;
  }

  public get pending(): number {
    return this._pending.size;
  }

  public get isIdle(): boolean {
    return this.running === 0 && this.pending === 0;
  }

  public get isClosed(): boolean {
    return this._closed;
  }

  /**
   * Admit a lazy task now. Throws on invalid input, full/closed queue or pre-abort.
   * The result records failure without rejecting or retaining an error history.
   */
  public submit<T>(task: Task<T>, { signal }: TaskOptions = {}): TaskHandle<T> {
    if (typeof task !== 'function') throw new TypeError('Task function is required');
    if (this._closed) throw new QueueClosedError();
    if (signal?.aborted) throw new TaskCancelledError(signal.reason);
    if (!this.hasCapacity()) throw new QueueFullError();

    const controller = new AbortController();
    let state: 'queued' | 'running' | 'settled' = 'queued';
    let settle!: (outcome: TaskOutcome<T>) => void;
    const result = new Promise<TaskOutcome<T>>((resolve) => {
      settle = resolve;
    });
    const finish = (outcome: TaskOutcome<T>): void => {
      state = 'settled';
      signal?.removeEventListener('abort', aborted);
      this._pending.delete(entry);
      this._running.delete(entry);
      settle(outcome);
      this.pump();
    };
    const entry: Entry = {
      finished: result.then(() => undefined),
      start: () => {
        state = 'running';
        // Catch sync throws, rejecting promises and arbitrary thenables in the same path.
        void Promise.resolve()
          .then(() => {
            if (controller.signal.aborted) throw controller.signal.reason;
            return task(controller.signal);
          })
          .then(
            (value) => finish({ status: 'fulfilled', value }),
            (reason: unknown) => finish({ status: 'rejected', reason }),
          );
      },
      cancel: (reason?: unknown) => {
        if (state === 'settled' || controller.signal.aborted) return false;
        const error = new TaskCancelledError(reason);
        if (state === 'queued') {
          // Remove before abort so a reentrant signal listener cannot admit past the bound.
          this._pending.delete(entry);
          controller.abort(error);
          finish({ status: 'rejected', reason: error });
        } else {
          controller.abort(error);
        }
        return true;
      },
    };
    const aborted = (): void => {
      entry.cancel(signal?.reason);
    };
    signal?.addEventListener('abort', aborted, { once: true });
    this._pending.set(entry, entry);
    this.pump();
    return { result, cancel: entry.cancel };
  }

  /** Conventional value/rejection promise, including rejected admission. Handle rejections. */
  public async add<T>(task: Task<T>, options: TaskOptions = {}): Promise<T> {
    const outcome = await this.submit(task, options).result;
    if (outcome.status === 'rejected') throw outcome.reason;
    return outcome.value;
  }

  /** Wait for the next idle state without closing admission. Later arrivals can extend it. */
  public async onIdle(): Promise<void> {
    if (this.isIdle) return;
    await new Promise<void>((resolve) => this._idleWaiters.add(resolve));
  }

  /** Wait only for tasks accepted before this call, including failure and cancellation. */
  public async drain(): Promise<void> {
    const entries = [...this._running, ...this._pending.values()];
    // eslint-disable-next-line @typescript-eslint/promise-function-async -- Read existing completion promises without wrapping each one.
    await Promise.all(entries.map((entry) => entry.finished));
  }

  /**
   * Wait for possible admission. This is a hint, not a reservation: concurrent
   * producers must retry QueueFullError. Await one wait at a time per producer.
   * Rejects on close or caller abort; stores no task or payload while waiting.
   */
  public async onCapacity({ signal }: TaskOptions = {}): Promise<void> {
    if (this._closed) throw new QueueClosedError();
    if (signal?.aborted) throw new TaskCancelledError(signal.reason);
    if (this.hasCapacity()) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        this._capacityWaiters.delete(waiter);
        signal?.removeEventListener('abort', aborted);
      };
      const waiter = {
        resolve: () => {
          cleanup();
          resolve();
        },
        reject: (error: unknown) => {
          cleanup();
          reject(error);
        },
      };
      const aborted = (): void => waiter.reject(new TaskCancelledError(signal?.reason));
      signal?.addEventListener('abort', aborted, { once: true });
      this._capacityWaiters.add(waiter);
    });
  }

  /**
   * Stop admission synchronously, then wait for accepted tasks to settle.
   * Repeated calls share completion and may escalate cancellation. Task errors
   * remain on their handles/add promises; close itself does not aggregate them.
   */
  // eslint-disable-next-line @typescript-eslint/promise-function-async -- Repeated calls share the same completion promise.
  public close({
    cancelPending = false,
    abortRunning = false,
  }: TaskQueueCloseOptions = {}): Promise<void> {
    this._closed = true;
    this._closing ??= this.onIdle();
    for (const waiter of this._capacityWaiters) waiter.reject(new QueueClosedError());
    if (cancelPending) {
      for (const entry of [...this._pending.values()]) entry.cancel();
    }
    if (abortRunning) {
      for (const entry of this._running) entry.cancel();
    }
    return this._closing;
  }

  private hasCapacity(): boolean {
    return this.running < this.concurrency || this.pending < this.maxPending;
  }

  private pump(): void {
    while (this.running < this.concurrency && this.pending > 0) {
      const entry = this._pending.values().next().value as Entry;
      this._pending.delete(entry);
      this._running.add(entry);
      entry.start();
    }
    if (!this._closed && this.hasCapacity()) {
      for (const waiter of this._capacityWaiters) waiter.resolve();
    }
    if (this.isIdle) {
      for (const resolve of this._idleWaiters) resolve();
      this._idleWaiters.clear();
    }
  }
}

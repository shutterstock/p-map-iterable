import { Mapper } from './iterable-mapper';
import { Queue } from './queue';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Errors<T> = { item: T; error: string | { [key: string]: any } | Error }[];

type WorkItem<T> = { item: T; index: number };
type WaitingItem<T> = WorkItem<T> & { resolve: () => void };

/**
 * Options for `IterableQueueMapperSimple`, also exported as `WorkerQueueOptions`.
 */
export interface IterableQueueMapperSimpleOptions {
  /**
   * Maximum number of mapper invocations running at once.
   * Use 1 for sequential FIFO writes. Larger values allow out-of-order completion.
   * Must be a positive safe integer or Infinity, and no greater than maxQueueDepth.
   *
   * @default 4
   */
  readonly concurrency?: number;

  /**
   * Maximum number of admitted, unfinished items, including running mappers.
   * With concurrency 1 and maxQueueDepth 8, one item can run and seven can wait.
   * The next enqueue waits until a mapper settles and frees capacity.
   *
   * Must be a positive safe integer or Infinity, and at least concurrency.
   * Infinity disables admission backpressure. Await each enqueue to avoid
   * accumulating an unbounded number of blocked calls retaining their inputs.
   *
   * @default Same as concurrency
   */
  readonly maxQueueDepth?: number;
}

/**
 * Accepts queue items via `enqueue` and calls the `mapper` on them
 * with specified `concurrency`, discards the results, and accumulates
 * exceptions in the `errors` property. `await enqueue()` resolves when an item
 * is admitted, without waiting for its mapper to finish. When `maxQueueDepth`
 * items are unfinished, it waits until a mapper settles and frees capacity.
 *
 * Also exported as `WorkerQueue`, with the same constructor and instance types.
 * Each input uses the same worker callback supplied at construction. Asynchronous
 * work overlaps in the current JavaScript process, and worker results are discarded.
 *
 * @remarks
 *
 * ### Typical Use Cases
 * - Running background status checks or other queued work through a fixed callback
 * - Pushing items to an async I/O destination
 * - In the simple sequential (`concurrency: 1`) case, allows 1 item to be flushed async while caller prepares next item
 * - Results of the flushed items are not needed in a subsequent step (if they are, use `IterableQueueMapper`)
 * - For bursts of ordered writes, use `concurrency: 1` and a larger `maxQueueDepth`
 *   to buffer prepared payloads without allowing writes to overlap
 *
 * ### Error Handling
 *   The mapper should ideally handle all errors internally to enable error handling
 *   closest to where they occur. However, if errors do escape the mapper:
 *   - Processing continues despite errors
 *   - All errors are collected in the `errors` property
 *   - Errors can be checked/handled during processing via the `errors` property
 *
 *   Key Differences from `IterableQueueMapper`:
 *   - `maxQueueDepth` bounds unfinished input work and defaults to `concurrency`
 *   - Results are discarded (all work should happen in mapper)
 *   - Errors are collected rather than thrown (available via errors property)
 *
 * ### Usage
 * - Items are added to the queue via the `await enqueue()` method
 * - Check `errors` property to see if any errors occurred, stop if desired
 * - IMPORTANT: `await enqueue()` method will block until a slot is available, if queue is full
 * - IMPORTANT: Always `await onIdle()` to close input and finish all earlier enqueue calls
 * - `onIdle()` is terminal: enqueue calls made after it starts are rejected
 *
 * This class does not expose an iterator. At concurrency 1, mappers run in FIFO
 * order; at higher concurrency, they start in FIFO order but can finish out of order.
 *
 * @category Enqueue Input
 *
 * @see {@link IterableQueueMapper} for related class with more configuration options
 * @see {@link IterableMapper} for prefetching and examples of combined usage
 */
export class IterableQueueMapperSimple<Element> {
  private readonly _queue = new Queue<WorkItem<Element>>();
  private readonly _waiting = new Queue<WaitingItem<Element>>();
  private readonly _options: Required<IterableQueueMapperSimpleOptions>;
  private readonly _errors: Errors<Element> = [];
  private readonly _done: Promise<void>;
  private _resolveDone!: () => void;
  private readonly _mapper: Mapper<Element, void>;
  private _running = 0;
  private _nextIndex = 0;
  private _closed = false;
  private _isIdle = false;

  /**
   * Create a background writer with separate limits on running and unfinished work.
   *
   * @param mapper Function called for every enqueued item. Returns a `Promise` or value.
   * @param options IterableQueueMapperSimple options
   *
   * @see {@link IterableQueueMapperSimple} for full class documentation
   * @see {@link IterableQueueMapper} for related class with more configuration options
   * @see {@link IterableMapper} for prefetching and examples of combined usage
   */
  constructor(mapper: Mapper<Element, void>, options: IterableQueueMapperSimpleOptions = {}) {
    const { concurrency = 4, maxQueueDepth = concurrency } = options;

    if (typeof mapper !== 'function') {
      throw new TypeError('Mapper function is required');
    }
    for (const [name, value] of Object.entries({ concurrency, maxQueueDepth })) {
      if (!((Number.isSafeInteger(value) || value === Infinity) && value >= 1)) {
        throw new TypeError(
          `Expected \`${name}\` to be a positive safe integer or \`Infinity\`, got \`${value}\` (${typeof value})`,
        );
      }
    }
    if (maxQueueDepth < concurrency) {
      throw new TypeError(
        `Expected \`maxQueueDepth\` to be greater than or equal to \`concurrency\`, got \`${maxQueueDepth}\` < \`${concurrency}\``,
      );
    }

    this._mapper = mapper;
    this._options = { concurrency, maxQueueDepth };
    this._done = new Promise<void>((resolve) => {
      this._resolveDone = resolve;
    });
  }

  private startWorkers(): void {
    while (this._running < this._options.concurrency) {
      const work = this._queue.dequeue();
      if (work === undefined) break;
      this._running++;
      void this.worker(work);
    }
  }

  private async worker({ item, index }: WorkItem<Element>): Promise<void> {
    try {
      // Defer invocation so a backlog of synchronously throwing mappers cannot
      // recursively start workers and overflow the stack.
      await Promise.resolve();
      await this._mapper(item, index);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      this._errors.push({ item, error });
    } finally {
      this._running--;
      const waiting = this._waiting.dequeue();
      if (waiting !== undefined) {
        // Each completion admits exactly one earlier blocked enqueue call.
        this._queue.enqueue(waiting);
        waiting.resolve();
      }
      this.startWorkers();
      this.finishIfClosed();
    }
  }

  private finishIfClosed(): void {
    if (
      this._closed &&
      this._running === 0 &&
      this._queue.length === 0 &&
      this._waiting.length === 0
    ) {
      this._resolveDone();
    }
  }

  /**
   * Accumulated errors from the worker callback.
   *
   * @remarks
   *
   * Note that this property can be periodically checked
   * during processing and errors can be `.pop()`'d off of the array
   * and logged / handled as desired. Errors `.pop()`'d off of the array
   * will no longer be available in the array on the next check.
   *
   * @returns Reference to the errors array
   */
  public get errors(): Errors<Element> {
    return this._errors;
  }

  /**
   * Admit an item for background processing, waiting if maxQueueDepth items are unfinished.
   * Resolves on admission, not on completion. Blocked callers are admitted in FIFO order.
   * Await each call to keep the producer from accumulating blocked calls and their inputs.
   *
   * After the last enqueue, await `onIdle()` to close input and finish accepted work.
   * @param item Input for the worker callback
   */
  public async enqueue(item: Element): Promise<void> {
    if (this._closed) throw new Error('`enqueue` called after `done` called');
    if (item === undefined) throw new TypeError('cannot enqueue `undefined`');

    const work = { item, index: this._nextIndex++ };
    if (this._running + this._queue.length < this._options.maxQueueDepth) {
      this._queue.enqueue(work);
      this.startWorkers();
    } else {
      await new Promise<void>((resolve) => {
        this._waiting.enqueue({ ...work, resolve });
      });
    }
  }

  /**
   * Close input and wait for every earlier enqueue call to finish processing,
   * including calls still blocked on admission. Later enqueue calls reject.
   * This is terminal, rather than a reusable wait for a temporarily empty queue.
   * MUST be called before exit to ensure no lost writes. Mapper failures remain in errors.
   */
  public async onIdle(): Promise<void> {
    if (this._isIdle) return;

    this._closed = true;
    this.finishIfClosed();
    await this._done;

    this._isIdle = true;
  }

  /**
   * Indicates whether final shutdown has completed.
   *
   * @returns true after `onIdle()` has finished all accepted work and closed input
   */
  public get isIdle(): boolean {
    return this._isIdle;
  }
}

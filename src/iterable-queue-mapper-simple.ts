import { IterableMapperOptions, Mapper } from './iterable-mapper';
import { IterableQueueMapper } from './iterable-queue-mapper';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Errors<T> = { item: T; error: string | { [key: string]: any } | Error }[];

const NoResult = Symbol('noresult');

/**
 * Options for `IterableQueueMapperSimple`, also exported as `WorkerQueueOptions`.
 */
export type IterableQueueMapperSimpleOptions = Pick<IterableMapperOptions, 'concurrency'>;

/**
 * Accepts queue items via `enqueue` and calls the `mapper` on them
 * with specified `concurrency`, discards the results, and accumulates
 * exceptions in the `errors` property. Await `enqueue()` for producer
 * backpressure while the worker callback runs asynchronously.
 *
 * Also exported as `WorkerQueue`, with the same constructor and instance types.
 * Each input uses the same worker callback supplied at construction. Asynchronous
 * work overlaps in the current JavaScript process, and results are consumed internally.
 *
 * @remarks
 *
 * ### Typical Use Cases
 * - Running background status checks or other queued work through a fixed callback
 * - Sending items to an async I/O destination
 * - Processing items whose return values can be discarded (if results are needed, use `IterableQueueMapper` / `MappingQueue`)
 *
 * ### Error Handling
 *   The mapper should ideally handle all errors internally to enable error handling
 *   closest to where they occur. However, if errors do escape the mapper:
 *   - Processing continues despite errors
 *   - All errors are collected in the `errors` property
 *   - Errors can be checked/handled during processing via the `errors` property
 *
 *   Key Differences from `IterableQueueMapper`:
 *   - The internal `maxUnread` limit equals `concurrency`; only `concurrency` is configurable
 *   - Results are automatically iterated and discarded (all work should happen in mapper)
 *   - Errors are collected rather than thrown (available via errors property)
 *
 * ### Usage
 * - Items are added to the queue via the `await enqueue()` method
 * - Check `errors` property to see if any errors occurred, stop if desired
 * - IMPORTANT: `await enqueue()` method will block until a slot is available, if queue is full
 * - After the last awaited enqueue, await `onIdle()` to close input permanently and finish accepted work
 * - Subsequent enqueues reject, so `onIdle()` is a final shutdown operation
 * - Worker failures are collected in `errors`; they do not reject `onIdle()`
 * - Await each enqueue for producer backpressure; unawaited calls can accumulate pending inputs
 * - Admission limits for event callbacks, cancellation, and per-item completion handles belong to the caller
 *
 * Note: the name is somewhat of a misnomer as this wraps `IterableQueueMapper`
 * but is not itself an `Iterable`.
 *
 * @category Enqueue Input
 *
 * @see {@link IterableQueueMapper} for related class with more configuration options
 * @see {@link IterableMapper} for underlying mapper implementation and examples of combined usage
 */
export class IterableQueueMapperSimple<Element> {
  private readonly _writer: IterableQueueMapper<Element, typeof NoResult>;
  private readonly _errors: Errors<Element> = [];
  private readonly _done: Promise<void>;
  private readonly _mapper: Mapper<Element, void>;
  private _isIdle = false;

  /**
   * Create a new `IterableQueueMapperSimple`, which uses `IterableQueueMapper` underneath, but
   * automatically iterates and discards results as they complete.
   *
   * @param mapper Function called for every enqueued item. Returns a `Promise` or value.
   * @param options IterableQueueMapperSimple options
   *
   * @see {@link IterableQueueMapperSimple} for full class documentation
   * @see {@link IterableQueueMapper} for related class with more configuration options
   * @see {@link IterableMapper} for underlying mapper implementation and examples of combined usage
   */
  constructor(mapper: Mapper<Element, void>, options: IterableQueueMapperSimpleOptions = {}) {
    const { concurrency = 4 } = options;

    this._mapper = mapper;
    this.worker = this.worker.bind(this);
    this._writer = new IterableQueueMapper(this.worker, { concurrency, maxUnread: concurrency });

    // Discard all of the results
    this._done = this.discardResults();
  }

  private async discardResults(): Promise<void> {
    let item = await this._writer.next();
    while (item.done !== true) {
      // Just discard all the results
      // If the user cares about the results they should be iterating them
      item = await this._writer.next();
    }
  }

  private async worker(item: Element, index: number): Promise<typeof NoResult> {
    try {
      await this._mapper(item, index);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      this._errors.push({ item, error });
    }
    return NoResult;
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
   * Accept an input for the worker callback, waiting until it can be accepted.
   * Resolves on acceptance, rather than completion of this item's work.
   * Await each enqueue for producer backpressure.
   *
   * After the last enqueue, await `onIdle()` to close input and finish accepted work.
   * @param item Input for the worker callback
   */
  public async enqueue(item: Element): Promise<void> {
    // Return immediately or wait for the underlying mapping queue to accept the input
    await this._writer.enqueue(item);
  }

  /**
   * Permanently close input and wait for all accepted work to finish.
   * Call after the last awaited enqueue. Subsequent enqueues reject.
   * Worker failures are available in `errors` instead of rejecting this wait.
   */
  public async onIdle(): Promise<void> {
    if (this._isIdle) return;

    // Indicate that no more inputs will be enqueued
    this._writer.done();

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

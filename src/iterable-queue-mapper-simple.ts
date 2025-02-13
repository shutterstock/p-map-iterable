import { IterableMapperOptions, Mapper } from './iterable-mapper';
import { IterableQueueMapper } from './iterable-queue-mapper';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Errors<T> = { item: T; error: string | { [key: string]: any } | Error }[];

const NoResult = Symbol('noresult');

/**
 * Options for IterableQueueMapperSimple
 */
export type IterableQueueMapperSimpleOptions = Pick<IterableMapperOptions, 'concurrency'>;

/**
 * Accepts queue items via `enqueue` and calls the `mapper` on them
 * with specified `concurrency`, discards the results, and accumulates
 * exceptions in the `errors` property.  When empty, `await enqueue()`
 * will return immediately, but when `concurrency` items are in progress,
 * `await enqueue()` will block until a slot is available to accept the item.
 *
 * @remarks
 *
 * ### Typical Use Case
 * - Pushing items to an async I/O destination
 * - In the simple sequential (`concurrency: 1`) case, allows 1 item to be flushed async while caller prepares next item
 * - Results of the flushed items are not needed in a subsequent step (if they are, use `IterableQueueMapper`)
 *
 * ### Error Handling
 *   The mapper should ideally handle all errors internally to enable error handling
 *   closest to where they occur. However, if errors do escape the mapper:
 *   - Processing continues despite errors
 *   - All errors are collected in the `errors` property
 *   - Errors can be checked/handled during processing via the `errors` property
 *
 *   Key Differences from `IterableQueueMapper`:
 *   - `maxUnread` defaults to equal `concurrency` (simplifying queue management)
 *   - Results are automatically iterated and discarded (all work should happen in mapper)
 *   - Errors are collected rather than thrown (available via errors property)
 *
 * ### Usage
 * - Items are added to the queue via the `await enqueue()` method
 * - Check `errors` property to see if any errors occurred, stop if desired
 * - IMPORTANT: `await enqueue()` method will block until a slot is available, if queue is full
 * - IMPORTANT: Always `await onIdle()` to ensure all items are processed
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
   * Accumulated errors from background `mappers`s
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
   * Accept a request for sending in the background if a concurrency slot is available.
   * Else, do not return until a concurrency slot is freed up.
   * This provides concurrency background writes with backpressure to prevent
   * the caller from getting too far ahead.
   *
   * MUST await `onIdle` for background `mappers`s to finish
   * @param item
   */
  public async enqueue(item: Element): Promise<void> {
    // Return immediately or wait for a slot to free up in the background writer
    await this._writer.enqueue(item);
  }

  /**
   * Wait for all background `mapper`s to finish.
   * MUST be called before exit to ensure no lost writes.
   */
  public async onIdle(): Promise<void> {
    if (this._isIdle) return;

    // Indicate that we're done writing requests
    this._writer.done();

    await this._done;

    this._isIdle = true;
  }

  /**
   * Indicates if all background `mapper`s have finished.
   *
   * @returns true if .onIdle() has been called and finished all background writes
   */
  public get isIdle(): boolean {
    return this._isIdle;
  }
}

//
// 2021-08-25 - Initially based on: https://raw.githubusercontent.com/sindresorhus/p-map/main/index.js
//

import AggregateError from 'aggregate-error';
import { IterableQueue } from './iterable-queue';

/**
 * Options for IterableMapper
 */
export interface IterableMapperOptions {
  /**
   * Maximum number of concurrent invocations of `mapper` to run at once.
   *
   * The number of concurrent invocations is dynamically adjusted based on the `maxUnread` limit:
   * - If there are no unread items and `maxUnread` is 10 with `concurrency` of 4, all 4 mappers can run.
   * - If there are already 8 unread items in the queue, only 2 mappers will run to avoid exceeding
   *   the `maxUnread` limit of 10.
   * - If there are 10 unread items, no mappers will run until an item is consumed from the queue.
   *
   * This ensures efficient processing while maintaining backpressure through the `maxUnread` limit.
   *
   * Setting `concurrency` to 1 enables serial processing, preserving the order of items
   * while still benefiting from the backpressure mechanism.
   *
   * Must be an integer from 1 and up or `Infinity`, and must be <= `maxUnread`.
   *
   * @default 4
   */
  readonly concurrency?: number;

  /**
   * Maximum number of unread items allowed to accumulate before applying backpressure.
   *
   * This parameter is crucial for controlling memory usage and system load by:
   * 1. Limiting the number of processed but unread items in the queue
   * 2. Automatically pausing mapper execution when the limit is reached
   * 3. Resuming processing when items are consumed, maintaining optimal throughput
   *
   * For example, when reading from a slow database:
   * - With maxUnread=10, only 10 items will be fetched before the consumer reads them
   * - Additional items won't be fetched until the consumer reads existing items
   * - This prevents runaway memory usage for items that cannot be processed quickly enough
   *
   * Must be an integer from 1 and up or `Infinity`, and must be >= `concurrency`.
   * It is not typical to set this value to `Infinity`, but rather to a value such as 1 to 10.
   *
   * @default 8
   */
  readonly maxUnread?: number;

  /**
   * When set to `false`, instead of stopping when a promise rejects, it will wait for all
   * the promises to settle and then reject with an
   * [aggregated error](https://github.com/sindresorhus/aggregate-error) containing all the
   * errors from the rejected promises.
   *
   * @default true
   */
  readonly stopOnMapperError?: boolean;

  /** Cancel iteration and signal running mapper operations cooperatively. */
  readonly signal?: AbortSignal;
}

/**
 * Function which is called for every item in `input`. Expected to return a `Promise` or value.
 *
 * @template Element - Source element type
 * @template NewElement - Element type returned by the mapper
 * @param element - Iterated element
 * @param index - Index of the element in the source array
 * @param signal - Aborted when iteration closes, fails, or its external signal aborts
 */
export type Mapper<Element = unknown, NewElement = unknown> = (
  element: Element,
  index: number,
  signal: AbortSignal,
) => NewElement | Promise<NewElement>;

/**
 * Wraps a new element or caught exception
 */
type NewElementOrError<NewElement = unknown> = { element: NewElement } | { error: unknown };

/**
 * Iterates over a source iterable / generator with specified `concurrency`,
 * calling the `mapper` on each iterated item, and storing the
 * `mapper` result in a queue of `maxUnread` size, before
 * being iterated / read by the caller.
 *
 * @remarks
 *
 * ### Typical Use Case
 * - Prefetching items from an async I/O source
 * - In the simple sequential (`concurrency: 1`) case, allows items to be prefetched async, preserving order, while caller processes an item
 * - Can allow parallel prefetches for sources that allow for out of order reads (`concurrency:  2+`)
 * - Prevents the producer from racing ahead of the consumer if `maxUnread` is reached
 *
 * ### Error Handling
 *   The mapper should ideally handle all errors internally to enable error handling
 *   closest to where they occur. However, if errors do escape the mapper:
 *
 *   When `stopOnMapperError` is true (default):
 *   - First error immediately stops processing
 *   - Error is thrown from the `AsyncIterator`'s next() call
 *
 *   When `stopOnMapperError` is false:
 *   - Processing continues despite errors
 *   - All errors are collected and thrown together
 *   - Errors are thrown as `AggregateError` after all items complete
 *
 * ### Usage
 * - Items are exposed to the `mapper` via an iterator or async iterator (this includes generator and async generator functions)
 * - IMPORTANT: `mapper` method not be invoked when `maxUnread` is reached, until items are consumed
 * - The iterable will set `done` when the `input` has indicated `done` and all `mapper` promises have resolved
 *
 * @example
 *
 * ### Typical Processing Loop without `IterableMapper`
 *
 * ```typescript
 * const source = new SomeSource();
 * const sourceIds = [1, 2,... 1000];
 * const sink = new SomeSink();
 * for (const sourceId of sourceIds) {
 *   const item = await source.read(sourceId);     // takes 300 ms of I/O wait, no CPU
 *   const outputItem = doSomeOperation(item);     // takes 20 ms of CPU
 *   await sink.write(outputItem);                 // takes 500 ms of I/O wait, no CPU
 * }
 * ```
 *
 * Each iteration takes 820ms total, but we waste time waiting for I/O.
 * We could prefetch the next read (300ms) while processing (20ms) and writing (500ms),
 * without changing the order of reads or writes.
 *
 * @example
 *
 * ### Using `IterableMapper` as Prefetcher with Blocking Sequential Writes
 *
 * `concurrency: 1` on the prefetcher preserves the order of the reads and and writes are sequential and blocking (unchanged).
 *
 * ```typescript
 * const source = new SomeSource();
 * const sourceIds = [1, 2,... 1000];
 * // Pre-reads up to 8 items serially and releases in sequential order
 * const sourcePrefetcher = new IterableMapper(sourceIds,
 *   async (sourceId) => source.read(sourceId),
 *   { concurrency: 1, maxUnread: 10 }
 * );
 * const sink = new SomeSink();
 * for await (const item of sourcePrefetcher) {    // may not block for fast sources
 *   const outputItem = doSomeOperation(item);     // takes 20 ms of CPU
 *   await sink.write(outputItem);                 // takes 500 ms of I/O wait, no CPU
 * }
 * ```
 *
 * This reduces iteration time to 520ms by overlapping reads with processing/writing.
 *
 * @example
 *
 * ### Using `IterableMapper` as Prefetcher with Background Sequential Writes with `IterableQueueMapperSimple`
 *
 * `concurrency: 1` on the prefetcher preserves the order of the reads.
 * `concurrency: 1` on the flusher preserves the order of the writes, but allows the loop to iterate while last write is completing.
 *
 * ```typescript
 * const source = new SomeSource();
 * const sourceIds = [1, 2,... 1000];
 * const sourcePrefetcher = new IterableMapper(sourceIds,
 *   async (sourceId) => source.read(sourceId),
 *   { concurrency: 1, maxUnread: 10 }
 * );
 * const sink = new SomeSink();
 * const flusher = new IterableQueueMapperSimple(
 *   async (outputItem) => sink.write(outputItem),
 *   { concurrency: 1 }
 * );
 * for await (const item of sourcePrefetcher) {    // may not block for fast sources
 *   const outputItem = doSomeOperation(item);     // takes 20 ms of CPU
 *   await flusher.enqueue(outputItem);            // will periodically block for portion of write time
 * }
 * // Wait for all writes to complete
 * await flusher.onIdle();
 * // Check for errors
 * if (flusher.errors.length > 0) {
 *  // ...
 * }
 * ```
 *
 * Reads, processing, and writes overlap, but throughput remains limited by the slowest stage.
 * In this example, serial 500ms writes limit steady-state throughput to at most two items
 * per second, even when reads and CPU processing run in the background.
 *
 * @example
 *
 * ### Using `IterableMapper` as Prefetcher with Out of Order Reads and Background Out of Order Writes with `IterableQueueMapperSimple`
 *
 * For maximum throughput, allow out of order reads and writes with
 * `IterableQueueMapper` (to iterate results with backpressure when too many unread items) or
 * `IterableQueueMapperSimple` (to handle errors at end without custom iteration and applying backpressure to block further enqueues when `concurrency` items are in process):
 *
 * ```typescript
 * const source = new SomeSource();
 * const sourceIds = [1, 2,... 1000];
 * const sourcePrefetcher = new IterableMapper(sourceIds,
 *   async (sourceId) => source.read(sourceId),
 *   { concurrency: 10, maxUnread: 20 }
 * );
 * const sink = new SomeSink();
 * const flusher = new IterableQueueMapperSimple(
 *   async (outputItem) => sink.write(outputItem),
 *   { concurrency: 10 }
 * );
 * for await (const item of sourcePrefetcher) {    // typically will not block
 *   const outputItem = doSomeOperation(item);     // takes 20 ms of CPU
 *   await flusher.enqueue(outputItem);            // typically will not block
 * }
 * // Wait for all writes to complete
 * await flusher.onIdle();
 * // Check for errors
 * if (flusher.errors.length > 0) {
 *  // ...
 * }
 * ```
 *
 * With ten concurrent reads and writes, the ideal steady-state limits are 30ms per item
 * for reads, 50ms for writes, and 20ms for CPU processing. Writes remain the bottleneck;
 * concurrency does not guarantee a 20ms iteration time. Actual throughput also depends
 * on service limits, scheduling, and startup/shutdown costs.
 *
 * @category Iterable Input
 */
export class IterableMapper<Element, NewElement> implements AsyncIterable<NewElement> {
  private _mapper: Mapper<Element, NewElement>;
  private _options: Required<Omit<IterableMapperOptions, 'signal'>>;

  private _unreadQueue: IterableQueue<NewElementOrError<NewElement>>;

  private _iterator: AsyncIterator<Element> | Iterator<Element>;
  private readonly _errors = [] as Error[];
  private _asyncIterator = false;
  private _isRejected = false;
  private _terminalError: { error: unknown } | undefined;
  private _isCancelled = false;
  private _sourceClose: Promise<void> | undefined;
  private readonly _controller = new AbortController();
  private readonly _externalSignal: AbortSignal | undefined;
  private readonly _onAbort = () => this.fail(this._externalSignal?.reason);
  private _isIterableDone = false;
  private _activeRunners = 0;
  private _currentIndex = 0;
  private _initialRunnersCreated = false;

  /**
   * Create a new `IterableMapper`
   *
   * @param input Iterated over concurrently, or serially, in the `mapper` function.
   * @param mapper Function called for every item in `input`. Returns a `Promise` or value.
   * @param options IterableMapper options
   *
   * @see {@link IterableQueueMapper} for full class documentation
   */
  constructor(
    input: AsyncIterable<Element> | Iterable<Element>,
    mapper: Mapper<Element, NewElement>,
    options: IterableMapperOptions = {},
  ) {
    const { concurrency = 4, stopOnMapperError = true, maxUnread = 8 } = options;

    this._mapper = mapper;
    this._externalSignal = options.signal;
    this._options = { concurrency, stopOnMapperError, maxUnread };

    if (typeof mapper !== 'function') {
      throw new TypeError('Mapper function is required');
    }

    // Avoid undefined errors on options
    if (
      this._options.concurrency === undefined ||
      this._options.stopOnMapperError === undefined ||
      this._options.maxUnread === undefined
    ) {
      throw new TypeError('Options are malformed after init');
    }

    // Validate concurrency option
    if (!(
      (Number.isSafeInteger(this._options.concurrency) ||
        this._options.concurrency === Number.POSITIVE_INFINITY) &&
      this._options.concurrency >= 1
    )) {
      throw new TypeError(
        `Expected \`concurrency\` to be an integer from 1 and up or \`Infinity\`, got \`${concurrency}\` (${typeof concurrency})`,
      );
    }

    // Validate maxUnread option
    if (!(
      (Number.isSafeInteger(this._options.maxUnread) ||
        this._options.maxUnread === Number.POSITIVE_INFINITY) &&
      this._options.maxUnread >= 1
    )) {
      throw new TypeError(
        `Expected \`maxUnread\` to be an integer from 1 and up or \`Infinity\`, got \`${maxUnread}\` (${typeof maxUnread})`,
      );
    }

    // Validate relationship between maxUnread and concurrency
    if (this._options.maxUnread < this._options.concurrency) {
      throw new TypeError(
        `Expected \`maxUnread\` to be greater than or equal to \`concurrency\`, got \`${maxUnread}\` < \`${concurrency}\``,
      );
    }

    this._unreadQueue = new IterableQueue({ maxUnread });

    // Setup the source iterator
    if ((input as AsyncIterable<Element>)[Symbol.asyncIterator] !== undefined) {
      // We've got an async iterable
      this._iterator = (input as AsyncIterable<Element>)[Symbol.asyncIterator]();
      this._asyncIterator = true;
    } else {
      this._iterator = (input as Iterable<Element>)[Symbol.iterator]();
    }

    if (this._externalSignal?.aborted) {
      this.fail(this._externalSignal.reason);
      return;
    }
    this._externalSignal?.addEventListener('abort', this._onAbort, { once: true });

    // Create the initial concurrent runners in a detached (non-awaited)
    // promise.  We need this so we can await the next() calls
    // to stop creating runners before hitting the concurrency limit
    // if the iterable has already been marked as done.
    void (async () => {
      for (let index = 0; index < concurrency; index++) {
        // Setup the detached runner
        this._activeRunners++;

        // This only waits for the next source item to be iterated
        // It does NOT wait for the mapper to be called for for a consumer to pickup
        // the result out of the unread queue.
        await this.sourceNext();

        if (this._isIterableDone || this._isRejected) {
          break;
        }
      }

      // Signal that the next() function should now create runners if it sees too few of them
      this._initialRunnersCreated = true;
    })();
  }

  public [Symbol.asyncIterator](): AsyncIterator<NewElement> {
    return this;
  }

  /**
   * Used by the iterator returned from [Symbol.asyncIterator]
   * Called every time an item is needed
   *
   * @returns Iterator result
   */
  public async next(): Promise<IteratorResult<NewElement>> {
    if (this._isCancelled) return { value: undefined, done: true };
    this.throwIfFailed();
    // Bail out and release all waiters if there are no more items coming
    const done = this.areWeDone();
    if (done) {
      if (!this._options.stopOnMapperError && this._errors.length > 0) {
        // throw the errors as an aggregate exception
        this._isRejected = true;
        throw new AggregateError(this._errors);
      }
      return { value: undefined, done };
    }

    // Check if queue has an item
    let item: NewElementOrError<NewElement> | undefined;
    try {
      item = await this._unreadQueue.dequeue();
    } catch (error) {
      if (this._isCancelled) return { value: undefined, done: true };
      this.throwIfFailed();
      throw error;
    }
    if (item === undefined) {
      // We finished - There were no more items
      this.bubbleUpErrors();
      return { value: undefined, done: true };
    }

    this.startARunnerIfNeeded();
    this.areWeDone();

    return { value: this.throwIfError(item), done: false };
  }

  /**
   * Stop prefetching, release pending reads, and close the source iterator.
   * Called automatically when a `for await` loop exits early. Already running
   * mapper callbacks may finish, but their results are discarded.
   */
  public async return(): Promise<IteratorResult<NewElement>> {
    this._isCancelled = true;
    this._isIterableDone = true;
    const reason = new Error('Iteration closed');
    this.detachAbortListener();
    this._controller.abort(reason);
    this._unreadQueue.abort(reason);
    await this.closeSource();
    return { value: undefined, done: true };
  }

  private async closeSource(): Promise<void> {
    this._sourceClose ??= (async () => {
      await this._iterator.return?.();
    })();
    await this._sourceClose;
  }

  private fail(error: unknown): void {
    if (this._isCancelled || this._terminalError) return;
    this._terminalError = { error };
    this._isRejected = true;
    this._isIterableDone = true;
    this.detachAbortListener();
    this._controller.abort(error);
    this._unreadQueue.abort(error);
    // Preserve the primary failure if source cleanup also fails.
    void this.closeSource().catch(() => undefined);
  }

  private throwIfFailed(): void {
    if (this._terminalError) throw this._terminalError.error;
  }

  private detachAbortListener(): void {
    this._externalSignal?.removeEventListener('abort', this._onAbort);
  }

  private bubbleUpErrors() {
    if (!this._options.stopOnMapperError && this._errors.length > 0) {
      // throw the errors as an aggregate exception
      throw new AggregateError(this._errors);
    }
  }

  private startARunnerIfNeeded() {
    // If there are items left AND there are not enough runners running,
    // start one more runner - each subsequent read will check this and start more runners
    // as items are pulled from the queue
    if (this._initialRunnersCreated) {
      // The init loop has finished - we don't create runners until that loop
      // has finished else we'll end up with too many runners
      if (!this._isIterableDone && !this._isRejected) {
        // We only create more runners if the source iterable is not already done
        if (this._activeRunners < this._options.concurrency) {
          // We only create runners if we're under the concurrency limit
          if (this._unreadQueue.length + this._activeRunners < this._options.maxUnread) {
            // We only create runners if the number of runners + unread items will not
            // exceed the unread queue length

            // Start another source runner, but do not await it
            this.startAnotherRunner();
          }
        }
      }
    }
  }

  private startAnotherRunner() {
    if (this._activeRunners === this._options.concurrency) {
      throw new TypeError('active runners would be greater than concurrency limit');
    }

    if (this._activeRunners + this._unreadQueue.length >= this._options.maxUnread) {
      throw new TypeError('active runners would overflow the read queue limit');
    }

    if (this._isIterableDone) {
      throw new TypeError('runner should not be started when iterable is already done');
    }

    if (this._activeRunners < 0) {
      throw new TypeError('active runners is less than 0');
    }

    // We only create runners if the number of runners + unread items will not
    // exceed the unread queue length
    this._activeRunners++;
    // Start another source runner, but do not await it
    void this.sourceNext();
  }

  private areWeDone(): boolean {
    if (this._isIterableDone) {
      // The source iterable has no more items
      if (this._activeRunners === 0) {
        // There are no more resolvers running
        // No runner can add another result. Mark completion even when buffered
        // results remain so parallel reads beyond the last item also settle.
        this._unreadQueue.done();
        if (this._unreadQueue.length === 0) this.detachAbortListener();
        return this._unreadQueue.length === 0;
      }
    }

    return false;
  }

  /**
   * Throw an exception if the wrapped NewElement is an Error
   *
   * @returns Element if no error
   */
  private throwIfError(item: NewElementOrError<NewElement>): NewElement {
    if ('error' in item) {
      throw item.error;
    }
    return item.element;
  }

  /**
   * Get the next item from the `input` iterable.
   *
   * @remarks
   *
   * This is called up to `concurrency` times in parallel.
   *
   * If the read queue is not full, and there are source items to read,
   * each instance of this will keep calling a new instance of itself
   * that detaches and runs asynchronously (keeping the same number
   * of instances running).
   *
   * If the read queue + runners = max read queue length then the runner
   * will exit and will be restarted when an item is read from the queue.
   */
  private async sourceNext() {
    if (this._isRejected || this._isCancelled || this._isIterableDone) {
      this._activeRunners--;
      this.areWeDone();
      return;
    }

    // Note: do NOT await a non-async iterable as it will cause next() to be
    // pushed into the event loop, slowing down iteration of non-async iterables.
    const index = this._currentIndex++;
    let nextItem: IteratorResult<Element>;
    try {
      let result: IteratorResult<Element>;
      if (this._asyncIterator) {
        result = await this._iterator.next();
      } else {
        result = (this._iterator as Iterator<Element>).next();
      }
      if (typeof result !== 'object' || result === null) {
        throw new TypeError('Source iterator next() must return an object');
      }
      // Iterator result getters can also throw; report these as source failures.
      nextItem = result.done
        ? { value: undefined, done: true }
        : { value: result.value, done: false };
    } catch (error) {
      // Iterator protocol / Iterables can throw exceptions - If this happens we have to just stop
      // regardless of stopOnMapperError since we can't iterate any additional items
      this._activeRunners--;
      this.fail(error);
      return;
    }

    if (nextItem.done) {
      this._isIterableDone = true;
      this._activeRunners--;
      this.areWeDone();
      return;
    }

    // This is created as a detached, non-awaited async
    // to allow next() to return while the async mapper is awaited.
    // More next() calls will be made up to the concurrency limit.
    void (async () => {
      //
      // Push an item or error into the read queue
      // Note: once we push an item we end this try/catch as any subsequent errors
      // are errors in this class and not errors thrown by the mapper function.
      // Once we've pushed an item we can't also push an error...
      //
      try {
        const element = nextItem.value;

        if (this._isRejected || this._isCancelled) {
          this._activeRunners--;
          return;
        }

        const value = await this._mapper(element, index, this._controller.signal);

        if (this._isRejected || this._isCancelled) {
          this._activeRunners--;
          return;
        }

        // if (value === pMapSkip) {
        //   skippedIndexes.push(index);
        // } else {
        //   result[index] = value;
        // }

        // Push item onto the ready queue
        await this._unreadQueue.enqueue({ element: value });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        if (this._isRejected || this._isCancelled) {
          this._activeRunners--;
          return;
        }
        if (this._options.stopOnMapperError) {
          this._activeRunners--;
          this.fail(error);
          return;
        } else {
          // Collect the error but do not stop iterating
          // These will be thrown in an AggregateError at the end
          this._errors.push(error);

          await this.sourceNext();

          // Return so we don't release a reader since we didn't push an item
          return;
        }
      }

      //
      // Tasks below are not related to the mapper
      //

      // Bail if read queue length + active runners will hit max unread
      if (this._unreadQueue.length + this._activeRunners > this._options.maxUnread) {
        this._activeRunners--;
        return;
      }

      // Start myself again
      // Note: this will bail out if it reaches the end of the source iterable
      await this.sourceNext();
    })();
  }
}

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
   * Number of concurrently pending promises returned by `mapper`.
   *
   * Must be an integer from 1 and up or `Infinity`, must be <= `maxUnread`.
   *
   * @default 4
   */
  readonly concurrency?: number;

  /**
   * Number of pending unread iterable items.
   *
   * Must be an integer from 1 and up or `Infinity`, must be >= `concurrency`.
   *
   * @default 8
   */
  readonly maxUnread?: number;

  /**
   * When set to `false`, instead of stopping when a promise rejects, it will wait for all the promises to settle and then reject with an [aggregated error](https://github.com/sindresorhus/aggregate-error) containing all the errors from the rejected promises.
   *
   * @default true
   */
  readonly stopOnMapperError?: boolean;
}

/**
 * Function which is called for every item in `input`. Expected to return a `Promise` or value.
 *
 * @template Element - Source element type
 * @template NewElement - Element type returned by the mapper
 * @param element - Iterated element
 * @param index - Index of the element in the source array
 */
export type Mapper<Element = unknown, NewElement = unknown> = (
  element: Element,
  index: number,
) => NewElement | Promise<NewElement>;

/**
 * Wraps a new element or caught exception
 */
type NewElementOrError<NewElement = unknown> = {
  element?: NewElement;
  error?: unknown;
};

/**
 * Iterates over a source iterable with specified concurrency,
 * calling the `mapper` on each iterated item, and storing the
 * `mapper` result in a queue of specified max size, before
 * being iterated / read by the caller.
 *
 * @remarks
 *
 * Essentially - This allows performing a concurrent mapping with
 * back pressure (won't iterate all source items if the consumer is
 * not reading).
 *
 * Typical use case is for a `prefetcher` that ensures that items
 * are always ready for the consumer but that large numbers of items
 * are not processed before the consumer is ready for them.
 *
 * @category Iterable Input
 */
export class IterableMapper<Element, NewElement> implements AsyncIterable<NewElement> {
  private _mapper: Mapper<Element, NewElement>;
  private _options: Required<IterableMapperOptions>;

  private _unreadQueue: IterableQueue<NewElementOrError<NewElement>>;

  private _iterator: AsyncIterator<Element> | Iterator<Element>;
  private readonly _errors = [] as Error[];
  private _asyncIterator = false;
  private _isRejected = false;
  private _isIterableDone = false;
  private _activeRunners = 0;
  private _resolvingCount = 0;
  private _currentIndex = 0;
  private _initialRunnersCreated = false;

  /**
   * Create a new `IterableMapper`
   *
   * @param input Iterated over concurrently in the `mapper` function.
   * @param mapper Function which is called for every item in `input`. Expected to return a `Promise` or value.
   * @param options IterableMapper options
   */
  constructor(
    input: AsyncIterable<Element> | Iterable<Element>,
    mapper: Mapper<Element, NewElement>,
    options: IterableMapperOptions = {},
  ) {
    const { concurrency = 4, stopOnMapperError = true, maxUnread = 8 } = options;

    this._mapper = mapper;
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
    if (
      !(
        (Number.isSafeInteger(this._options.concurrency) ||
          this._options.concurrency === Number.POSITIVE_INFINITY) &&
        this._options.concurrency >= 1
      )
    ) {
      throw new TypeError(
        `Expected \`concurrency\` to be an integer from 1 and up or \`Infinity\`, got \`${concurrency}\` (${typeof concurrency})`,
      );
    }

    // Validate maxUnread option
    if (
      !(
        (Number.isSafeInteger(this._options.maxUnread) ||
          this._options.maxUnread === Number.POSITIVE_INFINITY) &&
        this._options.maxUnread >= 1
      )
    ) {
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
    const item = await this._unreadQueue.dequeue();
    if (item === undefined) {
      // We finished - There were no more items
      this.bubbleUpErrors();
      return { value: undefined, done: true };
    }

    this.startARunnerIfNeeded();

    return { value: this.throwIfError(item), done: false };
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
          if (this._unreadQueue.length + this._activeRunners <= this._options.maxUnread) {
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

    if (this._activeRunners + this._unreadQueue.length > this._options.maxUnread) {
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
      if (this._resolvingCount === 0) {
        // There are no more resolvers running
        if (this._unreadQueue.length === 0) {
          // There are no unread items left
          this._unreadQueue.done();

          return true;
        }
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
    if (item.error !== undefined) {
      throw item.error;
    } else if (item.element === undefined) {
      throw new TypeError('no element was returned');
    }
    return item.element;
  }

  /**
   * Get the next item from the source iterable.
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
    if (this._isRejected) {
      this._activeRunners--;
      return;
    }

    // Note: do NOT await a non-async iterable as it will cause next() to be
    // pushed into the event loop, slowing down iteration of non-async iterables.
    let nextItem: IteratorResult<Element>;
    try {
      if (this._asyncIterator) {
        nextItem = await this._iterator.next();
      } else {
        nextItem = (this._iterator as Iterator<Element>).next();
      }
    } catch (error) {
      // Iterator protocol / Iterables can throw exceptions - If this happens we have to just stop
      // regardless of stopOnMapperError since we can't iterate any additional items
      this._isRejected = true;
      this._activeRunners--;

      // Push the error onto the unread queue, to be rethrown by next()
      await this._unreadQueue.enqueue({ error });

      return;
    }

    const index = this._currentIndex;
    this._currentIndex++;

    if (nextItem.done) {
      this._isIterableDone = true;

      // If there are no active resolvers, then release all the waiters
      if (this._resolvingCount === 0) {
        // At this point the only waiters in the queue are not going to get an item
        // as there are no source items left
        this._unreadQueue.done();
      }

      this._activeRunners--;
      return;
    }

    this._resolvingCount++;

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

        if (this._isRejected) {
          this._activeRunners--;
          return;
        }

        const value = await this._mapper(element, index);
        this._resolvingCount--;

        // if (value === pMapSkip) {
        //   skippedIndexes.push(index);
        // } else {
        //   result[index] = value;
        // }

        // Push item onto the ready queue
        await this._unreadQueue.enqueue({ element: value });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        if (this._options.stopOnMapperError) {
          this._isRejected = true;
          this._activeRunners--;

          // Push the error onto the unread queue, to be rethrown by next()
          await this._unreadQueue.enqueue({ error });

          // Fall through to release a reader
        } else {
          // Collect the error but do not stop iterating
          // These will be thrown in an AggregateError at the end
          this._errors.push(error);
          this._resolvingCount--;

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

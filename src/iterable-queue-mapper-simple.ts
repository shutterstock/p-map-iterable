import { Mapper } from './iterable-mapper';
import { IterableQueueMapper } from './iterable-queue-mapper';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Errors<T> = { item: T; error: string | { [key: string]: any } | Error }[];

const NoResult = Symbol('noresult');

/**
 * Accepts queue items via `enqueue` and calls the `mapper` on them
 * with specified concurrency, storing the
 * `mapper` result in a queue of specified max size, before
 * being iterated / read by the caller.  The `enqueue` method will block if
 * the queue is full, until an item is read.
 *
 * @remarks
 *
 * Note: the name is somewhat of a misnomer as this wraps `IterableQueueMapper`
 * but is not itself an `Iterable`.
 *
 * Accepts items for mapping in the background, discards the results,
 * but accumulates exceptions in the `errors` property.
 *
 * Allows up to `concurrency` mappers to be in progress before
 * `enqueue` will block until a mapper completes.
 *
 * @category Enqueue Input
 */
export class IterableQueueMapperSimple<Element> {
  private readonly _writer: IterableQueueMapper<Element, typeof NoResult>;
  private readonly _errors: Errors<Element> = [];
  private readonly _done: Promise<void>;
  private readonly _mapper: Mapper<Element, void>;
  private _isIdle = false;

  /**
   * Create a new `IterableQueueMapperSimple`
   *
   * @param mapper Function which is called for every item in `input`.
   *    Expected to return a `Promise` or value.
   *
   *    The `mapper` *should* handle all errors and not allow an error to be thrown
   *    out of the `mapper` function as this enables the best handling of errors
   *    closest to the time that they occur.
   *
   *    If the `mapper` function does allow an error to be thrown then the
   *    errors will be accumulated in the `errors` property.
   * @param options IterableQueueMapperSimple options
   */
  constructor(
    mapper: Mapper<Element, void>,
    options: {
      /**
       * Number of items to accept for mapping before requiring the caller to wait for one to complete.
       * @default 4
       */
      concurrency?: number;
    } = {},
  ) {
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
   * This provides concurrency background writes with back pressure to prevent
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

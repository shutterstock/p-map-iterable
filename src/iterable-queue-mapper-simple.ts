import { Mapper } from './iterable-mapper';
import { IterableQueueMapper } from './iterable-queue-mapper';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Errors = (string | { [key: string]: any } | Error)[];

const NoResult = Symbol('noresult');

/**
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
  private readonly _errors: Errors = [];
  private readonly _done: Promise<void>;
  private readonly _mapper: Mapper<Element, void>;
  private _isIdle = false;

  /**
   * Create a new `IterableQueueMapperSimple`
   *
   * @param mapper Function which is called for every item in `input`. Expected to return a `Promise` or value.
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
      this._errors.push(error);
    }
    return NoResult;
  }

  /**
   * Accumulated errors from background `mappers`s
   */
  public get errors(): Errors {
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

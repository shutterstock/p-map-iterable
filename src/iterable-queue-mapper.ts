//
// 2021-08-25 - Initially based on: https://raw.githubusercontent.com/sindresorhus/p-map/main/index.js
//
import { IterableMapper, Mapper } from './iterable-mapper';
import { IterableQueue } from './iterable-queue';

export interface IterableQueueMapperOptions {
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
 * Accepts queue items via `enqueue` and calls the `mapper` on them
 * with specified concurrency, storing the
 * `mapper` result in a queue of specified max size, before
 * being iterated / read by the caller.  The `enqueue` method will block if
 * the queue is full, until an item is read.
 *
 * @remarks
 *
 * This allows performing a concurrent mapping with
 * back pressure for items added after queue creation
 * via a method call.
 *
 * Because items are added via a method call it is possible to
 * chain an `IterableMapper` that prefetches files and processes them,
 * with an `IterableQueueMapper` that processes the results of the
 * `mapper` function of the `IterableMapper`.
 *
 * Typical use case is for a `background uploader` that prevents
 * the producer from racing ahead of the upload process, consuming
 * too much memory or disk space. As items are ready for upload
 * they are added to the queue with the `enqueue` method, which is
 * `await`ed by the caller.  If the queue has room then `enqueue`
 * will return immediately, otherwise it will block until there is room.
 *
 * @category Enqueue Input
 */
export class IterableQueueMapper<Element, NewElement> implements AsyncIterable<NewElement> {
  private _iterableMapper: IterableMapper<Element, NewElement>;

  private _sourceIterable: IterableQueue<Element>;

  /**
   * Create a new `IterableQueueMapper`
   *
   * @param mapper Function which is called for every item in `input`.
   *    Expected to return a `Promise` or value.
   *
   *    The `mapper` *should* handle all errors and not allow an error to be thrown
   *    out of the `mapper` function as this enables the best handling of errors
   *    closest to the time that they occur.
   *
   *    If the `mapper` function does allow an error to be thrown then the
   *   `stopOnMapperError` option controls the behavior:
   *      - `stopOnMapperError`: `true` - will throw the error
   *        out of `next` or the `AsyncIterator` returned from `[Symbol.asyncIterator]`
   *        and stop processing.
   *     - `stopOnMapperError`: `false` - will continue processing
   *        and accumulate the errors to be thrown from `next` or the `AsyncIterator`
   *        returned from `[Symbol.asyncIterator]` when all items have been processed.
   * @param options IterableQueueMapper options
   */
  constructor(mapper: Mapper<Element, NewElement>, options: IterableQueueMapperOptions = {}) {
    this._sourceIterable = new IterableQueue({
      maxUnread: 0,
    });
    this._iterableMapper = new IterableMapper(this._sourceIterable, mapper, options);
  }

  public [Symbol.asyncIterator](): AsyncIterator<NewElement> {
    return this;
  }

  /**
   * Used by the iterator returned from [Symbol.asyncIterator]
   * Called every time an item is needed
   * @returns Iterator result
   */
  public async next(): Promise<IteratorResult<NewElement>> {
    return this._iterableMapper.next();
  }

  /**
   * Add an item to the queue, wait if the queue is full.
   *
   * @param item Element to add
   */
  public async enqueue(item: Element): Promise<void> {
    await this._sourceIterable.enqueue(item);
  }

  /**
   * Indicate that no more items will be enqueued.
   *
   * This releases all readers blocked on `enqueue`
   */
  public done(): void {
    this._sourceIterable.done();
  }
}

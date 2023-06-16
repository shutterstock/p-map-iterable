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
 * @category Enqueue Input
 */
export class IterableQueueMapper<Element, NewElement> implements AsyncIterable<NewElement> {
  private _iterableMapper: IterableMapper<Element, NewElement>;

  private _sourceIterable: IterableQueue<Element>;

  /**
   * Create a new `IterableQueueMapper`
   *
   * @param mapper Function which is called for every item in `input`. Expected to return a `Promise` or value.
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

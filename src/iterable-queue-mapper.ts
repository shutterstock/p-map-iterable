//
// 2021-08-25 - Initially based on: https://raw.githubusercontent.com/sindresorhus/p-map/main/index.js
//
import { IterableMapper, IterableMapperOptions, Mapper } from './iterable-mapper';
import { IterableQueue } from './iterable-queue';

/**
 * Options for IterableQueueMapper
 */
export type IterableQueueMapperOptions = IterableMapperOptions;

/**
 * Accepts queue items via `enqueue` and calls the `mapper` on them
 * with specified `concurrency`, storing the `mapper` result in a queue
 * of `maxUnread` size, before being iterated / read by the caller.
 * The `enqueue` method will block if the queue is full, until an item is read.
 *
 * @remarks
 *
 * ### Typical Use Case
 * - Pushing items to an async I/O destination
 * - In the simple sequential (`concurrency: 1`) case, allows 1 item to be flushed async while caller prepares next item
 * - Results of the flushed items are needed in a subsequent step (if they are not, use `IterableQueueMapperSimple`)
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
 * - Items are added to the queue via the `await enqueue()` method
 * - IMPORTANT: `await enqueue()` method will block until a slot is available, if queue is full
 * - Call `done()` when no more items will be enqueued
 * - IMPORTANT: Always `await onIdle()` to ensure all items are processed
 *
 * @category Enqueue Input
 *
 * @see {@link IterableMapper} for underlying mapper implementation and examples of combined usage
 */
export class IterableQueueMapper<Element, NewElement> implements AsyncIterable<NewElement> {
  private _iterableMapper: IterableMapper<Element, NewElement>;

  private _sourceIterable: IterableQueue<Element>;

  /**
   * Create a new `IterableQueueMapper`, which uses `IterableMapper` underneath, and exposes a
   * queue interface for adding items that are not exposed via an iterator.
   *
   * @param mapper Function called for every enqueued item. Returns a `Promise` or value.
   * @param options IterableQueueMapper options
   *
   * @see {@link IterableQueueMapper} for full class documentation
   * @see {@link IterableMapper} for underlying mapper implementation and examples of combined usage
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

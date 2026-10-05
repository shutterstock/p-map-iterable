//
// 2021-08-25 - Initially based on: https://raw.githubusercontent.com/sindresorhus/p-map/main/index.js
//
import { IterableMapper, IterableMapperOptions, Mapper } from './iterable-mapper';
import { IterableQueue } from './iterable-queue';

/**
 * Options for `IterableQueueMapper`, also exported as `MappingQueueOptions`.
 */
export type IterableQueueMapperOptions = IterableMapperOptions;

/**
 * Accepts queue items via `enqueue` and calls the `mapper` on them
 * with specified `concurrency`, storing the `mapper` result in a queue
 * of `maxUnread` size, before being iterated / read by the caller.
 * The `enqueue` method will block if the queue is full, until an item is read.
 *
 * Also exported as `MappingQueue`, with the same constructor and instance types.
 * Each input uses the same callback supplied at construction; results are exposed
 * through the async iterator as mapping completes.
 *
 * @remarks
 *
 * ### Typical Use Cases
 * - Enqueuing capability probes or metadata lookups as inputs become available
 * - Sending items to an async I/O destination and consuming its acknowledgements
 * - Consuming mapped results in a subsequent step (if results can be discarded, use `IterableQueueMapperSimple` / `WorkerQueue`)
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
 * - Produce inputs and consume results concurrently so the result buffer can drain
 * - Call `done()` after the last awaited enqueue, then finish consuming the iterator
 * - `enqueue()` confirms acceptance of an input; `done()` closes input without waiting for work to finish
 * - Await each enqueue for producer backpressure; unawaited calls can accumulate pending inputs
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
   * Add an item to the queue, waiting until it can be accepted.
   * Resolves on acceptance, rather than completion of the mapper for this item.
   * Await each enqueue while consuming results concurrently for producer backpressure.
   *
   * @param item Element to add
   */
  public async enqueue(item: Element): Promise<void> {
    await this._sourceIterable.enqueue(item);
  }

  /**
   * Indicate that no more items will be enqueued.
   *
   * Call after the last awaited enqueue. Finish consuming the async iterator
   * to wait for mapped results; this method does not wait for processing to finish.
   */
  public done(): void {
    this._sourceIterable.done();
  }
}

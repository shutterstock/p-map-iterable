import { BlockingQueue, BlockingQueueOptions } from './blocking-queue';

export type IterableQueueOptions = BlockingQueueOptions;

/**
 * Exposes an `AsyncIterable` interface for the `BlockingQueue`.
 *
 * @category Low-Level
 */
export class IterableQueue<Element>
  extends BlockingQueue<Element>
  implements AsyncIterable<Element>
{
  /**
   * Create a new `IterableQueue`
   * @param options IterableQueue options
   */
  constructor(options: IterableQueueOptions = {}) {
    super(options);
  }

  public [Symbol.asyncIterator](): AsyncIterator<Element> {
    return this;
  }

  /**
   * Used by the iterator returned from [Symbol.asyncIterator]
   * Called every time an item is needed
   *
   * @returns Iterator result
   */
  public async next(): Promise<IteratorResult<Element>> {
    // Check if queue has an item
    const item: Element | undefined = await this.dequeue();

    if (item === undefined) {
      // We finished - There were no more items
      return { value: undefined, done: true };
    }

    return { value: item, done: false };
  }
}

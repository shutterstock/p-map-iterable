import { Queue } from './queue';

interface BlockingQueueOptions {
  /**
   * Number of pending unread items.
   *
   * Must be an integer from 0 and up or `Infinity`, must be >= `concurrency`.
   *
   * @default 8
   */
  readonly maxUnread?: number;
}

/**
 * Resolve function used to release next() waiters
 */
type WaiterResolverFunc = (value: unknown) => void;

export class BlockingQueue<Element> {
  private _options: Required<BlockingQueueOptions>;

  // NOTE: unreadQueue has to be a proper FIFO queue with O(1) removal from the front
  // as we may have O(m) unread items, where m may approach n, and Array.shift()
  // would be O(m) (approaching O(n)) in that case as the array gets large.
  private readonly _unreadQueue: Queue<Element> = new Queue();

  // NOTE: Yes, it is possible to call next() multiple times in parallel (and we
  // have a test that demonstrates that), so we may have multiple readers waiting
  // and thus need a queue not just a single item.
  // The items in the queue are 'resolve' functions that we call when an item
  // is ready.
  private readonly _readersWaiting: Queue<WaiterResolverFunc> = new Queue();

  // NOTE: Yes, it is possible to call add() multiple times in parallel (and we
  // have a test that demonstrates that), so we may have multiple writers waiting
  // and thus need a queue not just a single item.
  // The items in the queue are 'resolve' functions that we call when an item
  // is ready.
  private readonly _writersWaiting: Queue<WaiterResolverFunc> = new Queue();

  private _doneAdding = false;

  /**
   *
   */
  constructor({ maxUnread = 8 }: BlockingQueueOptions = {}) {
    this._options = { maxUnread };

    // Avoid undefined errors on options
    if (this._options.maxUnread === undefined) {
      throw new TypeError('`maxUnread` must be set');
    }

    // Validate maxUnread option
    if (
      !(
        (Number.isSafeInteger(this._options.maxUnread) ||
          this._options.maxUnread === Number.POSITIVE_INFINITY) &&
        this._options.maxUnread >= 0
      )
    ) {
      throw new TypeError(
        `Expected \`maxUnread\` to be an integer from 0 and up or \`Infinity\`, got \`${maxUnread}\` (${typeof maxUnread})`,
      );
    }
  }

  public get length(): number {
    return this._unreadQueue.length;
  }

  /**
   * Indicate that no more items will be enqueued.
   *
   * This releases all readers blocked on `enqueue`
   */
  public done(): void {
    // Just mark that we're done adding
    this._doneAdding = true;

    // If there are writers waiting then then they will release the waiting readers
    // The reader that sees the writer count hit zero will clean up
    if (this._writersWaiting.length !== 0) {
      return;
    }

    // If there are no writers waiting then we release all the readers
    this.releaseAllReaders();
  }

  /**
   * Add an item to the queue, wait if the queue is full.
   *
   * @param item Element to add
   */
  public async enqueue(item: Element): Promise<void> {
    if (this._doneAdding) {
      throw new Error('`enqueue` called after `done` called');
    }

    // We always add to the internal queue, we just wait to return if the queue is full
    this._unreadQueue.enqueue(item);

    if (this._readersWaiting.length > 0) {
      // Release a reader if one is waiting for an item
      // Remove the first waiting reader Promise from the queue
      const reader = this._readersWaiting.dequeue();
      if (reader === undefined) {
        throw new TypeError('reader queue returned undefined');
      }

      // Resolve the Promise for a waiting reader
      reader(undefined);
    }

    if (this._unreadQueue.length > this._options.maxUnread) {
      // We wait if the queue is at max length
      await this.waitForRead();
    }
  }

  /**
   * Gets an element when one is ready, waits if none are ready.
   *
   * @returns Element or undefined if queue is empty and `done` has been called
   */
  public async dequeue(): Promise<Element | undefined> {
    // Bail out and release all waiters if there are no more items coming
    const done = this.areWeDone();
    if (done) {
      return undefined;
    }

    // Check if queue has an item
    let item: Element | undefined;

    // Get the item if one is ready
    if (this._unreadQueue.length !== 0 && this._readersWaiting.length === 0) {
      // If there are items and no waiters, pop one and return it
      item = this._unreadQueue.dequeue();
    } else {
      // If there are no items and/or there are already waiters, we have to wait for one to be ready
      await this.waitForWrite();

      item = this._unreadQueue.dequeue();
    }

    if (this._writersWaiting.length > 0) {
      // Release a writer if one is waiting
      // Remove the first waiting reader Promise from the queue
      const writer = this._writersWaiting.dequeue();
      if (writer === undefined) {
        throw new TypeError('writer queue returned undefined');
      }

      // Resolve the Promise for a waiting writer
      writer(undefined);
    }

    return item;
  }

  private releaseAllReaders() {
    // Release all the waiting readers since we're done
    let waiter: WaiterResolverFunc | undefined;
    while ((waiter = this._readersWaiting.dequeue()) !== undefined) {
      waiter(undefined);
    }
  }

  private areWeDone(): boolean {
    if (this._doneAdding) {
      // No more calls to `enqueue` will be made
      if (this._writersWaiting.length === 0) {
        // No `enqueue` calls are waiting to add an item
        if (this._unreadQueue.length === 0) {
          // There are no unread items left
          this.releaseAllReaders();

          return true;
        }
      }
    }

    return false;
  }

  /**
   * Waits for an item to be ready in the queue
   * @returns Item from the ready queue
   */
  private async readWhenReady(): Promise<Element | undefined> {
    // If there are waiters, create a waiter promise and add to end of list
    // Note: the background reader removes the promise from the readers waiting queue
    const itemReady = new Promise((resolve) => {
      this._readersWaiting.enqueue(resolve);
    });

    // Wait for our item to be ready
    await itemReady;

    const item = this._unreadQueue.dequeue();

    // Pull the item from the front
    return item;
  }

  /**
   * Waits for an item to be ready in the queue
   */
  private async waitForWrite(): Promise<void> {
    // If there are waiters, create a waiter promise and add to end of list
    // Note: the background reader removes the promise from the readers waiting queue
    const itemReady = new Promise((resolve) => {
      this._readersWaiting.enqueue(resolve);
    });

    // Wait for our item to be ready
    await itemReady;
  }

  /**
   * Waits to be able to add an item to the queue when full
   */
  private async waitForRead(): Promise<void> {
    // If there are waiters, create a waiter promise and add to end of list
    // Note: the background reader removes the promise from the readers waiting queue
    const writeReady = new Promise((resolve) => {
      this._writersWaiting.enqueue(resolve);
    });

    // Wait for our turn to add to the queue
    await writeReady;
  }
}

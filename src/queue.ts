//
// 2021-08-27 - Based on simple example here: https://www.telerik.com/blogs/stack-queue-javascript
//

/**
 * A simple queue implementation.
 *
 * @category Low-Level
 */
export class Queue<T> {
  private _queue: { [index: number]: T } = {};
  private _tail = 0;
  private _head = 0;

  public get length(): number {
    return this._tail - this._head;
  }

  // Add an element to the end of the queue.
  public enqueue(element: T): void {
    if (element === undefined) {
      throw new TypeError('cannot enqueue `undefined`');
    }
    this._queue[this._tail++] = element;
  }

  // Delete the first element of the queue.
  public dequeue(): T | undefined {
    if (this._tail === this._head) return undefined;

    const element = this._queue[this._head];
    delete this._queue[this._head++];
    return element;
  }
}

/// <reference types="jest" />
import { BlockingQueue } from './index';

async function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('BlockingQueue', () => {
  beforeAll(() => {
    // nothing
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it.each([Number.NaN, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
      'rejects an invalid maxUnread of %p',
      (maxUnread) => {
        expect(() => new BlockingQueue({ maxUnread })).toThrow(
          /Expected `maxUnread` to be an integer/,
        );
      },
    );

    test('should throw TypeError if maxUnread is not a valid integer or Infinity', () => {
      expect(() => {
        new BlockingQueue({ maxUnread: -1 });
      }).toThrow(TypeError);

      expect(() => {
        new BlockingQueue({ maxUnread: 1.5 });
      }).toThrow(TypeError);
    });
  });

  describe('producer backpressure and shutdown', () => {
    it.each([0, 1])(
      'wakes exactly one waiting reader per enqueue with maxUnread=%p',
      async (maxUnread) => {
        const queue = new BlockingQueue<number>({ maxUnread });
        const received: [number, number | undefined][] = [];
        const read = async (index: number) => {
          const value = await queue.dequeue();
          received.push([index, value]);
          return value;
        };
        const reads = [read(0), read(1), read(2)];
        await nextTurn();
        expect(received).toEqual([]);

        for (const value of [1, 2, 3]) {
          const write = queue.enqueue(value);
          await nextTurn();
          expect(received).toEqual(Array.from({ length: value }, (_, index) => [index, index + 1]));
          expect(queue.length).toBe(0);
          await write;
        }
        await expect(Promise.all(reads)).resolves.toEqual([1, 2, 3]);

        // Enqueue without a waiting reader, then register new readers after draining.
        const ahead = queue.enqueue(4);
        await expect(queue.dequeue()).resolves.toBe(4);
        await ahead;
        const laterReads = [read(3), read(4)];
        const write = queue.enqueue(5);
        await nextTurn();
        expect(received).toEqual([
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 5],
        ]);
        await write;

        // The last reader must still be blocked until shutdown releases it.
        queue.done();
        await expect(Promise.all(laterReads)).resolves.toEqual([5, undefined]);
        expect(received).toEqual([
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 5],
          [4, undefined],
        ]);
        await expect(queue.dequeue()).resolves.toBeUndefined();
      },
    );

    it.each([0, 1, 3])(
      'releases exactly one blocked producer per dequeue with maxUnread=%p',
      async (maxUnread) => {
        const queue = new BlockingQueue<number>({ maxUnread });
        for (let value = 1; value <= maxUnread; value++) await queue.enqueue(value);
        const accepted: number[] = [];
        const blockedValues = [maxUnread + 1, maxUnread + 2, maxUnread + 3];
        const writes = blockedValues.map(async (value) => {
          await queue.enqueue(value);
          accepted.push(value);
        });
        await nextTurn();
        expect(accepted).toEqual([]);

        for (let index = 0; index < writes.length; index++) {
          await expect(queue.dequeue()).resolves.toBe(index + 1);
          await nextTurn();
          expect(accepted).toEqual(blockedValues.slice(0, index + 1));
          await writes[index];
        }
        await Promise.all(writes);

        // Drain without waiting producers, then fill the buffer and block a new one.
        for (let value = 4; value <= maxUnread + 3; value++) {
          await expect(queue.dequeue()).resolves.toBe(value);
        }
        const refill = Array.from({ length: maxUnread }, (_, index) => 100 + index);
        for (const value of refill) await queue.enqueue(value);
        const laterValue = 100 + maxUnread;
        const laterWrite = (async () => {
          await queue.enqueue(laterValue);
          accepted.push(laterValue);
        })();
        await nextTurn();
        expect(accepted).toEqual(blockedValues);

        await expect(queue.dequeue()).resolves.toBe(maxUnread === 0 ? laterValue : refill[0]);
        await nextTurn();
        expect(accepted).toEqual([...blockedValues, laterValue]);
        await laterWrite;
        queue.done();
        if (maxUnread > 0) {
          for (const value of [...refill.slice(1), laterValue]) {
            await expect(queue.dequeue()).resolves.toBe(value);
          }
        }
        expect(queue.length).toBe(0);
        await expect(queue.dequeue()).resolves.toBeUndefined();
      },
    );

    it.each([0, 1, 4])(
      'serves waiting readers and producers in FIFO order with maxUnread=%p',
      async (maxUnread) => {
        const queue = new BlockingQueue<number>({ maxUnread });
        const reads = [queue.dequeue(), queue.dequeue(), queue.dequeue()];
        const accepted: number[] = [];
        const writes = [1, 2, 3].map(async (value) => {
          await queue.enqueue(value);
          accepted.push(value);
        });
        queue.done();

        await expect(Promise.all(reads)).resolves.toEqual([1, 2, 3]);
        await Promise.all(writes);
        expect(accepted).toEqual([1, 2, 3]);
        expect(queue.length).toBe(0);
        await expect(queue.dequeue()).resolves.toBeUndefined();
      },
    );

    it.each([undefined, { maxUnread: undefined }])(
      'uses the default buffer when options are %p',
      async (options) => {
        const queue = new BlockingQueue<number>(options);
        for (let value = 1; value <= 8; value++) await queue.enqueue(value);

        const accepted = jest.fn();
        const ninth = queue.enqueue(9).then(accepted);
        await Promise.resolve();
        expect(accepted).not.toHaveBeenCalled();

        expect(await queue.dequeue()).toBe(1);
        await ninth;
        expect(accepted).toHaveBeenCalledTimes(1);
        queue.done();

        const remaining = [];
        for (let value = 2; value <= 9; value++) remaining.push(await queue.dequeue());
        expect(remaining).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
        await expect(queue.dequeue()).resolves.toBeUndefined();
      },
    );

    it('allows an unlimited buffer and drains it in FIFO order after done', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: Number.POSITIVE_INFINITY });
      const values = Array.from({ length: 20 }, (_, index) => index);
      await Promise.all(values.map(async (value) => queue.enqueue(value)));
      expect(queue.length).toBe(values.length);
      queue.done();

      const results = await Promise.all(values.map(async () => queue.dequeue()));
      expect(results).toEqual(values);
      expect(queue.length).toBe(0);
      await expect(queue.dequeue()).resolves.toBeUndefined();
      await expect(queue.enqueue(20)).rejects.toThrow('`enqueue` called after `done` called');
    });

    it('closes a zero-buffer queue without losing already blocked enqueues', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 0 });
      const accepted: number[] = [];
      const writes = [1, 2, 3].map(async (value) => {
        await queue.enqueue(value);
        accepted.push(value);
      });
      await Promise.resolve();
      expect(accepted).toEqual([]);
      queue.done();
      await expect(queue.enqueue(4)).rejects.toThrow('`enqueue` called after `done` called');

      for (const value of [1, 2, 3]) {
        expect(await queue.dequeue()).toBe(value);
        await writes[value - 1];
        expect(accepted).toEqual(Array.from({ length: value }, (_, index) => index + 1));
      }
      await Promise.all(writes);
      await expect(queue.dequeue()).resolves.toBeUndefined();
    });

    it('releases every reader waiting on an empty queue when closed repeatedly', async () => {
      const queue = new BlockingQueue<number>();
      const reads = [queue.dequeue(), queue.dequeue(), queue.dequeue()];
      queue.done();
      queue.done();

      await expect(Promise.all(reads)).resolves.toEqual([undefined, undefined, undefined]);
      await expect(queue.dequeue()).resolves.toBeUndefined();
      await expect(queue.enqueue(1)).rejects.toThrow('`enqueue` called after `done` called');
    });
  });

  describe('maxUnread: 0', () => {
    it('single item enqueue/dequeue works', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 0 });
      setTimeout(() => {
        void queue.enqueue(1);
      }, 1000);
      const item = await queue.dequeue();
      queue.done();
      expect(item).toBe(1);
    });

    it('multiple enqueues finish after done', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 0 });
      setTimeout(() => {
        // Not waiting for these to complete
        void queue.enqueue(1);
        void queue.enqueue(2);
        // Not adding more items
        queue.done();
      }, 1);
      expect(queue.length).toBeGreaterThanOrEqual(0);
      expect(queue.length).toBeLessThanOrEqual(1);
      const item = await queue.dequeue();
      expect(queue.length).toBeLessThanOrEqual(1);
      const item2 = await queue.dequeue();
      expect(queue.length).toBeLessThanOrEqual(0);
      expect(item).toBe(1);
      expect(item2).toBe(2);
    });

    it('dequeue after done does not hang', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 0 });
      setTimeout(() => {
        void queue.enqueue(1);
      }, 1000);
      const item = await queue.dequeue();
      queue.done();
      await queue.dequeue();
      expect(item).toBe(1);
    });

    it('enqueue after done throws', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 0 });
      setTimeout(() => {
        void queue.enqueue(1);
      }, 1000);
      const item = await queue.dequeue();
      queue.done();
      await expect(async () => queue.enqueue(2)).rejects.toThrow(
        '`enqueue` called after `done` called',
      );
      expect(item).toBe(1);
    });

    it('balanced enqueue/dequeue works', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 0 });
      const writers: Promise<void>[] = [];
      writers.push(queue.enqueue(1));
      writers.push(queue.enqueue(2));
      const readers: Promise<number | undefined>[] = [];
      readers.push(queue.dequeue());
      readers.push(queue.dequeue());

      await Promise.all(writers);

      queue.done();

      await Promise.all(readers);

      expect(await readers[0]).toBe(1);
      expect(await readers[1]).toBe(2);
    });

    it('full queue blocks enqueue until dequeue', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 1 });
      await queue.enqueue(1);
      let admitted = false;
      const write = queue.enqueue(2).then(() => {
        admitted = true;
      });
      await Promise.resolve();
      expect(admitted).toBe(false);
      expect(await queue.dequeue()).toBe(1);
      await write;
      expect(admitted).toBe(true);
      expect(await queue.dequeue()).toBe(2);
      queue.done();
    });
  });

  describe('maxUnread: 1', () => {
    it('single item enqueue/dequeue works', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 1 });
      await queue.enqueue(1);
      const item = await queue.dequeue();
      queue.done();
      expect(item).toBe(1);
    });

    it('dequeue after done does not hang', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 1 });
      await queue.enqueue(1);
      const item = await queue.dequeue();
      queue.done();
      await queue.dequeue();
      expect(item).toBe(1);
    });

    it('dequeue after done and empty does not hang', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 1 });
      await queue.enqueue(1);
      const item = await queue.dequeue();
      queue.done();
      await queue.dequeue();
      expect(item).toBe(1);

      await queue.dequeue();
    });

    it('enqueue after done throws', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 1 });
      await queue.enqueue(1);
      const item = await queue.dequeue();
      queue.done();
      await expect(async () => queue.enqueue(2)).rejects.toThrow(
        '`enqueue` called after `done` called',
      );
      expect(item).toBe(1);
    });

    it('balanced enqueue/dequeue works', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 1 });
      const writers: Promise<void>[] = [];
      writers.push(queue.enqueue(1));
      writers.push(queue.enqueue(2));
      const readers: Promise<number | undefined>[] = [];
      readers.push(queue.dequeue());
      readers.push(queue.dequeue());

      await Promise.all(writers);

      queue.done();

      await Promise.all(readers);

      expect(await readers[0]).toBe(1);
      expect(await readers[1]).toBe(2);
    });

    it('more dequeue than enqueue works', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 1 });
      const writers: Promise<void>[] = [];
      writers.push(queue.enqueue(1));
      writers.push(queue.enqueue(2));
      const readers: Promise<number | undefined>[] = [];
      readers.push(queue.dequeue());
      readers.push(queue.dequeue());
      readers.push(queue.dequeue());
      readers.push(queue.dequeue());

      await Promise.all(writers);

      queue.done();

      await Promise.all(readers);

      expect(await readers[0]).toBe(1);
      expect(await readers[1]).toBe(2);
      expect(await readers[2]).toBeUndefined();
      expect(await readers[3]).toBeUndefined();
    });

    it('full queue blocks enqueue until dequeue', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 1 });
      await queue.enqueue(1);
      let admitted = false;
      const write = queue.enqueue(2).then(() => {
        admitted = true;
      });
      await Promise.resolve();
      expect(admitted).toBe(false);
      expect(await queue.dequeue()).toBe(1);
      await write;
      expect(admitted).toBe(true);
      expect(await queue.dequeue()).toBe(2);
      queue.done();
    });
  });

  describe('maxUnread: 2', () => {
    it('no reads until done works', async () => {
      const queue = new BlockingQueue<number>({ maxUnread: 2 });
      const writers: Promise<void>[] = [];
      writers.push(queue.enqueue(1));
      writers.push(queue.enqueue(2));

      await Promise.all(writers);
      queue.done();

      const readers: Promise<number | undefined>[] = [];
      readers.push(queue.dequeue());
      readers.push(queue.dequeue());
      readers.push(queue.dequeue());
      readers.push(queue.dequeue());

      await Promise.all(readers);

      expect(await readers[0]).toBe(1);
      expect(await readers[1]).toBe(2);
      expect(await readers[2]).toBeUndefined();
      expect(await readers[3]).toBeUndefined();
    });
  });
});

/// <reference types="jest" />
import { BlockingQueue } from './blocking-queue';

describe('BlockingQueue', () => {
  beforeAll(() => {
    // nothing
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('should throw TypeError if maxUnread is not a valid integer or Infinity', () => {
      expect(() => {
        new BlockingQueue({ maxUnread: -1 });
      }).toThrow(TypeError);

      expect(() => {
        new BlockingQueue({ maxUnread: 1.5 });
      }).toThrow(TypeError);
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
      await expect(async () => queue.enqueue(2)).rejects.toThrowError(
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

      // Add first item
      void queue.enqueue(1);
      // Do not wait for second item to add (it will wait until an enqueue completes)
      setTimeout(() => {
        void queue.enqueue(2);
      }, 2000);

      const startTime = Date.now();
      expect(await queue.dequeue()).toBe(1);
      expect(Date.now() - startTime).toBeLessThan(2000);
      expect(await queue.dequeue()).toBe(2);
      expect(Math.ceil(Math.ceil(Date.now() - startTime))).toBeGreaterThanOrEqual(2000);

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
      await expect(async () => queue.enqueue(2)).rejects.toThrowError(
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

      // Wait for first item to add
      await queue.enqueue(1);
      // Do not wait for second item to add (it will wait until an enqueue completes)
      setTimeout(() => {
        void queue.enqueue(2);
      }, 2000);

      expect(await queue.dequeue()).toBe(1);
      const startTime = Date.now();
      expect(await queue.dequeue()).toBe(2);
      const duration = Math.ceil(Date.now() - startTime);
      expect(duration).toBeGreaterThanOrEqual(2000);

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

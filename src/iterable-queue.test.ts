/// <reference types="jest" />
import { IterableQueue } from './iterable-queue';

describe('IterableQueue', () => {
  beforeAll(() => {
    // nothing
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('maxUnread: 0', () => {
    it('single item enqueue / iterate works and ends', async () => {
      const queue = new IterableQueue<number>({ maxUnread: 0 });
      void queue.enqueue(1);
      queue.done();

      let iteratedCount = 0;
      for await (const item of queue) {
        expect(item).toBe(1);
        iteratedCount++;
      }

      expect(iteratedCount).toBe(1);
    });

    it('full queue blocks enqueue until dequeue', async () => {
      const queue = new IterableQueue<number>({ maxUnread: 0 });
      const items: number[] = [1, 2];

      // Add first item
      void queue.enqueue(items[0]);
      // Do not wait for second item to add (it will wait until an enqueue completes)
      setTimeout(() => {
        void queue.enqueue(items[1]);
      }, 2000);
      setTimeout(() => {
        queue.done();
      }, 3000);

      const startTime = Date.now();
      let iteratedCount = 0;
      for await (const item of queue) {
        expect(item).toBe(items[iteratedCount]);
        iteratedCount++;
      }

      expect(iteratedCount).toBe(2);

      const duration = Date.now() - startTime;
      expect(duration).toBeGreaterThanOrEqual(3000);
    });

    it('mixed dequeue / iterator works', async () => {
      const queue = new IterableQueue<number>({ maxUnread: 0 });
      const items: number[] = [1, 2];

      // Wait for first item to add
      void queue.enqueue(items[0]);
      // Do not wait for second item to add (it will wait until an enqueue completes)
      setTimeout(() => {
        void queue.enqueue(items[1]);
      }, 2010);
      setTimeout(() => {
        queue.done();
      }, 3000);

      const startTime = Date.now();
      let iteratedCount = 0;
      const firstItem = await queue.dequeue();
      expect(firstItem).toBe(items[iteratedCount]);
      iteratedCount++;
      for await (const item of queue) {
        expect(item).toBe(items[iteratedCount]);
        iteratedCount++;
        expect(Math.ceil(Date.now() - startTime)).toBeGreaterThanOrEqual(2000);
      }

      expect(iteratedCount).toBe(2);

      const duration = Date.now() - startTime;
      expect(duration).toBeGreaterThanOrEqual(3000);
    });
  });

  describe('maxUnread: 1', () => {
    it('single item enqueue / iterate works and ends', async () => {
      const queue = new IterableQueue<number>({ maxUnread: 1 });
      await queue.enqueue(1);
      queue.done();

      let iteratedCount = 0;
      for await (const item of queue) {
        expect(item).toBe(1);
        iteratedCount++;
      }

      expect(iteratedCount).toBe(1);
    });

    it('enqueue after done throws', async () => {
      const queue = new IterableQueue<number>({ maxUnread: 1 });
      await queue.enqueue(1);
      const item = await queue.dequeue();
      queue.done();
      await expect(async () => queue.enqueue(2)).rejects.toThrowError(
        '`enqueue` called after `done` called',
      );
      expect(item).toBe(1);
    });

    it('full queue blocks enqueue until dequeue', async () => {
      const queue = new IterableQueue<number>({ maxUnread: 1 });
      const items: number[] = [1, 2];

      // Wait for first item to add
      await queue.enqueue(items[0]);
      // Do not wait for second item to add (it will wait until an enqueue completes)
      setTimeout(() => {
        void queue.enqueue(items[1]);
      }, 2000);
      setTimeout(() => {
        queue.done();
      }, 3000);

      const startTime = Date.now();
      let iteratedCount = 0;
      for await (const item of queue) {
        expect(item).toBe(items[iteratedCount]);
        iteratedCount++;
      }

      expect(iteratedCount).toBe(2);

      const duration = Date.now() - startTime;
      expect(duration).toBeGreaterThanOrEqual(3000);
    });

    it('mixed dequeue / iterator works', async () => {
      const queue = new IterableQueue<number>({ maxUnread: 1 });
      const items: number[] = [1, 2];

      // Wait for first item to add
      await queue.enqueue(items[0]);
      // Do not wait for second item to add (it will wait until an enqueue completes)
      setTimeout(() => {
        void queue.enqueue(items[1]);
      }, 2000);
      setTimeout(() => {
        queue.done();
      }, 3000);

      const startTime = Date.now();
      let iteratedCount = 0;
      const firstItem = await queue.dequeue();
      expect(firstItem).toBe(items[iteratedCount]);
      iteratedCount++;
      for await (const item of queue) {
        expect(item).toBe(items[iteratedCount]);
        iteratedCount++;
        expect(Math.ceil(Date.now() - startTime)).toBeGreaterThanOrEqual(2000);
      }

      expect(iteratedCount).toBe(2);

      const duration = Date.now() - startTime;
      expect(duration).toBeGreaterThanOrEqual(3000);
    });
  });
});

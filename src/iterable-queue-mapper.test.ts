/// <reference types="jest" />
import { IterableQueueMapper } from './iterable-queue-mapper';
import { promisify } from 'util';
const sleep = promisify(setTimeout);

async function mapper({ value, ms }: { value: number; ms: number }): Promise<number> {
  await sleep(ms);
  return value;
}

describe('IterableQueueMapper', () => {
  beforeAll(() => {
    // nothing
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('simple tests', () => {
    it('simple mapper works - sync mapper', async () => {
      const max = 100;
      let total = 0;
      let callCount = 0;
      const prefetcher = new IterableQueueMapper((value: number): number => {
        callCount++;
        total += value;
        return total;
      });

      // Enqueue items in the background
      void (async () => {
        for (let i = 0; i < max; i++) {
          await sleep(1 * (i % 10));
          await prefetcher.enqueue(i + 1);
        }

        prefetcher.done();
      })();

      let lastTotal = 0;
      let loopCount = 0;
      for await (const item of prefetcher) {
        loopCount++;
        if (item > lastTotal) {
          lastTotal = item;
        }
      }

      expect(callCount).toBe(max);
      expect(loopCount).toBe(max);
      expect(total).toBe((max * (max + 1)) / 2);
      expect(lastTotal).toBe((max * (max + 1)) / 2);
    });

    it('right number run in parallel - simple', async () => {
      const startTime = Date.now();
      const max = 8;
      const delayBetweenMs = 200;
      const input = [
        { value: 1, ms: delayBetweenMs },
        { value: 2, ms: delayBetweenMs },
        { value: 3, ms: delayBetweenMs },
        { value: 4, ms: delayBetweenMs },
        { value: 5, ms: delayBetweenMs },
        { value: 6, ms: delayBetweenMs },
        { value: 7, ms: delayBetweenMs },
        { value: 8, ms: delayBetweenMs },
      ];
      const prefetcher = new IterableQueueMapper(mapper, { concurrency: 2, maxUnread: 4 });

      // Enqueue items in the background
      void (async () => {
        for (const item of input) {
          await prefetcher.enqueue(item);
        }
        prefetcher.done();
      })();

      let lastTotal = 0;
      let loopCount = 0;
      for await (const item of prefetcher) {
        loopCount++;
        if (item > lastTotal) {
          lastTotal = item;
        }
      }

      expect(loopCount).toBe(max);
      expect(lastTotal).toBe(max);
      // Should require at least 4 batches
      const duration = Date.now() - startTime;
      expect(Date.now() - startTime).toBeLessThan(5 * delayBetweenMs);
      expect(Math.ceil(duration)).toBeGreaterThan(4 * delayBetweenMs);
    });

    it('right number run in parallel - complex', async () => {
      const prefetcher = new IterableQueueMapper(mapper, { concurrency: 4, maxUnread: 4 });
      const delayBetweenMs = 500;

      // First 4 added should not wait at all
      const startTime = Date.now();
      await prefetcher.enqueue({ value: 1, ms: delayBetweenMs });
      await prefetcher.enqueue({ value: 2, ms: delayBetweenMs });
      await prefetcher.enqueue({ value: 3, ms: delayBetweenMs });
      await prefetcher.enqueue({ value: 4, ms: delayBetweenMs });
      expect(Date.now() - startTime).toBeLessThan(delayBetweenMs);

      // Next one added should have had to wait for at least one wait period
      void (async () => {
        await prefetcher.enqueue({ value: 5, ms: delayBetweenMs });
        expect(Math.ceil(Date.now() - startTime)).toBeGreaterThanOrEqual(delayBetweenMs);
        prefetcher.done();
      })();

      let lastSeen = 0;
      let loopCount = 0;
      for await (const item of prefetcher) {
        loopCount++;
        if (item > lastSeen) {
          lastSeen = item;
        }
      }

      expect(loopCount).toBe(5);
      expect(lastSeen).toBe(5);

      // Should require at least 2 batches
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(2.5 * delayBetweenMs);
      expect(Math.ceil(duration)).toBeGreaterThan(2 * delayBetweenMs);
    });
  });
});

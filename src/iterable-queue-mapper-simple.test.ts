/// <reference types="jest" />
import { promisify } from 'util';
import { IterableQueueMapperSimple } from './iterable-queue-mapper-simple';

const sleep = promisify(setTimeout);

describe('IterableQueueMapperSimple', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('single success works - w/ retrier', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const mapper = jest.fn(async (item: number): Promise<void> => {
      await sleep(200);
    });
    const backgroundWriter = new IterableQueueMapperSimple(mapper);

    await backgroundWriter.enqueue(1);

    // Need to wait until the backgroundWriter is idle (has finished any pending requests)
    await backgroundWriter.onIdle();

    expect(mapper.mock.calls.length).toBe(1);
    expect(backgroundWriter.errors.length).toBe(0);
    expect(backgroundWriter.isIdle).toBe(true);
  });

  it('errors caught and exposed', async () => {
    const startTime = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const mapper = jest.fn(async (item: number): Promise<void> => {
      await sleep(200);
      throw new Error('stop this now');
    });
    const backgroundWriter = new IterableQueueMapperSimple(mapper, { concurrency: 4 });

    for (let i = 0; i < 10; i++) {
      await backgroundWriter.enqueue(1);

      if (backgroundWriter.errors.length !== 0) {
        expect(i).toBe(4);
        expect(Date.now() - startTime).toBeGreaterThanOrEqual(200);
        break;
      }
    }
    // Need to wait until the backgroundWriter is idle (has finished any pending requests)
    expect(backgroundWriter.isIdle).toBe(false);
    await backgroundWriter.onIdle();
    expect(backgroundWriter.isIdle).toBe(true);

    expect(backgroundWriter.errors.length).toBe(5);
    expect(backgroundWriter.errors[0].error).toBeInstanceOf(Error);
    expect((backgroundWriter.errors[0].error as Error).message).toBe('stop this now');

    // Show that double onIdle() does not hang or cause an error
    await backgroundWriter.onIdle();

    expect(backgroundWriter.isIdle).toBe(true);
    expect(mapper.mock.calls.length).toBe(5);
    expect(Date.now() - startTime).toBeGreaterThanOrEqual(2 * 200);
  });

  it('multiple success works - concurrency 1, w/ retrier', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const mapper = jest.fn(async (item: number): Promise<void> => {
      await sleep(200);
    });
    const backgroundWriter = new IterableQueueMapperSimple(mapper, {
      concurrency: 1,
    });

    await backgroundWriter.enqueue(1);
    await backgroundWriter.enqueue(2);

    expect(mapper.mock.calls.length).toBe(2);

    // Need to wait until the backgroundWriter is idle (has finished any pending requests)
    expect(backgroundWriter.isIdle).toBe(false);
    await backgroundWriter.onIdle();

    expect(backgroundWriter.isIdle).toBe(true);
    expect(mapper.mock.calls.length).toBe(2);
    expect(backgroundWriter.errors.length).toBe(0);
  });

  it('concurrency 4 sends 4 concurrently then waits', async () => {
    const sleepDurationMs = 500;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const mapper = jest.fn(async (item: number): Promise<void> => {
      await sleep(sleepDurationMs);
    });
    const backgroundWriter = new IterableQueueMapperSimple(mapper, {
      concurrency: 4,
    });

    // First 4 added should not wait at all
    const startTime = Date.now();
    await backgroundWriter.enqueue(1);
    await backgroundWriter.enqueue(2);
    await backgroundWriter.enqueue(3);
    await backgroundWriter.enqueue(4);
    expect(Date.now() - startTime).toBeLessThan(sleepDurationMs);

    expect(mapper.mock.calls.length).toBe(4);

    // Next one added should have had to wait for at least one wait period
    await backgroundWriter.enqueue(5);

    expect(mapper.mock.calls.length).toBe(5);

    expect(Date.now() - startTime).toBeGreaterThanOrEqual(sleepDurationMs);

    // Need to wait until the backgroundWriter is idle (has finished any pending requests)
    expect(backgroundWriter.isIdle).toBe(false);
    await backgroundWriter.onIdle();

    expect(backgroundWriter.isIdle).toBe(true);

    expect(Date.now() - startTime).toBeGreaterThanOrEqual(2 * sleepDurationMs);
    expect(Date.now() - startTime).toBeLessThan(2.2 * sleepDurationMs);

    expect(mapper).toBeCalledTimes(5);

    expect(backgroundWriter.errors.length).toBe(0);
  });

  describe('maxQueueDepth option', () => {
    // Test default behavior without using mocks
    it('defaults maxQueueDepth to equal concurrency', async () => {
      const mapper = jest.fn(async (): Promise<void> => {
        await sleep(10);
      });

      // With default configuration (no explicit maxQueueDepth)
      const backgroundWriter = new IterableQueueMapperSimple(mapper, {
        concurrency: 3,
      });

      // Queue 3 items (should accept without delay - concurrency 3, default maxQueueDepth 3)
      await backgroundWriter.enqueue(1);
      await backgroundWriter.enqueue(2);
      await backgroundWriter.enqueue(3);

      // 4th item should only be accepted after one completes
      const startTime = Date.now();
      await backgroundWriter.enqueue(4);
      const elapsed = Date.now() - startTime;

      // Queue should have been full after first 3 items
      expect(elapsed).toBeGreaterThan(5);

      await backgroundWriter.onIdle();
    });

    it('allows configuring independent queue depth with maxQueueDepth', async () => {
      // Using a longer sleep to make the test more reliable
      const sleepTime = 50;
      const mapper = jest.fn(async (): Promise<void> => {
        await sleep(sleepTime);
      });

      // Set concurrency to 1 but maxQueueDepth to 3
      // This means:
      // - Only 1 item processed at a time
      // - Up to 3 items can be queued before blocking
      const backgroundWriter = new IterableQueueMapperSimple(mapper, {
        concurrency: 1,
        maxQueueDepth: 3,
      });

      // Queue 3 items (should accept without delay with maxQueueDepth 3)
      await backgroundWriter.enqueue(1);
      await backgroundWriter.enqueue(2);
      await backgroundWriter.enqueue(3);

      // 4th item should have to wait
      const startTime = Date.now();
      await backgroundWriter.enqueue(4);
      const elapsed = Date.now() - startTime;

      // Verify that enqueuing the 4th item had to wait
      expect(elapsed).toBeGreaterThanOrEqual(sleepTime - 10); // Allow some margin

      await backgroundWriter.onIdle();

      // Verify all items were processed
      expect(mapper).toHaveBeenCalledTimes(4);
    });

    it('processes items in FIFO order with concurrency 1', async () => {
      const processedItems: number[] = [];

      // Create a mapper that records the order of processing
      const mapper = jest.fn(async (item: number): Promise<void> => {
        await sleep(10);
        processedItems.push(item);
      });

      const backgroundWriter = new IterableQueueMapperSimple(mapper, {
        concurrency: 1, // Process 1 at a time (sequential FIFO)
        maxQueueDepth: 5, // Allow up to 5 in queue
      });

      // Queue all items
      await backgroundWriter.enqueue(1);
      await backgroundWriter.enqueue(2);
      await backgroundWriter.enqueue(3);
      await backgroundWriter.enqueue(4);
      await backgroundWriter.enqueue(5);
      await backgroundWriter.enqueue(6);

      // Wait for all to complete
      await backgroundWriter.onIdle();

      // Verify FIFO order was maintained
      expect(processedItems).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });
});

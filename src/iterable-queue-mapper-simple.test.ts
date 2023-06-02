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
    expect(backgroundWriter.errors[0]).toBeInstanceOf(Error);
    expect((backgroundWriter.errors[0] as Error).message).toBe('stop this now');

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
});

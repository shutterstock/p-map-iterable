/// <reference types="jest" />
import { IterableQueueMapperSimple } from './iterable-queue-mapper-simple';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function sleep<T = void>(ms: number, value?: T): Promise<T> {
  return new Promise<T>((resolve) => setTimeout(() => resolve(value as T), ms));
}

async function withVirtualTime(test: () => Promise<void>): Promise<void> {
  jest.useFakeTimers();
  try {
    const result = test();
    void result.catch(() => undefined);
    await jest.runAllTimersAsync();
    await result;
  } finally {
    jest.useRealTimers();
  }
}

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
    await withVirtualTime(async () => {
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
    await withVirtualTime(async () => {
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

      expect(mapper).toHaveBeenCalledTimes(5);

      expect(backgroundWriter.errors.length).toBe(0);
    });
  });

  describe('bounded input backlog', () => {
    it('admits a burst of ordered writes up to maxQueueDepth before blocking', async () => {
      const gates = Array.from({ length: 4 }, deferred);
      const started: number[] = [];
      const accepted: number[] = [];
      const writer = new IterableQueueMapperSimple(
        async (item: number) => {
          started.push(item);
          await gates[item - 1].promise;
        },
        { concurrency: 1, maxQueueDepth: 3 },
      );
      const enqueues = [1, 2, 3, 4].map(async (item) =>
        writer.enqueue(item).then(() => {
          accepted.push(item);
        }),
      );

      try {
        await settle();
        expect(accepted).toEqual([1, 2, 3]);
        expect(started).toEqual([1]);

        gates[0].resolve();
        await settle();
        expect(accepted).toEqual([1, 2, 3, 4]);
        expect(started).toEqual([1, 2]);
      } finally {
        gates.forEach((gate) => gate.resolve());
        await Promise.all(enqueues);
        await writer.onIdle();
      }
      expect(started).toEqual([1, 2, 3, 4]);
    });

    it('defaults the admission limit to concurrency', async () => {
      const gate = deferred();
      const accepted: number[] = [];
      const mapper = jest.fn(async () => {
        await gate.promise;
      });
      const writer = new IterableQueueMapperSimple(mapper, { concurrency: 2 });
      const enqueues = [1, 2, 3].map(async (item) =>
        writer.enqueue(item).then(() => {
          accepted.push(item);
        }),
      );
      try {
        await settle();
        expect(accepted).toEqual([1, 2]);
        expect(mapper).toHaveBeenCalledTimes(2);
      } finally {
        gate.resolve();
        await Promise.all(enqueues);
        await writer.onIdle();
      }
    });

    it('bounds concurrent admissions and running mappers independently', async () => {
      const gates = Array.from({ length: 7 }, deferred);
      const accepted: number[] = [];
      const started: number[] = [];
      let active = 0;
      let peak = 0;
      const writer = new IterableQueueMapperSimple(
        async (item: number) => {
          started.push(item);
          active++;
          peak = Math.max(peak, active);
          await gates[item - 1].promise;
          active--;
        },
        { concurrency: 2, maxQueueDepth: 4 },
      );
      const enqueues = [1, 2, 3, 4, 5, 6, 7].map(async (item) =>
        writer.enqueue(item).then(() => {
          accepted.push(item);
        }),
      );
      try {
        await settle();
        expect(accepted).toEqual([1, 2, 3, 4]);
        expect(started).toEqual([1, 2]);

        gates[1].resolve();
        await settle();
        expect(accepted).toEqual([1, 2, 3, 4, 5]);
        expect(started).toEqual([1, 2, 3]);
        expect(active).toBe(2);

        // New callers must wait behind earlier blocked callers.
        const last = writer.enqueue(8).then(() => {
          accepted.push(8);
        });
        enqueues.push(last);
        gates.push(deferred());
        gates[0].resolve();
        await settle();
        expect(accepted).toEqual([1, 2, 3, 4, 5, 6]);
        expect(started).toEqual([1, 2, 3, 4]);
      } finally {
        gates.forEach((gate) => gate.resolve());
        await Promise.all(enqueues);
        await writer.onIdle();
      }
      expect(peak).toBe(2);
      expect(active).toBe(0);
      expect(started).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(accepted).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('onIdle closes admission and drains calls made before close, including blocked calls', async () => {
      const gate = deferred();
      const completed: number[] = [];
      const writer = new IterableQueueMapperSimple(
        async (item: number) => {
          if (item === 1) await gate.promise;
          completed.push(item);
        },
        { concurrency: 1, maxQueueDepth: 3 },
      );
      const enqueues = [1, 2, 3, 4, 5].map(async (item) => writer.enqueue(item));
      let drained = false;
      const close = writer.onIdle().then(() => {
        drained = true;
      });
      try {
        await settle();
        expect(drained).toBe(false);
        expect(writer.isIdle).toBe(false);
        await expect(writer.enqueue(6)).rejects.toThrow();
      } finally {
        gate.resolve();
        await Promise.all([...enqueues, close, writer.onIdle()]);
      }
      expect(completed).toEqual([1, 2, 3, 4, 5]);
      expect(writer.isIdle).toBe(true);
      await writer.onIdle();
      await expect(writer.enqueue(7)).rejects.toThrow();
    });

    it('releases capacity after synchronous and asynchronous mapper failures', async () => {
      const gate = deferred();
      const syncError = new Error('sync write failed');
      const asyncError = new Error('async write failed');
      const seen: { item: number; index: number }[] = [];
      const accepted: number[] = [];
      const writer = new IterableQueueMapperSimple(
        // Exercise a synchronous throw, not an async function's rejected promise.
        // eslint-disable-next-line @typescript-eslint/promise-function-async
        (item: number, index: number) => {
          seen.push({ item, index });
          if (item === 2) throw syncError;
          return gate.promise.then(() => {
            if (item === 3) throw asyncError;
          });
        },
        { concurrency: 1, maxQueueDepth: 3 },
      );
      const enqueues = [1, 2, 3, 4].map(async (item) =>
        writer.enqueue(item).then(() => {
          accepted.push(item);
        }),
      );
      try {
        await settle();
        expect(accepted).toEqual([1, 2, 3]);
      } finally {
        gate.resolve();
        await Promise.all(enqueues);
        await writer.onIdle();
      }
      expect(seen).toEqual([1, 2, 3, 4].map((item, index) => ({ item, index })));
      expect(writer.errors).toEqual([
        { item: 2, error: syncError },
        { item: 3, error: asyncError },
      ]);
      expect(writer.isIdle).toBe(true);
    });

    it.each([0, -1, 1.5, NaN, null])('rejects invalid maxQueueDepth %s', (maxQueueDepth) => {
      expect(
        () =>
          new IterableQueueMapperSimple(() => undefined, {
            concurrency: 1,
            maxQueueDepth: maxQueueDepth as number,
          }),
      ).toThrow(/maxQueueDepth/);
    });

    it('requires maxQueueDepth to be at least concurrency', () => {
      expect(
        () =>
          new IterableQueueMapperSimple(() => undefined, {
            concurrency: 4,
            maxQueueDepth: 3,
          }),
      ).toThrow(/maxQueueDepth.*concurrency/);
    });

    it('allows an unbounded backlog while preserving finite concurrency', async () => {
      const gate = deferred();
      const mapper = jest.fn(async () => {
        await gate.promise;
      });
      const writer = new IterableQueueMapperSimple(mapper, {
        concurrency: 1,
        maxQueueDepth: Infinity,
      });
      let admitted = 0;
      const enqueues = [1, 2, 3, 4, 5].map(async (item) =>
        writer.enqueue(item).then(() => {
          admitted++;
        }),
      );
      try {
        await settle();
        expect(admitted).toBe(5);
        expect(mapper).toHaveBeenCalledTimes(1);
      } finally {
        gate.resolve();
        await Promise.all(enqueues);
        await writer.onIdle();
      }
    });

    it('drains an empty writer and supports repeated or concurrent closes', async () => {
      const mapper = jest.fn();
      const writer = new IterableQueueMapperSimple(mapper);
      await Promise.all([writer.onIdle(), writer.onIdle()]);
      await writer.onIdle();
      expect(writer.isIdle).toBe(true);
      expect(mapper).not.toHaveBeenCalled();
      await expect(writer.enqueue(1)).rejects.toThrow();
    });

    it('rejects undefined inputs without consuming capacity or a mapper index', async () => {
      const mapper = jest.fn();
      const writer = new IterableQueueMapperSimple<number | undefined>(mapper);
      await expect(writer.enqueue(undefined)).rejects.toThrow('cannot enqueue `undefined`');
      await writer.enqueue(1);
      await writer.onIdle();
      expect(mapper).toHaveBeenCalledTimes(1);
      expect(mapper).toHaveBeenCalledWith(1, 0);
    });

    it.each([0, -1, 1.5, NaN, null])(
      'continues rejecting invalid concurrency %s',
      (concurrency) => {
        expect(
          () =>
            new IterableQueueMapperSimple(() => undefined, {
              concurrency: concurrency as number,
            }),
        ).toThrow(/concurrency/);
      },
    );

    it('rejects a non-function mapper before accepting work', () => {
      expect(() => new IterableQueueMapperSimple(null as never)).toThrow(
        'Mapper function is required',
      );
    });

    it('supports infinite concurrency without creating runners for absent work', async () => {
      const mapper = jest.fn();
      const writer = new IterableQueueMapperSimple(mapper, { concurrency: Infinity });
      await Promise.all([1, 2, 3].map(async (item) => writer.enqueue(item)));
      await writer.onIdle();
      expect(mapper.mock.calls).toEqual([
        [1, 0],
        [2, 1],
        [3, 2],
      ]);
    });

    it('drains a large backlog of synchronously failing writes without recursive invocation', async () => {
      const gate = deferred();
      const failure = new Error('write failed');
      const writer = new IterableQueueMapperSimple(
        // Keep failures synchronous to exercise draining without recursive mapper calls.
        // eslint-disable-next-line @typescript-eslint/promise-function-async
        (item: number) => {
          if (item === 0) return gate.promise;
          throw failure;
        },
        { concurrency: 1, maxQueueDepth: 10001 },
      );
      await Promise.all(Array.from({ length: 10001 }, async (_, item) => writer.enqueue(item)));
      gate.resolve();
      await writer.onIdle();
      expect(writer.errors).toHaveLength(10000);
      expect(writer.errors[0]).toEqual({ item: 1, error: failure });
      expect(writer.errors[9999]).toEqual({ item: 10000, error: failure });
    });
  });
});

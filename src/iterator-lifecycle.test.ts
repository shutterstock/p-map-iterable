import { BlockingQueue } from './blocking-queue';
import { IterableMapper } from './iterable-mapper';
import { IterableQueueMapper } from './iterable-queue-mapper';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('iterator lifecycle', () => {
  test.each([new Error('mapper failed'), undefined, null, 'failed', 0, false])(
    'releases concurrent and future reads after throwing %p',
    async (reason) => {
      const mapper = new IterableMapper(
        [1],
        () => {
          throw reason;
        },
        { concurrency: 1, maxUnread: 1 },
      );
      const reads = await Promise.allSettled([mapper.next(), mapper.next(), mapper.next()]);
      expect(reads).toEqual([
        { status: 'rejected', reason },
        { status: 'rejected', reason },
        { status: 'rejected', reason },
      ]);
      await expect(mapper.next()).rejects.toBe(reason);
    },
  );

  test('undefined is a valid mapper result rather than end of input', async () => {
    const mapper = new IterableMapper([1, 2], () => undefined, { concurrency: 1, maxUnread: 1 });
    expect(await mapper.next()).toEqual({ value: undefined, done: false });
    expect(await mapper.next()).toEqual({ value: undefined, done: false });
    expect(await mapper.next()).toEqual({ value: undefined, done: true });
  });

  test('breaking iteration closes the source exactly once', async () => {
    let closeCount = 0;
    function* source() {
      try {
        yield 1;
        yield 2;
        yield 3;
      } finally {
        closeCount++;
      }
    }
    const mapper = new IterableMapper(source(), (value) => value, {
      concurrency: 1,
      maxUnread: 1,
    });
    for await (const value of mapper) {
      expect(value).toBe(1);
      break;
    }
    expect(closeCount).toBe(1);
    await mapper.return();
    expect(closeCount).toBe(1);
    expect(await mapper.next()).toEqual({ value: undefined, done: true });
  });

  test('return releases reads without waiting for an uncooperative mapper', async () => {
    const result = deferred<number>();
    const started = deferred<void>();
    const mapper = new IterableMapper(
      [1],
      async () => {
        started.resolve();
        return result.promise;
      },
      { concurrency: 1, maxUnread: 1 },
    );
    const read = mapper.next();
    await started.promise;
    await mapper.return();
    expect(await read).toEqual({ value: undefined, done: true });
    result.reject(new Error('late failure after close'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await mapper.next()).toEqual({ value: undefined, done: true });
  });

  test('source failure closes the source and releases all readers', async () => {
    const error = new Error('source failed');
    const close = jest.fn(() => ({ value: undefined, done: true as const }));
    const source: Iterable<number> = {
      [Symbol.iterator]: () => ({
        next: () => {
          throw error;
        },
        return: close,
      }),
    };
    const mapper = new IterableMapper(source, (value) => value);
    await expect(mapper.next()).rejects.toBe(error);
    await expect(mapper.next()).rejects.toBe(error);
    await mapper.return();
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('queue mapper failure releases producers blocked on admission', async () => {
    const error = new Error('write failed');
    const result = deferred<number>();
    const started = deferred<void>();
    const mapper = new IterableQueueMapper<number, number>(
      async () => {
        started.resolve();
        return result.promise;
      },
      { concurrency: 1, maxUnread: 1 },
    );
    await mapper.enqueue(1);
    await started.promise;
    const pendingWrite = mapper.enqueue(2);
    const writeFailed = expect(pendingWrite).rejects.toBe(error);
    const readFailed = expect(mapper.next()).rejects.toBe(error);
    result.reject(error);
    await Promise.all([writeFailed, readFailed]);
    await expect(mapper.enqueue(3)).rejects.toBe(error);
  });

  test('invalid iterator results reject readers instead of escaping in a background promise', async () => {
    const source: Iterable<number> = {
      [Symbol.iterator]: () => ({
        next: () => 42 as unknown as IteratorResult<number>,
      }),
    };
    const mapper = new IterableMapper(source, (value) => value);
    await expect(mapper.next()).rejects.toThrow('Source iterator next() must return an object');
    await expect(mapper.next()).rejects.toThrow('Source iterator next() must return an object');
  });

  test('an earlier done result does not discard another pending source read', async () => {
    const delayed = deferred<IteratorResult<number>>();
    const waiting = deferred<void>();
    let calls = 0;
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]: () => ({
        async next() {
          calls++;
          if (calls === 1) return { value: 1, done: false };
          if (calls === 2) {
            waiting.resolve();
            return delayed.promise;
          }
          return { value: undefined, done: true };
        },
      }),
    };
    const mapper = new IterableMapper(source, (value) => value, { concurrency: 2, maxUnread: 3 });
    await waiting.promise;
    expect(await mapper.next()).toEqual({ value: 1, done: false });
    delayed.resolve({ value: 2, done: false });
    expect(await mapper.next()).toEqual({ value: 2, done: false });
    expect(await mapper.next()).toEqual({ value: undefined, done: true });
  });

  test('queue mapper return releases a pending producer and reader', async () => {
    const result = deferred<number>();
    const mapper = new IterableQueueMapper<number, number>(async () => result.promise, {
      concurrency: 1,
      maxUnread: 1,
    });
    await mapper.enqueue(1);
    const write = mapper.enqueue(2);
    const writeFailed = expect(write).rejects.toThrow('Iteration closed');
    const read = mapper.next();
    await mapper.return();
    await writeFailed;
    expect(await read).toEqual({ value: undefined, done: true });
    result.resolve(1);
  });

  test('blocking queue abort rejects all waiters and discards buffered input', async () => {
    const error = new Error('queue aborted');
    const queue = new BlockingQueue<number>({ maxUnread: 0 });
    const writes = Promise.allSettled([queue.enqueue(1), queue.enqueue(2)]);
    queue.abort(error);
    expect(await writes).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ]);
    expect(queue.length).toBe(0);
    await expect(queue.dequeue()).rejects.toBe(error);
    await expect(queue.enqueue(3)).rejects.toBe(error);
    const empty = new BlockingQueue<number>();
    const reads = Promise.allSettled([empty.dequeue(), empty.dequeue()]);
    empty.abort(error);
    expect(await reads).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ]);
  });

  test('external abort signals running mappers and releases every reader', async () => {
    const abort = new AbortController();
    const error = new Error('request cancelled');
    const started = deferred<void>();
    const mapper = new IterableMapper(
      [1],
      async (_value, _index, signal) => {
        started.resolve();
        return new Promise<number>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      { concurrency: 1, maxUnread: 1, signal: abort.signal },
    );
    const reads = Promise.allSettled([mapper.next(), mapper.next()]);
    await started.promise;
    abort.abort(error);
    expect(await reads).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
    ]);
    await expect(mapper.next()).rejects.toBe(error);
  });

  test('a pre-aborted input never invokes the mapper', async () => {
    const abort = new AbortController();
    const reason = new Error('already cancelled');
    abort.abort(reason);
    const callback = jest.fn((value: number) => value);
    const mapper = new IterableMapper([1], callback, { signal: abort.signal });
    await expect(mapper.next()).rejects.toBe(reason);
    expect(callback).not.toHaveBeenCalled();
  });

  test('completed iteration detaches from later external cancellation', async () => {
    const abort = new AbortController();
    const mapper = new IterableMapper([1], (value) => value, { signal: abort.signal });
    expect(await mapper.next()).toEqual({ value: 1, done: false });
    expect(await mapper.next()).toEqual({ value: undefined, done: true });
    abort.abort(new Error('later request'));
    expect(await mapper.next()).toEqual({ value: undefined, done: true });
  });

  test('queue abort releases producers even without a pending result consumer', async () => {
    const abort = new AbortController();
    const error = new Error('stop producer');
    const started = deferred<void>();
    const result = deferred<number>();
    const queue = new IterableQueueMapper<number, number>(
      async () => {
        started.resolve();
        return result.promise;
      },
      { concurrency: 1, maxUnread: 1, signal: abort.signal },
    );
    await queue.enqueue(1);
    await started.promise;
    const failed = expect(queue.enqueue(2)).rejects.toBe(error);
    abort.abort(error);
    await failed;
    await expect(queue.enqueue(3)).rejects.toBe(error);
    await expect(queue.next()).rejects.toBe(error);
    result.resolve(1);
  });

  test('return cooperatively aborts running mapper callbacks', async () => {
    const started = deferred<AbortSignal>();
    const mapper = new IterableMapper(
      [1],
      async (_value, _index, signal) => {
        started.resolve(signal);
        return new Promise<number>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      { concurrency: 1, maxUnread: 1 },
    );
    const signal = await started.promise;
    await mapper.return();
    expect(signal.aborted).toBe(true);
    expect(await mapper.next()).toEqual({ value: undefined, done: true });
  });
});

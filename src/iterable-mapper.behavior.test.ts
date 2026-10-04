import { IterableMapper } from './iterable-mapper';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('IterableMapper public behavior', () => {
  it.each([
    undefined,
    { concurrency: undefined, maxUnread: undefined, stopOnMapperError: undefined },
  ])('applies concurrency and unread-buffer defaults with options %p', async (options) => {
    const values = Array.from({ length: 16 }, (_, index) => index + 1);
    const gates = values.map(() => deferred<void>());
    const started: number[] = [];
    let active = 0;
    let peakActive = 0;
    const mapper = new IterableMapper(
      values,
      async (value) => {
        started.push(value);
        active++;
        peakActive = Math.max(peakActive, active);
        await gates[value - 1].promise;
        active--;
        return value;
      },
      options,
    );

    await nextTurn();
    expect(started).toEqual([1, 2, 3, 4]);
    expect(active).toBe(4);

    for (const gate of gates.slice(0, 4)) gate.resolve();
    await nextTurn();
    expect(started).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(active).toBe(4);

    for (const gate of gates.slice(4, 8)) gate.resolve();
    await nextTurn();
    expect(active).toBe(0);
    expect(started).toHaveLength(8);

    // With eight unread results, mapping pauses until the consumer drains them.
    // Consuming restarts mapping while the remaining jobs are still blocked.
    const results: number[] = [];
    const consumer = (async () => {
      for await (const value of mapper) results.push(value);
    })();
    await nextTurn();
    expect(results).toEqual(values.slice(0, 8));
    expect(started).toEqual(values.slice(0, 12));
    expect(active).toBe(4);

    for (const gate of gates.slice(8)) gate.resolve();
    await consumer;
    expect(results).toEqual(values);
    expect(started).toEqual(values);
    expect(peakActive).toBe(4);
    await expect(mapper.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it('defaults an explicitly undefined stopOnMapperError to stopping on the first failure', async () => {
    const failure = new Error('mapper failed');
    const started: number[] = [];
    const mapper = new IterableMapper(
      [1, 2, 3],
      (value) => {
        started.push(value);
        throw failure;
      },
      { concurrency: 1, maxUnread: 1, stopOnMapperError: undefined },
    );

    await expect(mapper.next()).rejects.toBe(failure);
    await nextTurn();
    expect(started).toEqual([1]);
  });

  it.each([Number.NaN, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid concurrency of %p',
    (concurrency) => {
      expect(() => new IterableMapper([], (value) => value, { concurrency })).toThrow(
        /Expected `concurrency` to be an integer/,
      );
    },
  );

  it.each([Number.NaN, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid maxUnread of %p',
    (maxUnread) => {
      expect(() => new IterableMapper([], (value) => value, { maxUnread })).toThrow(
        /Expected `maxUnread` to be an integer/,
      );
    },
  );

  it.each(['value', 'promise'])(
    'rejects an undefined mapper result returned as a %s',
    async (kind) => {
      const mapper = new IterableMapper(
        [1],
        (): undefined | Promise<undefined> =>
          kind === 'promise' ? Promise.resolve(undefined) : undefined,
        { concurrency: 1, maxUnread: 1 },
      );

      await expect(mapper.next()).rejects.toThrow(new TypeError('no element was returned'));
    },
  );

  it('preserves falsy mapped values', async () => {
    const values = [0, false, '', null, Number.NaN];
    const mapper = new IterableMapper(values, (value) => value, {
      concurrency: 1,
      maxUnread: 1,
    });
    const results = [];
    for await (const value of mapper) results.push(value);

    expect(results).toEqual(values);
    await expect(mapper.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it.each([true, false])(
    'does not map a late source item after an iterator failure with stopOnMapperError=%s',
    async (stopOnMapperError) => {
      const mappedFirst = deferred<number>();
      const lateInput = deferred<IteratorResult<number>>();
      const lateRequested = deferred<void>();
      const sourceError = new Error('source failed');
      let sourceCalls = 0;
      const next = jest.fn(async (): Promise<IteratorResult<number>> => {
        switch (sourceCalls++) {
          case 0:
            return { done: false, value: 1 };
          case 1:
            lateRequested.resolve();
            return lateInput.promise;
          default:
            throw sourceError;
        }
      });
      const input: AsyncIterable<number> = {
        [Symbol.asyncIterator]: () => ({ next }),
      };
      const map = jest.fn(async () => mappedFirst.promise);
      const mapper = new IterableMapper(input, map, {
        concurrency: 2,
        maxUnread: 3,
        stopOnMapperError,
      });

      const first = mapper.next();
      await lateRequested.promise;
      mappedFirst.resolve(10);
      await expect(first).resolves.toEqual({ done: false, value: 10 });
      await expect(mapper.next()).rejects.toBe(sourceError);

      // A read already in flight may finish after the failure. Allow its promise
      // continuations to run before checking that no new user work started.
      lateInput.resolve({ done: false, value: 2 });
      await nextTurn();

      expect(next).toHaveBeenCalledTimes(3);
      expect(map).toHaveBeenCalledTimes(1);
      expect(map).toHaveBeenCalledWith(1, 0);
    },
  );
});

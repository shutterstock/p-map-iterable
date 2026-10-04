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

import {
  Prefetcher,
  BackgroundFlusher,
  SimpleBackgroundFlusher,
  IterableMapper,
  IterableQueueMapper,
  IterableQueueMapperSimple,
} from './index';
import type {
  PrefetcherOptions,
  BackgroundFlusherOptions,
  SimpleBackgroundFlusherOptions,
  IterableQueueMapperSimpleOptions,
} from './index';

async function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

describe('public class aliases', () => {
  it.each([
    ['Prefetcher', Prefetcher, IterableMapper],
    ['BackgroundFlusher', BackgroundFlusher, IterableQueueMapper],
    ['SimpleBackgroundFlusher', SimpleBackgroundFlusher, IterableQueueMapperSimple],
  ])('%s preserves the original constructor identity', (_name, alias, original) => {
    expect(alias).toBe(original);
  });

  it('supports generic Prefetcher instance types and subclasses', async () => {
    class StringPrefetcher extends Prefetcher<number, string> {}
    const options: PrefetcherOptions = { concurrency: 1, maxUnread: 2 };
    const original: IterableMapper<number, string> = new StringPrefetcher(
      [1, 2, 3],
      async (value) => {
        await delay();
        return String(value);
      },
      options,
    );
    const prefetcher: Prefetcher<number, string> = original;
    const results: string[] = [];
    for await (const result of prefetcher) results.push(result);
    expect(results).toEqual(['1', '2', '3']);
    expect(prefetcher).toBeInstanceOf(IterableMapper);
  });

  it('flushes more inputs than the result buffer with a concurrent consumer', async () => {
    const options: BackgroundFlusherOptions = { concurrency: 1, maxUnread: 2 };
    const original: IterableQueueMapper<number, string> = new BackgroundFlusher(
      async (value: number) => {
        await delay();
        return String(value);
      },
      options,
    );
    const flusher: BackgroundFlusher<number, string> = original;
    const producer = (async () => {
      for (let value = 1; value <= 20; value++) await flusher.enqueue(value);
      flusher.done();
    })();
    const results: string[] = [];
    const consumer = (async () => {
      for await (const result of flusher) results.push(result);
    })();
    await Promise.all([producer, consumer]);
    expect(results).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)));
  });

  it('collects simple-flusher errors and closes input at onIdle', async () => {
    const options: SimpleBackgroundFlusherOptions = { concurrency: 1 };
    const originalOptions: IterableQueueMapperSimpleOptions = options;
    const original: IterableQueueMapperSimple<number> = new SimpleBackgroundFlusher(
      async (value: number) => {
        await delay();
        if (value === 2) throw new Error('write failed');
      },
      originalOptions,
    );
    const flusher: SimpleBackgroundFlusher<number> = original;
    for (const value of [1, 2, 3]) await flusher.enqueue(value);
    await flusher.onIdle();
    expect(flusher.isIdle).toBe(true);
    expect(flusher.errors).toEqual([{ item: 2, error: new Error('write failed') }]);
    await expect(flusher.enqueue(4)).rejects.toThrow('`enqueue` called after `done` called');
  });
});

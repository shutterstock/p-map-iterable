import {
  ConcurrentMapper,
  MappingQueue,
  WorkerQueue,
  IterableMapper,
  IterableQueueMapper,
  IterableQueueMapperSimple,
} from './index';
import type {
  ConcurrentMapperOptions,
  MappingQueueOptions,
  WorkerQueueOptions,
  IterableQueueMapperSimpleOptions,
} from './index';

async function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

describe('public class aliases', () => {
  it.each([
    ['ConcurrentMapper', ConcurrentMapper, IterableMapper],
    ['MappingQueue', MappingQueue, IterableQueueMapper],
    ['WorkerQueue', WorkerQueue, IterableQueueMapperSimple],
  ])('%s preserves the original constructor identity', (_name, alias, original) => {
    expect(alias).toBe(original);
  });

  it('supports generic ConcurrentMapper instance types and subclasses', async () => {
    class StringMapper extends ConcurrentMapper<number, string> {}
    const options: ConcurrentMapperOptions = { concurrency: 1, maxUnread: 2 };
    const original: IterableMapper<number, string> = new StringMapper(
      [1, 2, 3],
      async (value) => {
        await delay();
        return String(value);
      },
      options,
    );
    const mapper: ConcurrentMapper<number, string> = original;
    const results: string[] = [];
    for await (const result of mapper) results.push(result);
    expect(results).toEqual(['1', '2', '3']);
    expect(mapper).toBeInstanceOf(IterableMapper);
  });

  it('maps more queued inputs than the result buffer with a concurrent consumer', async () => {
    const options: MappingQueueOptions = { concurrency: 1, maxUnread: 2 };
    const original: IterableQueueMapper<number, string> = new MappingQueue(
      async (value: number) => {
        await delay();
        return String(value);
      },
      options,
    );
    const queue: MappingQueue<number, string> = original;
    const producer = (async () => {
      for (let value = 1; value <= 20; value++) await queue.enqueue(value);
      queue.done();
    })();
    const results: string[] = [];
    const consumer = (async () => {
      for await (const result of queue) results.push(result);
    })();
    await Promise.all([producer, consumer]);
    expect(results).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)));
  });

  it('collects worker errors and closes input at onIdle', async () => {
    const options: WorkerQueueOptions = { concurrency: 1 };
    const originalOptions: IterableQueueMapperSimpleOptions = options;
    const original: IterableQueueMapperSimple<number> = new WorkerQueue(async (value: number) => {
      await delay();
      if (value === 2) throw new Error('task failed');
    }, originalOptions);
    const queue: WorkerQueue<number> = original;
    for (const value of [1, 2, 3]) await queue.enqueue(value);
    await queue.onIdle();
    expect(queue.isIdle).toBe(true);
    expect(queue.errors).toEqual([{ item: 2, error: new Error('task failed') }]);
    await expect(queue.enqueue(4)).rejects.toThrow('`enqueue` called after `done` called');
  });
});

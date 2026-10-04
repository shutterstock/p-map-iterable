import {
  Queue,
  BlockingQueue,
  IterableQueue,
  IterableMapper,
  IterableQueueMapper,
  IterableQueueMapperSimple,
  type Mapper,
  type BlockingQueueOptions,
  type IterableQueueOptions,
  type IterableMapperOptions,
  type IterableQueueMapperOptions,
} from '@shutterstock/p-map-iterable';

function check(condition: boolean): void {
  if (!condition) throw new Error('Consumer assertion failed');
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const value of source) results.push(value);
  return results;
}

async function main(): Promise<void> {
  const queue: Queue<number> = new Queue<number>();
  queue.enqueue(1);
  check(queue.dequeue() === 1 && queue.length === 0);

  const blockingOptions: BlockingQueueOptions = { maxUnread: 1 };
  const blocking: BlockingQueue<number> = new BlockingQueue<number>(blockingOptions);
  await blocking.enqueue(2);
  blocking.done();
  check((await blocking.dequeue()) === 2 && (await blocking.dequeue()) === undefined);

  const iterableOptions: IterableQueueOptions = { maxUnread: 1 };
  const iterable: IterableQueue<number> = new IterableQueue<number>(iterableOptions);
  await iterable.enqueue(3);
  iterable.done();
  check(JSON.stringify(await collect(iterable)) === '[3]');

  const mapper: Mapper<number, string> = (value, index) => `${index}:${value * 2}`;
  const options: IterableMapperOptions = { concurrency: 1, maxUnread: 1 };
  const mapped: IterableMapper<number, string> = new IterableMapper([1, 2], mapper, options);
  check(JSON.stringify(await collect(mapped)) === '["0:2","1:4"]');

  const queuedOptions: IterableQueueMapperOptions = options;
  const queued: IterableQueueMapper<number, string> = new IterableQueueMapper(
    mapper,
    queuedOptions,
  );
  const consuming = collect(queued);
  await queued.enqueue(4);
  queued.done();
  check(JSON.stringify(await consuming) === '["0:8"]');

  const flushed: number[] = [];
  const flusher: IterableQueueMapperSimple<number> = new IterableQueueMapperSimple(
    (value: number) => {
      flushed.push(value);
    },
    { concurrency: 1 },
  );
  await flusher.enqueue(5);
  await flusher.onIdle();
  check(flusher.isIdle && flusher.errors.length === 0 && JSON.stringify(flushed) === '[5]');

  const failure = new Error('original failure');
  const rejections = [failure, 'primitive failure', 0, null, undefined];
  const failed = new IterableMapper(rejections, (value): Promise<number> => Promise.reject(value), {
    ...options,
    stopOnMapperError: false,
  });
  let caught: unknown;
  try {
    await collect(failed);
  } catch (error) {
    caught = error;
  }
  check(caught instanceof AggregateError);
  const aggregate = caught as AggregateError;
  check(aggregate.errors.length === rejections.length);
  rejections.forEach((value, index) => check(aggregate.errors[index] === value));
  check(!(Symbol.iterator in aggregate));

  // Type failures must stay failures: declarations cannot silently resolve to any.
  // @ts-expect-error Queue<number> does not accept strings.
  queue.enqueue('invalid');
  // @ts-expect-error Mapper output does not match Mapper<number, string>.
  const invalidMapper: Mapper<number, string> = () => 1;
  void invalidMapper;
}

void main();

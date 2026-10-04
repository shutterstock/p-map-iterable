import {
  Queue,
  BlockingQueue,
  IterableQueue,
  IterableMapper,
  IterableQueueMapper,
  IterableQueueMapperSimple,
  TaskQueue,
  QueueFullError,
  QueueClosedError,
  TaskCancelledError,
  type Mapper,
  type BlockingQueueOptions,
  type IterableQueueOptions,
  type IterableMapperOptions,
  type IterableQueueMapperOptions,
  type IterableQueueMapperSimpleOptions,
  type Task,
  type TaskOutcome,
  type TaskHandle,
  type TaskQueueOptions,
  type TaskOptions,
  type TaskQueueCloseOptions,
} from '@shutterstock/p-map-iterable';

function check(condition: boolean): void {
  if (!condition) throw new Error('Consumer assertion failed');
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const value of source) results.push(value);
  return results;
}

async function exerciseTaskQueue(): Promise<void> {
  const options: TaskQueueOptions = { concurrency: 1, maxPending: 1 };
  const queue: TaskQueue = new TaskQueue(options);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  const task: Task<number> = async (signal) => {
    check(!signal.aborted);
    started = true;
    await gate;
    return 7;
  };
  const taskOptions: TaskOptions = { signal: new AbortController().signal };
  const first: TaskHandle<number> = queue.submit(task, taskOptions);
  const pending: TaskHandle<number> = queue.submit(() => 8);
  check(!started && queue.running === 1 && queue.pending === 1);

  let overload: unknown;
  let rejectedTaskStarted = false;
  try {
    queue.submit(() => {
      rejectedTaskStarted = true;
      return 9;
    });
  } catch (error) {
    overload = error;
  }
  check(overload instanceof QueueFullError && !rejectedTaskStarted);
  const capacity = queue.onCapacity();
  check(pending.cancel('skip queued task'));
  const cancelled: TaskOutcome<number> = await pending.result;
  check(cancelled.status === 'rejected');
  if (cancelled.status === 'rejected') {
    check(cancelled.reason instanceof TaskCancelledError);
    check((cancelled.reason as TaskCancelledError).reason === 'skip queued task');
  }
  await capacity;
  check(started && queue.running === 1 && queue.pending === 0);
  release();
  const outcome: TaskOutcome<number> = await first.result;
  check(outcome.status === 'fulfilled');
  if (outcome.status === 'fulfilled') check(outcome.value === 7);
  await queue.onIdle();
  check(queue.isIdle && !queue.isClosed);
  const value: number = await queue.add(() => 11);
  check(value === 11);

  const failure = new Error('task failure');
  const failed: TaskHandle<number> = queue.submit(() => Promise.reject(failure));
  const failedOutcome = await failed.result;
  check(failedOutcome.status === 'rejected' && failedOutcome.reason === failure);
  const primitive = await queue.submit(() => Promise.reject(undefined)).result;
  check(primitive.status === 'rejected' && primitive.reason === undefined);
  await queue.drain();

  let finish!: () => void;
  const runningGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let runningSignal: AbortSignal | undefined;
  const running = queue.submit(async (signal) => {
    runningSignal = signal;
    await runningGate;
    signal.throwIfAborted();
    return 12;
  });
  await Promise.resolve();
  check(running.cancel('abort running task'));
  check(runningSignal?.aborted === true && queue.running === 1);
  const discarded = queue.submit(() => 13);
  const closeOptions: TaskQueueCloseOptions = { cancelPending: true, abortRunning: true };
  const closing = queue.close(closeOptions);
  check(queue.isClosed && queue.running === 1 && queue.pending === 0);
  const discardedOutcome = await discarded.result;
  check(
    discardedOutcome.status === 'rejected' && discardedOutcome.reason instanceof TaskCancelledError,
  );
  let closed: unknown;
  try {
    queue.submit(() => 14);
  } catch (error) {
    closed = error;
  }
  check(closed instanceof QueueClosedError);
  finish();
  await closing;
  const runningOutcome = await running.result;
  check(runningOutcome.status === 'rejected');
  if (runningOutcome.status === 'rejected') {
    check(runningOutcome.reason instanceof TaskCancelledError);
    check((runningOutcome.reason as TaskCancelledError).reason === 'abort running task');
  }
  check(queue.isIdle);

  // @ts-expect-error Task<number> must produce a number.
  const invalidTask: Task<number> = () => 'invalid';
  void invalidTask;
}

async function main(): Promise<void> {
  await exerciseTaskQueue();
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
  const simpleOptions: IterableQueueMapperSimpleOptions = { concurrency: 1 };
  const flusher: IterableQueueMapperSimple<number> = new IterableQueueMapperSimple(
    (value: number) => {
      flushed.push(value);
    },
    simpleOptions,
  );
  await flusher.enqueue(5);
  await flusher.onIdle();
  check(flusher.isIdle && flusher.errors.length === 0 && JSON.stringify(flushed) === '[5]');

  const failure = new Error('original failure');
  let coercions = 0;
  const hostileString = {
    toString(): string {
      coercions++;
      throw new Error('hostile toString');
    },
  };
  const hostilePrimitive = {
    [Symbol.toPrimitive](): string {
      coercions++;
      throw new Error('hostile Symbol.toPrimitive');
    },
  };
  const rejections = [
    failure,
    'primitive failure',
    0,
    null,
    undefined,
    hostileString,
    hostilePrimitive,
  ];
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
  check(aggregate.message === 'One or more mapper operations failed' && coercions === 0);
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

void main().then(() => console.log('consumer completed'));

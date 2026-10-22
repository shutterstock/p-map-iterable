import { Mapper, IterableMapper, IterableMapperOptions } from './iterable-mapper';
import { BlockingQueue, BlockingQueueOptions } from './blocking-queue';
import { IterableQueue, IterableQueueOptions } from './iterable-queue';
import { IterableQueueMapper, IterableQueueMapperOptions } from './iterable-queue-mapper';
import {
  IterableQueueMapperSimple,
  IterableQueueMapperSimpleOptions,
} from './iterable-queue-mapper-simple';
import { Queue } from './queue';

export { TaskQueue, QueueFullError, QueueClosedError, TaskCancelledError } from './task-queue';
export type {
  Task,
  TaskOutcome,
  TaskHandle,
  TaskQueueOptions,
  TaskOptions,
  TaskQueueCloseOptions,
} from './task-queue';

export {
  IterableMapper,
  IterableMapper as ConcurrentMapper,
  IterableQueueMapper,
  IterableQueueMapper as MappingQueue,
  IterableQueueMapperSimple,
  IterableQueueMapperSimple as WorkerQueue,
  BlockingQueue,
  IterableQueue,
  Queue,
};

export type {
  Mapper,
  IterableMapperOptions,
  IterableMapperOptions as ConcurrentMapperOptions,
  IterableQueueMapperOptions,
  IterableQueueMapperOptions as MappingQueueOptions,
  IterableQueueMapperSimpleOptions,
  IterableQueueMapperSimpleOptions as WorkerQueueOptions,
  BlockingQueueOptions,
  IterableQueueOptions,
};

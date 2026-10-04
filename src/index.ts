import { Mapper, IterableMapper, IterableMapperOptions } from './iterable-mapper';
import { BlockingQueue, BlockingQueueOptions } from './blocking-queue';
import { IterableQueue, IterableQueueOptions } from './iterable-queue';
import { IterableQueueMapper, IterableQueueMapperOptions } from './iterable-queue-mapper';
import {
  IterableQueueMapperSimple,
  IterableQueueMapperSimpleOptions,
} from './iterable-queue-mapper-simple';
import { Queue } from './queue';

export {
  IterableMapper,
  IterableMapper as Prefetcher,
  IterableQueueMapper,
  IterableQueueMapper as BackgroundFlusher,
  IterableQueueMapperSimple,
  IterableQueueMapperSimple as SimpleBackgroundFlusher,
  BlockingQueue,
  IterableQueue,
  Queue,
};

export type {
  Mapper,
  IterableMapperOptions,
  IterableMapperOptions as PrefetcherOptions,
  IterableQueueMapperOptions,
  IterableQueueMapperOptions as BackgroundFlusherOptions,
  IterableQueueMapperSimpleOptions,
  IterableQueueMapperSimpleOptions as SimpleBackgroundFlusherOptions,
  BlockingQueueOptions,
  IterableQueueOptions,
};

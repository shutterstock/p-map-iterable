import { Mapper, IterableMapper, IterableMapperOptions } from './iterable-mapper';
import { BlockingQueue, BlockingQueueOptions } from './blocking-queue';
import { IterableQueue, IterableQueueOptions } from './iterable-queue';
import { IterableQueueMapper, IterableQueueMapperOptions } from './iterable-queue-mapper';
import {
  IterableQueueMapperSimple,
  IterableQueueMapperSimpleOptions,
} from './iterable-queue-mapper-simple';
import { Queue } from './queue';

// Create class aliases with more descriptive names
/**
 * Prefetcher - Processes items from an iterable source in the background before they're needed.
 * This is an alias for IterableMapper.
 */
export const Prefetcher = IterableMapper;
export type PrefetcherOptions = IterableMapperOptions;

/**
 * BackgroundFlusher - Processes items in the background with results accessible via iteration.
 * This is an alias for IterableQueueMapper.
 */
export const BackgroundFlusher = IterableQueueMapper;
export type BackgroundFlusherOptions = IterableQueueMapperOptions;

/**
 * SimpleBackgroundFlusher - Processes items in the background, automatically discarding results.
 * This is an alias for IterableQueueMapperSimple.
 */
export const SimpleBackgroundFlusher = IterableQueueMapperSimple;
export type SimpleBackgroundFlusherOptions = IterableQueueMapperSimpleOptions;

// Export all types and classes
export {
  Mapper,
  IterableMapper,
  IterableMapperOptions,
  IterableQueueMapper,
  IterableQueueMapperOptions,
  IterableQueueMapperSimple,
  IterableQueueMapperSimpleOptions,
  BlockingQueue,
  BlockingQueueOptions,
  IterableQueue,
  IterableQueueOptions,
  Queue,
};

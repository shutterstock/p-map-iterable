// Keep one set of constructors when a process uses both module loaders.
// Explicit ESM exports avoid relying on Node's synthetic CJS named exports.
import api from './index.js';

export const IterableMapper = api.IterableMapper;
export type IterableMapper<Element, NewElement> = api.IterableMapper<Element, NewElement>;
export const IterableQueueMapper = api.IterableQueueMapper;
export type IterableQueueMapper<Element, NewElement> = api.IterableQueueMapper<Element, NewElement>;
export const IterableQueueMapperSimple = api.IterableQueueMapperSimple;
export type IterableQueueMapperSimple<Element> = api.IterableQueueMapperSimple<Element>;
export const BlockingQueue = api.BlockingQueue;
export type BlockingQueue<Element> = api.BlockingQueue<Element>;
export const IterableQueue = api.IterableQueue;
export type IterableQueue<Element> = api.IterableQueue<Element>;
export const Queue = api.Queue;
export type Queue<Element> = api.Queue<Element>;

export type {
  Mapper,
  IterableMapperOptions,
  IterableQueueMapperOptions,
  BlockingQueueOptions,
  IterableQueueOptions,
} from './index.js';

export default api;

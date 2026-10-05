// Keep one set of constructors when a process uses both module loaders.
// Explicit ESM exports avoid relying on Node's synthetic CJS named exports.
import api from './index.js';

export const IterableMapper = api.IterableMapper;
export type IterableMapper<Element, NewElement> = api.IterableMapper<Element, NewElement>;
export const ConcurrentMapper = api.ConcurrentMapper;
export type ConcurrentMapper<Element, NewElement> = api.ConcurrentMapper<Element, NewElement>;
export const IterableQueueMapper = api.IterableQueueMapper;
export type IterableQueueMapper<Element, NewElement> = api.IterableQueueMapper<Element, NewElement>;
export const MappingQueue = api.MappingQueue;
export type MappingQueue<Element, NewElement> = api.MappingQueue<Element, NewElement>;
export const IterableQueueMapperSimple = api.IterableQueueMapperSimple;
export type IterableQueueMapperSimple<Element> = api.IterableQueueMapperSimple<Element>;
export const WorkerQueue = api.WorkerQueue;
export type WorkerQueue<Element> = api.WorkerQueue<Element>;
export const BlockingQueue = api.BlockingQueue;
export type BlockingQueue<Element> = api.BlockingQueue<Element>;
export const IterableQueue = api.IterableQueue;
export type IterableQueue<Element> = api.IterableQueue<Element>;
export const Queue = api.Queue;
export type Queue<Element> = api.Queue<Element>;
export const TaskQueue = api.TaskQueue;
export type TaskQueue = api.TaskQueue;
export const QueueFullError = api.QueueFullError;
export type QueueFullError = api.QueueFullError;
export const QueueClosedError = api.QueueClosedError;
export type QueueClosedError = api.QueueClosedError;
export const TaskCancelledError = api.TaskCancelledError;
export type TaskCancelledError = api.TaskCancelledError;

export type {
  Mapper,
  IterableMapperOptions,
  ConcurrentMapperOptions,
  IterableQueueMapperOptions,
  MappingQueueOptions,
  BlockingQueueOptions,
  IterableQueueOptions,
  IterableQueueMapperSimpleOptions,
  WorkerQueueOptions,
  Task,
  TaskOutcome,
  TaskHandle,
  TaskQueueOptions,
  TaskOptions,
  TaskQueueCloseOptions,
} from './index.js';

export default api;

[![npm (scoped)](https://img.shields.io/npm/v/%40shutterstock/p-map-iterable)](https://www.npmjs.com/package/@shutterstock/p-map-iterable) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT) [![API Docs](https://img.shields.io/badge/API%20Docs-View%20Here-blue)](https://tech.shutterstock.com/p-map-iterable/) [![Build - CI](https://github.com/shutterstock/p-map-iterable/actions/workflows/ci.yml/badge.svg)](https://github.com/shutterstock/p-map-iterable/actions/workflows/ci.yml) [![Package and Publish](https://github.com/shutterstock/p-map-iterable/actions/workflows/publish.yml/badge.svg)](https://github.com/shutterstock/p-map-iterable/actions/workflows/publish.yml) [![Publish Docs](https://github.com/shutterstock/p-map-iterable/actions/workflows/docs.yml/badge.svg)](https://github.com/shutterstock/p-map-iterable/actions/workflows/docs.yml)

# Overview

`@shutterstock/p-map-iterable` provides several classes that allow processing results of `p-map`-style mapper functions by iterating the results as they are completed, with backpressure to limit the number of items that are processed ahead of the consumer.

Use these classes for concurrent metadata lookups, capability probes, background status checks, or read/write pipelines. The [optional aliases](#optional-names-for-concurrent-work) `ConcurrentMapper`, `MappingQueue`, and `WorkerQueue` describe the input and result contracts without tying the work to a particular I/O operation.

A common use case for `@shutterstock/p-map-iterable` is as a "prefetcher" that will fetch, for example, AWS S3 files in an AWS Lambda function. By prefetching large files the consumer is able to use 100% of the paid-for Lambda CPU time for the JS thread, rather than waiting idle while the next file is fetched. The backpressure (set by `maxUnread`) prevents the prefetcher from consuming unlimited memory or disk space by racing ahead of the consumer.

The caller supplies the operation to run for each input. Concurrency overlaps asynchronous work in the current JavaScript process; synchronous CPU work still uses the JavaScript event loop.

# Example Usage Scenarios

## Typical Processing Loop without `IterableMapper`

```typescript
const source = new SomeSource();
const sourceIds = [1, 2,... 1000];
const sink = new SomeSink();
for (const sourceId of sourceIds) {
  const item = await source.read(sourceId);     // takes 300 ms of I/O wait, no CPU
  const outputItem = doSomeOperation(item);     // takes 20 ms of CPU
  await sink.write(outputItem);                 // takes 500 ms of I/O wait, no CPU
}
```

Each iteration takes 820ms total, but we waste time waiting for I/O. We could prefetch the next read (300ms) while processing (20ms) and writing (500ms), without changing the order of reads or writes.

## Prefetching with `IterableMapper` and Blocking Sequential Writes

`concurrency: 1` on the prefetcher preserves the order of the reads, and writes remain sequential and blocking.

```typescript
const source = new SomeSource();
const sourceIds = [1, 2,... 1000];
// Prefetches serially within maxUnread and releases results in sequential order
const sourcePrefetcher = new IterableMapper(sourceIds,
  async (sourceId) => source.read(sourceId),
  { concurrency: 1, maxUnread: 10 }
);
const sink = new SomeSink();
for await (const item of sourcePrefetcher) {    // may not block for fast sources
  const outputItem = doSomeOperation(item);     // takes 20 ms of CPU
  await sink.write(outputItem);                 // takes 500 ms of I/O wait, no CPU
}
```

This reduces iteration time to 520ms by overlapping reads with processing/writing.

## Prefetching with `IterableMapper` and Background Sequential Writes with `IterableQueueMapperSimple`

`concurrency: 1` on the prefetcher preserves the order of the reads.
`concurrency: 1` on the flusher preserves the order of the writes, but allows the loop to iterate while last write is completing.

```typescript
const source = new SomeSource();
const sourceIds = [1, 2,... 1000];
const sourcePrefetcher = new IterableMapper(sourceIds,
  async (sourceId) => source.read(sourceId),
  { concurrency: 1, maxUnread: 10 }
);
const sink = new SomeSink();
const flusher = new IterableQueueMapperSimple(
  async (outputItem) => sink.write(outputItem),
  { concurrency: 1 }
);
for await (const item of sourcePrefetcher) {    // may not block for fast sources
  const outputItem = doSomeOperation(item);     // takes 20 ms of CPU
  await flusher.enqueue(outputItem);            // will periodically block for portion of write time
}
// Close input permanently after the last enqueue and wait for all writes
await flusher.onIdle();
// Check for errors
if (flusher.errors.length > 0) {
// ...
}
```

This reduces iteration time to about `max((max(readTime, writeTime) - cpuOpTime, cpuOpTime))`
by overlapping reads and writes with the CPU processing step.
In this contrived example, the loop time is reduced to 500ms - 20ms = 480ms.
In cases where the CPU usage time is higher, the impact can be greater.

## Prefetching with `IterableMapper` and Out of Order Background Writes with `IterableQueueMapperSimple`

For maximum throughput, allow out of order reads and writes with
`IterableQueueMapper` (to iterate results with backpressure when too many unread items) or
`IterableQueueMapperSimple` (to handle errors at end without custom iteration and applying backpressure to block further enqueues when `concurrency` items are in process):

```typescript
const source = new SomeSource();
const sourceIds = [1, 2,... 1000];
const sourcePrefetcher = new IterableMapper(sourceIds,
  async (sourceId) => source.read(sourceId),
  { concurrency: 10, maxUnread: 20 }
);
const sink = new SomeSink();
const flusher = new IterableQueueMapperSimple(
  async (outputItem) => sink.write(outputItem),
  { concurrency: 10 }
);
for await (const item of sourcePrefetcher) {    // typically will not block
  const outputItem = doSomeOperation(item);     // takes 20 ms of CPU
  await flusher.enqueue(outputItem);            // typically will not block
}
// Close input permanently after the last enqueue and wait for all writes
await flusher.onIdle();
// Check for errors
if (flusher.errors.length > 0) {
 // ...
}
```

This reduces iteration time to about 20ms by overlapping reads and writes with the CPU processing step. In this contrived (but common) example we would get a 41x improvement in throughput, removing 97.5% of the time to process each item and fully utilizing the CPU time available in the JS event loop.

# Getting Started

## Installation

The package is available on npm as [@shutterstock/p-map-iterable](https://www.npmjs.com/package/@shutterstock/p-map-iterable)

`npm i @shutterstock/p-map-iterable`

## Importing

```typescript
import {
  IterableMapper,
  IterableQueueMapper,
  IterableQueueMapperSimple } from '@shutterstock/p-map-iterable';
```

## API Documentation

After installing the package, you might want to look at our [API Documentation](https://tech.shutterstock.com/p-map-iterable/) to learn about all the features available.

# `p-map-iterable` vs `p-map` vs `p-queue`

These diagrams illustrate the differences in operation betweeen `p-map`, `p-queue`, and `p-map-iterable`.

## `p-map-iterable`

![p-map-iterable operations overview](https://github.com/shutterstock/p-map-iterable/assets/5617868/abdc7079-8c12-4518-8135-867fc5085e60)

## `p-map`

![p-map operations overview](https://github.com/shutterstock/p-map-iterable/assets/5617868/2fd88213-3135-4de8-8ec2-224555c08d65)

## `p-queue`

![p-queue operations overview](https://github.com/shutterstock/p-map-iterable/assets/5617868/88300edb-7bfe-41f0-ae5b-1cd5723bc255)

# Features

- [IterableMapper](https://tech.shutterstock.com/p-map-iterable/classes/IterableMapper.html)
  - Also exported as `ConcurrentMapper`
  - Interface and concept based on: [p-map](https://github.com/sindresorhus/p-map)
  - Allows a sync or async iterable input
  - User supplied sync or async mapper function
  - Exposes an async iterable interface for consuming mapped items
  - Allows a maximum queue depth of mapped items - if the consumer stops consuming, the queue will fill up, at which point the mapper will stop being invoked until an item is consumed from the queue
  - This allows mapping with backpressure so that the mapper does not consume unlimited resources (e.g. memory, disk, network, event loop time) by racing ahead of the consumer
- [IterableQueueMapper](https://tech.shutterstock.com/p-map-iterable/classes/IterableQueueMapper.html)
  - Also exported as `MappingQueue`
  - Wraps `IterableMapper`
  - Adds items to the queue via the `enqueue` method
- [IterableQueueMapperSimple](https://tech.shutterstock.com/p-map-iterable/classes/IterableQueueMapperSimple.html)
  - Also exported as `WorkerQueue`
  - Wraps `IterableQueueMapper`
  - Discards results as they become available
  - Exposes any accumulated errors through the `errors` property instead of throwing an `AggregateError`
  - Consumes results internally and exposes no result iterator

## Lower Level Utilities
- [IterableQueue](https://tech.shutterstock.com/p-map-iterable/classes/IterableQueue.html)
  - Lower level utility class
  - Wraps `BlockingQueue`
  - Exposes an async iterable interface for consuming items in the queue
- [BlockingQueue](https://tech.shutterstock.com/p-map-iterable/classes/BlockingQueue.html)
  - Lower level utility class
  - `dequeue` blocks until an item is available or until all items have been removed, then returns `undefined`
  - `enqueue` blocks if the queue is full
  - `done` signals that no more items will be added to the queue

# `IterableMapper`

See [p-map](https://github.com/sindresorhus/p-map) docs for a good start in understanding what this does.

The key difference between `IterableMapper` and `pMap` are that `IterableMapper` does not return when the entire mapping is done, rather it exposes an iterable that the caller loops through. This enables results to be processed while the mapping is still happening, while optionally allowing for backpressure to slow or stop the mapping if the caller is not consuming items fast enough. Common use cases include `prefetching` items from a remote service - the next set of requests are dispatched asyncronously while the current responses are processed and the prefetch requests will pause when the unread queue fills up.

`ConcurrentMapper` is an alias for this class. It also fits general mapping work such as enriching project metadata or probing a list of services. Consume results with `for await`; with `concurrency` greater than one, results can arrive out of input order.

See [examples/iterable-mapper.ts](./examples/iterable-mapper.ts) for an example.

Run the example with `npm run example:iterable-mapper`

# `IterableQueueMapper`

`IterableQueueMapper` is similar to `IterableMapper` but instead of taking an iterable input it instead adds data via the `enqueue` method which will block if `maxUnread` will be reached by the current number of `mapper`'s running in parallel.

`MappingQueue` is an alias for this class. Produce inputs and consume mapped results concurrently so the result buffer can drain. After the last awaited enqueue, call `done()` and finish consuming the iterator; `done()` closes input and does not wait for work to complete.

See [examples/iterable-queue-mapper.ts](./examples/iterable-queue-mapper.ts) for an example.

Run the example with `npm run example:iterable-queue-mapper`

# `IterableQueueMapperSimple`

`IterableQueueMapperSimple` is similar to `IterableQueueMapper` but instead exposing the results as an iterable it discards the results as soon as they are ready and exposes any errors through the `errors` property.

`WorkerQueue` is an alias for this class. Supply one worker callback to process every enqueued input, such as a background Git status check. Await each enqueue for producer backpressure. After the last enqueue, await `onIdle()` to permanently close input and finish the accepted work, then inspect `errors`. An enqueue resolves when the input is accepted, rather than when its work completes.

See [examples/iterable-queue-mapper-simple.ts](./examples/iterable-queue-mapper-simple.ts) for an example.

Run the example with `npm run example:iterable-queue-mapper-simple`

## Optional names for concurrent work

The package exports three optional class aliases. Choose the name that makes the input and result contracts clearest in your application:

| Alias | Original class | Input | Results and completion |
| --- | --- | --- | --- |
| `ConcurrentMapper` | `IterableMapper` | Sync or async iterable | Consume mapped results with `for await`. Mapping pauses when the unread result buffer fills. |
| `MappingQueue` | `IterableQueueMapper` | Awaited `enqueue(item)` calls | Consume results concurrently with production. Call `done()` after the last enqueue, then finish consuming the iterator. |
| `WorkerQueue` | `IterableQueueMapperSimple` | Awaited `enqueue(item)` calls | Results are consumed internally. After the last enqueue, await `onIdle()` and check `errors`. |

```typescript
import {
  ConcurrentMapper,
  MappingQueue,
  WorkerQueue,
} from '@shutterstock/p-map-iterable';
```

The aliases are the original classes, with the same constructor identity, generic instance types, and subclassing behavior. Existing imports continue to work. Defaults, result ordering, backpressure, and error handling are identical through either name.

Matching option types are available from the package root using `import type`:

| Option alias | Original option type | Configuration |
| --- | --- | --- |
| `ConcurrentMapperOptions` | `IterableMapperOptions` | `concurrency`, `maxUnread`, `stopOnMapperError` |
| `MappingQueueOptions` | `IterableQueueMapperOptions` | `concurrency`, `maxUnread`, `stopOnMapperError` |
| `WorkerQueueOptions` | `IterableQueueMapperSimpleOptions` | `concurrency` |

`MappingQueue` must have a result consumer even when you do not need the results. Awaiting every enqueue before starting iteration can block once the result buffer fills. Use `WorkerQueue` when results can be discarded. Its `onIdle()` permanently ends input; subsequent enqueues reject. Worker failures are collected in `errors` while other inputs continue to run, so check that property after shutdown.

Each queue uses one fixed callback supplied at construction. Awaiting `enqueue()` provides producer backpressure and confirms acceptance of an input. Calling it without awaiting can accumulate pending inputs. For ongoing event-driven work, the application supplies any admission limits, cancellation, deduplication, or per-item completion handles. `WorkerQueue.onIdle()` is a final shutdown operation, so an application that needs reusable idle waits must manage that separately.

See [examples/semantic-aliases.ts](./examples/semantic-aliases.ts) for metadata enrichment, queued capability probes with a concurrent result consumer, and background status checks with collected errors. Run it with `npm run example:semantic-aliases`.

# Contributing - Setting up Build Environment

- `nvm use`
- `npm i`
- `npm run build`
- `npm run build:docs`
- `npm run lint`
- `npm run test`
- `npm run example:semantic-aliases`

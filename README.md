[![npm (scoped)](https://img.shields.io/npm/v/%40shutterstock/p-map-iterable)](https://www.npmjs.com/package/@shutterstock/p-map-iterable) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT) [![API Docs](https://img.shields.io/badge/API%20Docs-View%20Here-blue)](https://tech.shutterstock.com/p-map-iterable/) [![Build - CI](https://github.com/shutterstock/p-map-iterable/actions/workflows/ci.yml/badge.svg)](https://github.com/shutterstock/p-map-iterable/actions/workflows/ci.yml) [![Package and Publish](https://github.com/shutterstock/p-map-iterable/actions/workflows/publish.yml/badge.svg)](https://github.com/shutterstock/p-map-iterable/actions/workflows/publish.yml) [![Publish Docs](https://github.com/shutterstock/p-map-iterable/actions/workflows/docs.yml/badge.svg)](https://github.com/shutterstock/p-map-iterable/actions/workflows/docs.yml)

# Overview

`@shutterstock/p-map-iterable` provides several classes that allow processing results of `p-map`-style mapper functions by iterating the results as they are completed, with backpressure to limit the number of items that are processed ahead of the consumer.

A common use case for `@shutterstock/p-map-iterable` is as a "prefetcher" that will fetch, for example, AWS S3 files in an AWS Lambda function. By prefetching large files the consumer is able to use 100% of the paid-for Lambda CPU time for the JS thread, rather than waiting idle while the next file is fetched. The backpressure (set by `maxUnread`) prevents the prefetcher from consuming unlimited memory or disk space by racing ahead of the consumer.

These classes will typically be helpful in batch or queue consumers, not as much in request/response services.

# Example Usage Scenarios

Consider a typical processing loop without IterableMapper:

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

Using IterableMapper as a prefetcher:

```typescript
const source = new SomeSource();
const sourceIds = [1, 2,... 1000];
// Pre-reads up to 8 items serially and releases in sequential order
const sourcePrefetcher = new IterableMapper(sourceIds,
  async (sourceId) => source.read(sourceId),
  { concurrency: 1 }
);
const sink = new SomeSink();
for await (const item of sourcePrefetcher) {
  const outputItem = doSomeOperation(item);     // takes 20 ms of CPU
  await sink.write(outputItem);                 // takes 500 ms of I/O wait, no CPU
}
```

This reduces iteration time to 520ms by overlapping reads with processing/writing.

For maximum throughput, make the writes concurrent with IterableQueueMapper (to iterate results with backpressure when too many unread items) or IterableQueueMapperSimple (to handle errors at end without custom iteration or backpressure):

```typescript
const source = new SomeSource();
const sourceIds = [1, 2,... 1000];
const sourcePrefetcher = new IterableMapper(sourceIds,
  async (sourceId) => source.read(sourceId),
  { concurrency: 1 }
);
const sink = new SomeSink();
const flusher = new IterableQueueMapperSimple(
  async (outputItem) => sink.write(outputItem),
  { concurrency: 10 }
);
for await (const item of sourcePrefetcher) {
  const outputItem = doSomeOperation(item);     // takes 20 ms of CPU
  await flusher.enqueue(outputItem);           // usually takes no time
}
// Wait for all writes to complete
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
  - Interface and concept based on: [p-map](https://github.com/sindresorhus/p-map)
  - Allows a sync or async iterable input
  - User supplied sync or async mapper function
  - Exposes an async iterable interface for consuming mapped items
  - Allows a maximum queue depth of mapped items - if the consumer stops consuming, the queue will fill up, at which point the mapper will stop being invoked until an item is consumed from the queue
  - This allows mapping with backpressure so that the mapper does not consume unlimited resources (e.g. memory, disk, network, event loop time) by racing ahead of the consumer
- [IterableQueueMapper](https://tech.shutterstock.com/p-map-iterable/classes/IterableQueueMapper.html)
  - Wraps `IterableMapper`
  - Adds items to the queue via the `enqueue` method
- [IterableQueueMapperSimple](https://tech.shutterstock.com/p-map-iterable/classes/IterableQueueMapperSimple.html)
  - Wraps `IterableQueueMapper`
  - Discards results as they become available
  - Exposes any accumulated errors through the `errors` property instead of throwing an `AggregateError`
  - Not actually `Iterable` - May rename this before 1.0.0

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

See [examples/iterable-mapper.ts](./examples/iterable-mapper.ts) for an example.

Run the example with `npm run example:iterable-mapper`

# `IterableQueueMapper`

`IterableQueueMapper` is similar to `IterableMapper` but instead of taking an iterable input it instead adds data via the `enqueue` method which will block if `maxUnread` will be reached by the current number of `mapper`'s running in parallel.

See [examples/iterable-queue-mapper.ts](./examples/iterable-queue-mapper.ts) for an example.

Run the example with `npm run example:iterable-queue-mapper`

# `IterableQueueMapperSimple`

`IterableQueueMapperSimple` is similar to `IterableQueueMapper` but instead exposing the results as an iterable it discards the results as soon as they are ready and exposes any errors through the `errors` property.

See [examples/iterable-queue-mapper-simple.ts](./examples/iterable-queue-mapper-simple.ts) for an example.

Run the example with `npm run example:iterable-queue-mapper-simple`

# Contributing - Setting up Build Environment

- `nvm use`
- `npm i`
- `npm run build`
- `npm run lint`
- `npm run test`

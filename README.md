[![npm (scoped)](https://img.shields.io/npm/v/%40shutterstock/p-map-iterable)](https://www.npmjs.com/package/@shutterstock/p-map-iterable) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT) [![API Docs](https://img.shields.io/badge/API%20Docs-View%20Here-blue)](https://tech.shutterstock.com/p-map-iterable/) [![Build - CI](https://github.com/shutterstock/p-map-iterable/actions/workflows/ci.yml/badge.svg)](https://github.com/shutterstock/p-map-iterable/actions/workflows/ci.yml) [![Package and Publish](https://github.com/shutterstock/p-map-iterable/actions/workflows/publish.yml/badge.svg)](https://github.com/shutterstock/p-map-iterable/actions/workflows/publish.yml) [![Publish Docs](https://github.com/shutterstock/p-map-iterable/actions/workflows/docs.yml/badge.svg)](https://github.com/shutterstock/p-map-iterable/actions/workflows/docs.yml)

# Overview

`@shutterstock/p-map-iterable` provides several classes that allow processing results of `p-map`-style mapper functions by iterating the results as they are completed, with back pressure to limit the number of items that are processed ahead of the consumer.

A common use case for `@shutterstock/p-map-iterable` is as a "prefetcher" that will fetch, for example, AWS S3 files in an AWS Lambda function. By prefetching large files the consumer is able to use 100% of the paid-for Lambda CPU time for the JS thread, rather than waiting idle while the next file is fetched. The backpressure (set by `maxUnread`) prevents the prefetcher from consuming unlimited memory or disk space by racing ahead of the consumer.

These classes will typically be helpful in batch or queue consumers, not as much in request/response services.

# Example Usage Scenario

- AWS Lambda function for Kafka or Kinesis stream processing
- Each invocation has a batch of, say, 100 records
- Each record points to a file on S3 that needs to be parsed, processed, then written back to S3
- The average file size is 50 MB, so these will take a few seconds to fetch and write
- The Lambda function has 1,769 MB of RAM which gives it 1 vCPU, allowing the JS thread to run at roughly 100% speed of 1 core
- If the code never waits to fetch or write files then the Lambda function will be able to use 100% of the paid-for CPU time
- If there is no back pressure then reading 100 * 50 MB files would fill up the default Lambda temp disk space of 512 MB OR would consume 5 GB of memory, which would cause the Lambda function to fail
- We can use `IterableMapper` to fetch up to 5 of the next files while the current file is being processed, then pause until the current file is processed and the next file is consumed
- We can also use `IterableQueueMapper.enqueue()` to write the files back to S3 without waiting for them to finish, unless we get more than, say, 3-4 files being uploaded at once, at which point we can pause until the current file is uploaded before we allow queuing another file for upload
- In the rare case that 3-4 files are uploading, but not yet finished, we would block on `.enqueue()` and not consume much CPU while waiting for at least 1 upload to finish

# Getting Started

## Installation

The package is available on npm as [@shutterstock/p-map-iterable](https://www.npmjs.com/package/@shutterstock/p-map-iterable)

`npm i @shutterstock/p-map-iterable`

## Importing

```typescript
import { IterableMapper, IterableQueueMapper, IterableQueueMapperSimple } from '@shutterstock/p-map-iterable';
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
  - This allows mapping with back pressure so that the mapper does not consume unlimited resources (e.g. memory, disk, network, event loop time) by racing ahead of the consumer
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

The key difference between `IterableMapper` and `pMap` are that `IterableMapper` does not return when the entire mapping is done, rather it exposes an iterable that the caller loops through. This enables results to be processed while the mapping is still happening, while optionally allowing for back pressure to slow or stop the mapping if the caller is not consuming items fast enough. Common use cases include `prefetching` items from a remote service - the next set of requests are dispatched asyncronously while the current responses are processed and the prefetch requests will pause when the unread queue fills up.

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

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

# Overview

Async iterable that maps an async iterable input with backpressure.

A common use case for `pMapIterable` is as a "prefetcher" that will fetch, for example, DB or remote REST responses. By prefetching items the consumer is able to use 100% of the JS thread time for processing prefetched items instead of waiting for an item to arrive after each item is processed. This use case is most common in batch or queue consumers, not as much in request/response services.

# Installation

`npm i @shutterstock/p-map-iterable`

# Features

- `IterableMapper`
  - Interface and concept based on: [p-map](https://github.com/sindresorhus/p-map)
  - Allows a sync or async iterable input
  - User supplied sync or async mapper function
  - Exposes an async iterable interface for consuming mapped items
  - Allows a maximum queue depth of mapped items - if the consumer stops consuming, the queue will fill up, at which point the mapper will stop being invoked until an item is consumed from the queue
  - This allows mapping with back pressure so that the mapper does not consume unlimited resources (e.g. memory, disk, network, event loop time) by racing ahead of the consumer
- `IterableMapperSimple`
  - Wraps `IterableMapper`
  - Discards results as they become available
  - Exposes any accumulated errors through the `errors` property instead of throwing an `AggregateError`
  - Retains the backpressure functionality of `IterableMapper`'s `enqueue` in that addtional items cannot be added if the max number of items are already queued and their mappers have not yet completed, but does not require that the results be read by the caller before the next item can be mapped since the results are discarded immediately after they are available

# `IterableMapper`

See [p-map](https://github.com/sindresorhus/p-map) docs for a good start in understanding what this does.

The key difference between `IterableMapper` and `pMap` are that `IterableMapper` does not return when the entire mapping is done, rather it exposes an iterable that the caller loops through. This enables results to be processed while the mapping is still happening, while optionally allowing for back pressure to slow or stop the mapping if the caller is not consuming items fast enough. Common use cases include `prefetching` items from a remote service - the next set of requests are dispatched asyncronously while the current responses are processed and the prefetch requests will pause when the unread queue fills up.

```typescript
import { IterableMapper } from '@shutterstock/p-map-iterable';
import { promisify } from 'util';
const sleep = promisify(setTimeout);

class SleepIterator implements AsyncIterable<number> {
  private _max: number;
  private _current = 1;

  constructor(max: number) {
    this._max = max;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<number> {
    for (let i = 0; i < this._max; i++) {
      await sleep(1 * (i % 10));

      if (this._current <= this._max) {
        yield this._current;
      }

      this._current++;
    }
  }
}

const max = 100;
const iterator = new SleepIterator(max);
let total = 0;
let callCount = 0;

// Create an item prefetcher with IterableMapper
// Use `npm i it-batch`'s `batch` function to batch the source iterable
// into batches of a specific size, such as 50, if making batch requests
// to a remote service.
const prefetcher = new IterableMapper(
  // Batch example:
  //   batch(iterator, 50),
  iterator,
  // Batch example:
  //   async (values: number[]): Promise<number> => {
  async (value: number): Promise<number> => {
    callCount++;
    total += value;

    // Simulate fetching an async item with varied delays
    await sleep(10 * (callCount % 6));

    return total;
  },
  { concurrency: 2, maxUnread: 10 },
);

let lastTotal = 0;
let loopCount = 0;

// Loop through the prefetched items or batches
// Will pause and wait for prefetch to complete if none available
// Will immediately start processing if prefetched item or batch is already available
// If the `maxUnread` count was hit then no prefetches will be in progress until an item
// is returned from the iterable here.  Once an item is returned a mapper
// will be started; this will repeat until `concurrency` mappers are running again.
for await (const item of prefetcher) {
  loopCount++;
  if (item > lastTotal) {
    lastTotal = item;
  }
}
```

# Contributing - Setting up Build Environment

- `nvm use`
- `npm i`
- `npm run build`
- `npm run lint`
- `npm run test`

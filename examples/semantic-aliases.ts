/* eslint-disable no-console */
import {
  Prefetcher,
  BackgroundFlusher,
  SimpleBackgroundFlusher,
} from '@shutterstock/p-map-iterable';

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function prefetcherExample(): Promise<void> {
  const prefetcher = new Prefetcher(
    [1, 2, 3, 4, 5],
    async (id) => {
      await delay(10); // Fetch from a source, such as a database or file store.
      return { id, data: `Data for ${id}` };
    },
    { concurrency: 2, maxUnread: 3 },
  );

  for await (const item of prefetcher) {
    console.log(`Read ${item.id}: ${item.data}`);
    await delay(5); // Process each item while future reads run in the background.
  }
}

async function backgroundFlusherExample(): Promise<void> {
  const flusher = new BackgroundFlusher(
    async (id: number) => {
      await delay(10); // Write to a sink and return its acknowledgement.
      return { id, status: 'written' };
    },
    { concurrency: 2, maxUnread: 3 },
  );

  // Produce more items than maxUnread. A concurrent consumer is required to
  // release backpressure; waiting for all enqueues before iterating would block.
  const producer = (async () => {
    for (let id = 1; id <= 20; id++) {
      await flusher.enqueue(id);
    }
    flusher.done();
  })();

  const consumer = (async () => {
    for await (const result of flusher) {
      console.log(`Write ${result.id}: ${result.status}`);
    }
  })();

  await Promise.all([producer, consumer]);
}

async function simpleBackgroundFlusherExample(): Promise<void> {
  const flusher = new SimpleBackgroundFlusher(
    async (id: number) => {
      await delay(10);
      if (id === 3) throw new Error('Simulated write failure');
      console.log(`Write ${id}: complete`);
    },
    { concurrency: 2 },
  );

  for (let id = 1; id <= 5; id++) {
    await flusher.enqueue(id);
  }

  // onIdle() closes input permanently and waits for the accepted writes.
  // Mapper failures are collected in errors instead of rejecting onIdle().
  await flusher.onIdle();
  for (const { item, error } of flusher.errors) {
    console.log(`Write ${item}: failed`, error);
  }
}

async function main(): Promise<void> {
  await prefetcherExample();
  await backgroundFlusherExample();
  await simpleBackgroundFlusherExample();
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

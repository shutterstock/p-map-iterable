/* eslint-disable no-console */
import { ConcurrentMapper, MappingQueue, WorkerQueue } from '@shutterstock/p-map-iterable';

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function concurrentMapperExample(): Promise<void> {
  const mapper = new ConcurrentMapper(
    [1, 2, 3, 4, 5],
    async (id) => {
      await delay(10); // Enrich each input with metadata from another service.
      return { id, label: `Project ${id}` };
    },
    { concurrency: 2, maxUnread: 3 },
  );

  for await (const item of mapper) {
    console.log(`Metadata ${item.id}: ${item.label}`);
    await delay(5); // Process a result while other mapper calls run concurrently.
  }
}

async function mappingQueueExample(): Promise<void> {
  const queue = new MappingQueue(
    async (id: number) => {
      await delay(10); // Probe a worker and return its capabilities.
      return { id, available: true };
    },
    { concurrency: 2, maxUnread: 3 },
  );

  // Produce more items than maxUnread. A concurrent consumer is required to
  // release backpressure; waiting for all enqueues before iterating would block.
  const producer = (async () => {
    for (let id = 1; id <= 20; id++) {
      await queue.enqueue(id);
    }
    queue.done();
  })();

  const consumer = (async () => {
    for await (const result of queue) {
      console.log(`Worker ${result.id}: available=${result.available}`);
    }
  })();

  await Promise.all([producer, consumer]);
}

async function workerQueueExample(): Promise<void> {
  const queue = new WorkerQueue(
    async (id: number) => {
      await delay(10); // Run a background status check with no returned result.
      if (id === 3) throw new Error('Simulated task failure');
      console.log(`Status check ${id}: complete`);
    },
    { concurrency: 2 },
  );

  for (let id = 1; id <= 5; id++) {
    await queue.enqueue(id);
  }

  // onIdle() closes input permanently and waits for the accepted work.
  // Mapper failures are collected in errors instead of rejecting onIdle().
  await queue.onIdle();
  for (const { item, error } of queue.errors) {
    console.log(`Status check ${item}: failed`, error);
  }
}

async function main(): Promise<void> {
  await concurrentMapperExample();
  await mappingQueueExample();
  await workerQueueExample();
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

/* eslint-disable no-console */
import { IterableQueueMapperSimple } from '@shutterstock/p-map-iterable';
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

async function main() {
  const max = 12;
  const iterator = new SleepIterator(max);
  let total = 0;
  let callCount = 0;

  // Create an item processor with IterableQueueMapperSimple
  const prefetcher = new IterableQueueMapperSimple(
    // mapper function
    async (value: number): Promise<void> => {
      const myCallCount = callCount++;
      total += value;

      console.log(`Mapper Call Start ${myCallCount}, Value: ${value}, Total: ${total}`);

      // Simulate fetching an async item with varied delays
      // await sleep(10 * (callCount % 7));
      // Wait short random time
      await sleep(Math.random() * 10000);

      if (value % 5 === 0) {
        throw new Error(`Simulated error ${myCallCount}`);
      }

      console.log(`Mapper Call Done  ${myCallCount}, Value: ${value}, Total: ${total}`);
    },
    { concurrency: 3 },
  );

  // Add items to the queue in the background
  const jobAdder = (async () => {
    for await (const item of iterator) {
      console.log(`Enqueue Start ${item}`);
      await prefetcher.enqueue(item);
      console.log(`Enqueue Done  ${item}`);
    }
  })();

  // Wait for the job adder to finish adding the jobs
  // (it's throughput is constrained by the prefetcher's concurrency)
  await jobAdder;

  // Wait for the prefetcher to finish processing all items
  await prefetcher.onIdle();

  // Check for errors
  if (prefetcher.errors.length > 0) {
    console.error('Errors:');
    prefetcher.errors.forEach((error) =>
      console.error((error as Error).message ? (error as Error).message : error),
    );
  }

  console.log(`Total: ${total}`);
}

void main();

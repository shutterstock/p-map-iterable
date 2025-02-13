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
  const backgroundFlusher = new IterableQueueMapperSimple(
    // mapper function
    async (value: number): Promise<void> => {
      const myCallCount = callCount++;
      total += value;

      console.log(`Mapper Call Start ${myCallCount}, Value: ${value}, Total: ${total}`);

      // Simulate flushing an async item with varied delays
      await sleep(Math.random() * 10000);

      if (value % 5 === 0) {
        throw new Error(`Simulated error ${myCallCount}`);
      }

      console.log(`Mapper Call Done  ${myCallCount}, Value: ${value}, Total: ${total}`);
    },
    { concurrency: 3 },
  );

  // Add items to be flushed to the queue in the background
  // This will pause when the queue is full and resume when there is capacity
  const jobAdder = (async () => {
    for await (const item of iterator) {
      console.log(`Enqueue Start ${item}`);
      await backgroundFlusher.enqueue(item);
      console.log(`Enqueue Done  ${item}`);
    }
  })();

  // Wait for the job adder to finish adding the jobs
  // (it's throughput is constrained by the flushers's concurrency)
  await jobAdder;

  // Wait for the async flusher to finish flushing all items
  await backgroundFlusher.onIdle();

  // Check for errors
  if (backgroundFlusher.errors.length > 0) {
    console.error('Errors:');
    backgroundFlusher.errors.forEach(({ error, item }) =>
      console.error(
        `${item} had error: ${(error as Error).message ? (error as Error).message : error}`,
      ),
    );
  }

  console.log(`Total: ${total}`);
  console.log('Note - It is intended that there are errors in this example');
}

void main();

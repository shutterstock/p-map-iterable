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

  // Create an item processor with IterableQueueMapperSimple (also exported as WorkerQueue)
  const workers = new IterableQueueMapperSimple(
    // mapper function
    async (value: number): Promise<void> => {
      const myCallCount = callCount++;
      total += value;

      console.log(`Mapper Call Start ${myCallCount}, Value: ${value}, Total: ${total}`);

      // Simulate asynchronous background work with varied delays
      await sleep(Math.random() * 10000);

      if (value % 5 === 0) {
        throw new Error(`Simulated error ${myCallCount}`);
      }

      console.log(`Mapper Call Done  ${myCallCount}, Value: ${value}, Total: ${total}`);
    },
    { concurrency: 3 },
  );

  // Add inputs for the fixed worker callback
  // This will pause when the queue is full and resume when there is capacity
  const jobAdder = (async () => {
    for await (const item of iterator) {
      console.log(`Enqueue Start ${item}`);
      await workers.enqueue(item);
      console.log(`Enqueue Done  ${item}`);
    }
  })();

  // Wait for the job adder to finish adding the jobs
  // (its throughput is constrained by the worker concurrency)
  await jobAdder;

  // Close input permanently and wait for all accepted work
  await workers.onIdle();

  // Check for errors
  if (workers.errors.length > 0) {
    console.error('Errors:');
    workers.errors.forEach(({ error, item }) =>
      console.error(
        `${item} had error: ${(error as Error).message ? (error as Error).message : error}`,
      ),
    );
  }

  console.log(`Total: ${total}`);
  console.log('Note - It is intended that there are errors in this example');
}

void main();

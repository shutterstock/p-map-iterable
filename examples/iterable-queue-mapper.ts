/* eslint-disable no-console */
import { IterableQueueMapper } from '@shutterstock/p-map-iterable';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AggregateError = require('aggregate-error');
import { promisify } from 'util';
const sleep = promisify(setTimeout);

class SleepIterator implements AsyncIterable<{ fileName: string; fileSizeGB: number }> {
  private _max: number;
  private _current = 1;
  private _files: number[];

  constructor(max: number) {
    this._max = max;

    // Create a list of remote files to download
    // Each file has a random size between 10 and 100 GB
    this._files = Array.from({ length: 100 }, () => Math.floor(Math.random() * 90) + 10);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<{ fileName: string; fileSizeGB: number }> {
    for (let i = 0; i < this._max; i++) {
      const nextFile = this._files[i];
      if (nextFile === undefined) {
        break;
      }

      // Take some time to generate the next item
      await sleep(33 * (i % 10));

      if (this._current <= this._max) {
        yield { fileName: `${i.toString().padStart(5, '0')}.json`, fileSizeGB: nextFile };
      }

      this._current++;
    }
  }
}

async function main() {
  const max = 100;
  const iterator = new SleepIterator(max);
  let queuedButUnreadFileSizeGB = 0;
  let callCount = 0;

  // Create an item prefetcher with IterableQueueMapper
  const prefetcher = new IterableQueueMapper(
    async (value: {
      fileName: string;
      fileSizeGB: number;
    }): Promise<{ fileName: string; fileSizeGB: number; status: number }> => {
      const myCallCount = callCount++;

      console.log(
        `Mapper Call Start ${myCallCount}, FileName: ${value.fileName}, FileSizeGB: ${value.fileSizeGB}`,
      );

      // Simulate fetching an async files with varied delays
      // for example: fetching from AWS S3
      await sleep(Math.random() * 500);

      if (value.fileSizeGB % 5 === 0) {
        throw new Error(`Simulated error ${myCallCount}`);
      }

      console.log(
        `Mapper Call Done  ${myCallCount}, FileName: ${value.fileName}, FileSizeGB: ${value.fileSizeGB}`,
      );

      queuedButUnreadFileSizeGB += value.fileSizeGB;

      return { ...value, status: 200 };
    },
    { concurrency: 2, maxUnread: 10, stopOnMapperError: false },
  );

  let loopCount = 0;

  // Add items to the queue in the background
  const jobAdder = (async () => {
    for await (const item of iterator) {
      console.log(`Enqueue Start FileName: ${item.fileName}, FileSizeGB: ${item.fileSizeGB}`);
      await prefetcher.enqueue(item);
      console.log(`Enqueue Done  FileName: ${item.fileName}, FileSizeGB: ${item.fileSizeGB}`);
    }

    prefetcher.done();
  })();

  // Loop through the prefetched items or batches
  // Will pause and wait for prefetch to complete if none available
  // Will immediately start processing if prefetched item or batch is already available
  // If the `maxUnread` count was hit then no prefetches will be in progress until an item
  // is returned from the iterable here.  Once an item is returned a mapper
  // will be started; this will repeat until `concurrency` mappers are running again.
  try {
    for await (const item of prefetcher) {
      loopCount++;

      console.log(
        `Result Start ${loopCount.toString().padStart(3, '0')}, FileName: ${
          item.fileName
        }, FileSizeGB: ${item.fileSizeGB}, QueuedButUnreadFileSizeGB: ${queuedButUnreadFileSizeGB
          .toString()
          .padStart(3, '0')}`,
      );

      // Simulate taking some time to process this big file of stuff
      // This is where we're going to keep the JS thread busy
      await sleep(Math.random() * 500);

      queuedButUnreadFileSizeGB -= item.fileSizeGB;

      console.log(
        `Result Done  ${loopCount.toString().padStart(3, '0')}, FileName: ${
          item.fileName
        }, FileSizeGB: ${item.fileSizeGB}, QueuedButUnreadFileSizeGB: ${queuedButUnreadFileSizeGB
          .toString()
          .padStart(3, '0')}`,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (error instanceof AggregateError) {
      console.log('Error is AggregateError');
    }

    console.log('CAUGHT ERRORS AFTER LOOP Start');
    console.log(error.message);
    console.log('CAUGHT ERRORS AFTER LOOP Done');
  }

  // Wait for the job adder to finish adding the jobs
  // (it's throughput is constrained by the prefetcher's concurrency)
  await jobAdder;

  console.log(`QueuedButUnreadFileSizeGB: ${queuedButUnreadFileSizeGB}`);
  console.log('Note - It is intended that there are errors in this example');
}

void main();

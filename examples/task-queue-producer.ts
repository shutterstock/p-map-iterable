/* eslint-disable no-console -- Runnable CLI example. */
import { strict as assert } from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';
import { QueueFullError, Task, TaskHandle, TaskQueue } from '@shutterstock/p-map-iterable';

// onCapacity is a hint: another producer can take the slot before this continuation runs.
async function submitWhenReady<T>(queue: TaskQueue, task: Task<T>): Promise<TaskHandle<T>> {
  for (;;) {
    await queue.onCapacity();
    try {
      return queue.submit(task);
    } catch (error) {
      if (!(error instanceof QueueFullError)) throw error;
    }
  }
}

async function main(): Promise<void> {
  // Serial writes, plus three waiting writes. No unread result buffer is needed.
  const queue = new TaskQueue({ concurrency: 1, maxPending: 3 });
  const successful: number[] = [];
  let failures = 0;
  try {
    for (let id = 1; id <= 12; id++) {
      const handle = await submitWhenReady(queue, async (signal) => {
        await delay(2, undefined, { signal });
        if (id === 4) throw new Error('Example write failed');
        successful.push(id);
      });
      // Handle each outcome as it arrives instead of retaining all completion promises.
      void handle.result.then((outcome) => {
        if (outcome.status === 'rejected') failures++;
      });
      assert.ok(queue.running <= 1);
      assert.ok(queue.pending <= 3);
    }
  } finally {
    await queue.close();
  }
  assert.deepEqual(successful, [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(failures, 1);
  console.log('Producer: 12 admitted with backpressure, 11 ordered writes, 1 handled failure.');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

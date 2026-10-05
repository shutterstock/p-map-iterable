/* eslint-disable no-console -- Runnable CLI example. */
import { strict as assert } from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';
import {
  QueueFullError,
  TaskCancelledError,
  TaskHandle,
  TaskQueue,
} from '@shutterstock/p-map-iterable';

async function main(): Promise<void> {
  const queue = new TaskQueue({ concurrency: 2, maxPending: 2 });
  const handles: TaskHandle<string>[] = [];
  let dropped = 0;

  // An event emitter cannot await backpressure. Choose an explicit overload policy.
  function onRowVisible(id: number): void {
    try {
      const handle = queue.submit(async (signal) => {
        await delay(20, undefined, { signal });
        return `row ${id}`;
      });
      handles.push(handle);
    } catch (error) {
      if (!(error instanceof QueueFullError)) throw error;
      dropped++;
      // Drop this decoration; a later visibility event can retry from current UI state.
    }
  }

  for (let id = 1; id <= 6; id++) onRowVisible(id);
  assert.equal(queue.running, 2);
  assert.equal(queue.pending, 2);
  assert.equal(dropped, 2);

  // The fourth row left the viewport before starting. Remove it immediately.
  assert.equal(handles[3].cancel('row left viewport'), true);
  // eslint-disable-next-line @typescript-eslint/promise-function-async -- Collect existing outcome promises.
  const outcomes = await Promise.all(handles.map((handle) => handle.result));
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 3);
  const cancelled = outcomes[3];
  assert.equal(cancelled.status, 'rejected');
  if (cancelled.status === 'rejected') assert.ok(cancelled.reason instanceof TaskCancelledError);

  await queue.onIdle();
  // Idle is reusable; add returns the value directly for a request/response handler.
  assert.equal(await queue.add(() => 'selected row refreshed'), 'selected row refreshed');
  await queue.close();
  assert.equal(queue.isClosed, true);
  console.log(
    'Event burst: 4 accepted, 2 dropped, 1 queued task cancelled; queue reused and closed.',
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

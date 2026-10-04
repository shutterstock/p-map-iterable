/* eslint-disable @typescript-eslint/promise-function-async -- Exercise lazy synchronous functions returning promises and thenables. */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  TaskQueue,
  QueueClosedError,
  QueueFullError,
  TaskCancelledError,
  TaskHandle,
} from './index';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('TaskQueue', () => {
  test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid concurrency %s',
    (concurrency) => {
      expect(() => new TaskQueue({ concurrency })).toThrow(TypeError);
    },
  );

  test.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid maxPending %s',
    (maxPending) => {
      expect(() => new TaskQueue({ maxPending })).toThrow(TypeError);
    },
  );

  it('validates lazy tasks without consuming capacity', async () => {
    const queue = new TaskQueue();
    expect(() => queue.submit(undefined as never)).toThrow(TypeError);
    await expect(queue.add(Promise.resolve(1) as never)).rejects.toThrow(TypeError);
    expect(queue.isIdle).toBe(true);
    await queue.close();
  });

  it('reserves concurrency synchronously but invokes tasks after submission', async () => {
    const queue = new TaskQueue({ concurrency: 2, maxPending: 1 });
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
    const started: number[] = [];
    const handles = gates.map((gate, index) =>
      queue.submit(() => {
        started.push(index);
        return gate.promise;
      }),
    );
    expect(started).toEqual([]);
    expect(queue.running).toBe(2);
    expect(queue.pending).toBe(1);
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    const completed: number[] = [];
    const observations = handles.map((handle, index) =>
      handle.result.then(() => {
        completed.push(index);
      }),
    );
    gates[1].resolve(20);
    await handles[1].result;
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    expect(queue.running).toBe(2);
    gates[2].resolve(30);
    await handles[2].result;
    gates[0].resolve(10);
    await Promise.all(observations);
    expect(completed).toEqual([1, 2, 0]);
    expect(await Promise.all(handles.map((handle) => handle.result))).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'fulfilled', value: 20 },
      { status: 'fulfilled', value: 30 },
    ]);
    await queue.close();
  });

  it('bounds simultaneous event submissions and never invokes rejected work', async () => {
    const queue = new TaskQueue({ concurrency: 2, maxPending: 3 });
    const gate = deferred<void>();
    const accepted: TaskHandle<void>[] = [];
    const rejected = jest.fn(() => undefined);
    for (let index = 0; index < 1000; index++) {
      if (index < 5) accepted.push(queue.submit(() => gate.promise));
      else expect(() => queue.submit(rejected)).toThrow(QueueFullError);
    }
    expect(queue.running).toBe(2);
    expect(queue.pending).toBe(3);
    gate.resolve();
    await queue.close();
    expect(rejected).not.toHaveBeenCalled();
    expect(await Promise.all(accepted.map((handle) => handle.result))).toHaveLength(5);
  });

  it('supports zero pending slots and rejects add admission through its promise', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 0 });
    const gate = deferred<number>();
    const first = queue.add(() => gate.promise);
    await expect(queue.add(() => 2)).rejects.toThrow(QueueFullError);
    expect(queue.pending).toBe(0);
    gate.resolve(1);
    await expect(first).resolves.toBe(1);
    await expect(queue.add(() => 3)).resolves.toBe(3);
    await queue.close();
  });

  it('delivers exact rejection reasons, thenables and valid undefined values', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    const reason = { message: 'original object' };
    const syncFailure = queue.submit(() => {
      throw reason;
    });
    const asyncFailure = queue.submit(() => Promise.reject(undefined));
    const noValue = queue.submit(() => undefined);
    const thenable = queue.submit(
      () =>
        ({
          then(resolve: (value: number) => void) {
            resolve(42);
          },
        }) as PromiseLike<number>,
    );
    await expect(syncFailure.result).resolves.toEqual({ status: 'rejected', reason });
    await expect(asyncFailure.result).resolves.toEqual({ status: 'rejected', reason: undefined });
    await expect(noValue.result).resolves.toEqual({ status: 'fulfilled', value: undefined });
    await expect(thenable.result).resolves.toEqual({ status: 'fulfilled', value: 42 });
    await expect(
      queue.add(() => {
        throw reason;
      }),
    ).rejects.toBe(reason);
    await expect(queue.add(() => Promise.reject(undefined))).rejects.toBeUndefined();
    await expect(queue.add(() => undefined)).resolves.toBeUndefined();
    await queue.close();
  });

  it('continues draining when event task failures are unobserved', async () => {
    const queue = new TaskQueue({ concurrency: 2 });
    queue.submit(() => {
      throw new Error('sync failure');
    });
    queue.submit(() => Promise.reject(new Error('async failure')));
    const last = queue.submit(() => 3);
    await queue.close();
    await expect(last.result).resolves.toEqual({ status: 'fulfilled', value: 3 });
    expect(queue.isIdle).toBe(true);
  });

  it('does not create unhandled rejections for ignored submissions in a strict Node process', () => {
    const child = spawnSync(
      process.execPath,
      [
        '--unhandled-rejections=strict',
        '-r',
        'ts-node/register',
        '-e',
        `
        const { TaskQueue } = require('./src/task-queue');
        const queue = new TaskQueue({ concurrency: 2 });
        queue.submit(() => { throw new Error('synchronous'); });
        queue.submit(() => Promise.reject(new Error('asynchronous')));
        const cancelled = queue.submit(() => Promise.reject('must not start'));
        cancelled.cancel();
        queue.close().then(() => console.log('drained'));
      `,
      ],
      { cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 10000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
    expect(child.stdout.trim()).toBe('drained');
  });

  it('can observe idle repeatedly and submit after each idle state', async () => {
    const queue = new TaskQueue();
    await queue.onIdle();
    expect(queue.isIdle).toBe(true);
    for (let index = 0; index < 3; index++) {
      queue.submit(() => index);
      expect(queue.isIdle).toBe(false);
      await Promise.all([queue.onIdle(), queue.onIdle()]);
      expect(queue.isIdle).toBe(true);
      expect(queue.isClosed).toBe(false);
    }
    await queue.close();
  });

  it('drain snapshots earlier tasks while idle also waits for later work', async () => {
    const queue = new TaskQueue({ concurrency: 2 });
    const earlier = deferred<void>();
    const later = deferred<void>();
    queue.submit(() => earlier.promise);
    const drained = queue.drain();
    queue.submit(() => later.promise);
    let idle = false;
    const idleWait = queue.onIdle().then(() => {
      idle = true;
    });
    earlier.resolve();
    await drained;
    expect(idle).toBe(false);
    expect(queue.running).toBe(1);
    later.resolve();
    await idleWait;
    await queue.close();
  });

  it('close rejects new admission immediately and waits for FIFO accepted work', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    const gate = deferred<void>();
    const first = queue.submit(() => gate.promise);
    const second = queue.submit(() => 2);
    let closed = false;
    const closing = queue.close();
    expect(queue.close()).toBe(closing);
    const observedClose = closing.then(() => {
      closed = true;
    });
    expect(queue.isClosed).toBe(true);
    expect(() => queue.submit(() => 3)).toThrow(QueueClosedError);
    await expect(queue.add(() => 3)).rejects.toThrow(QueueClosedError);
    expect(closed).toBe(false);
    gate.resolve();
    await observedClose;
    expect(queue.isIdle).toBe(true);
    await expect(first.result).resolves.toEqual({ status: 'fulfilled', value: undefined });
    await expect(second.result).resolves.toEqual({ status: 'fulfilled', value: 2 });
  });

  it('removes queued cancellation immediately, frees capacity and preserves FIFO', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 2 });
    const gate = deferred<void>();
    queue.submit(() => gate.promise);
    const skipped = jest.fn(() => 2);
    const cancelled = queue.submit(skipped);
    const order: number[] = [];
    const third = queue.submit(() => {
      order.push(3);
    });
    expect(cancelled.cancel('viewport changed')).toBe(true);
    expect(cancelled.cancel()).toBe(false);
    const outcome = await cancelled.result;
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toBeInstanceOf(TaskCancelledError);
      expect((outcome.reason as TaskCancelledError).reason).toBe('viewport changed');
    }
    expect(queue.pending).toBe(1);
    const fourth = queue.submit(() => {
      order.push(4);
    });
    gate.resolve();
    await queue.close();
    expect(skipped).not.toHaveBeenCalled();
    expect(order).toEqual([3, 4]);
    expect(third.cancel()).toBe(false);
    expect(fourth.cancel()).toBe(false);
  });

  it('does not accumulate cancelled tombstones under sustained event replacement', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 1 });
    const gate = deferred<void>();
    queue.submit(() => gate.promise);
    const skipped = jest.fn(() => undefined);
    for (let index = 0; index < 1000; index++) {
      const handle = queue.submit(skipped);
      expect(handle.cancel()).toBe(true);
      expect(queue.pending).toBe(0);
    }
    gate.resolve();
    await queue.close();
    expect(skipped).not.toHaveBeenCalled();
  });

  it('pre-aborted signals consume no capacity and queued abort removes its listener', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    const gate = deferred<void>();
    queue.submit(() => gate.promise);
    const before = new AbortController();
    before.abort('already gone');
    expect(() => queue.submit(() => 1, { signal: before.signal })).toThrow(TaskCancelledError);
    await expect(queue.add(() => 1, { signal: before.signal })).rejects.toThrow(TaskCancelledError);
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    const skipped = jest.fn(() => undefined);
    const handle = queue.submit(skipped, { signal: controller.signal });
    controller.abort('gone');
    await expect(handle.result).resolves.toMatchObject({
      status: 'rejected',
      reason: { reason: 'gone' },
    });
    expect(queue.pending).toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);
    gate.resolve();
    await queue.close();
    expect(skipped).not.toHaveBeenCalled();
  });

  it('signals running cancellation without releasing its slot or forcing its outcome', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 1 });
    const controller = new AbortController();
    const gate = deferred<number>();
    let runningSignal!: AbortSignal;
    const first = queue.submit(
      (signal) => {
        runningSignal = signal;
        return gate.promise;
      },
      { signal: controller.signal },
    );
    const next = jest.fn(() => 2);
    const second = queue.submit(next);
    await Promise.resolve();
    controller.abort('leave screen');
    expect(runningSignal.aborted).toBe(true);
    expect(runningSignal.reason).toBeInstanceOf(TaskCancelledError);
    expect(first.cancel()).toBe(false);
    expect(queue.running).toBe(1);
    expect(next).not.toHaveBeenCalled();
    gate.resolve(1); // This operation deliberately ignores abort and still succeeds.
    await expect(first.result).resolves.toEqual({ status: 'fulfilled', value: 1 });
    await queue.close();
    await expect(second.result).resolves.toEqual({ status: 'fulfilled', value: 2 });
  });

  it('cancellation before the first microtask prevents invoking reserved work', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    const skipped = jest.fn(() => 1);
    const handle = queue.submit(skipped);
    expect(handle.cancel()).toBe(true);
    await queue.close();
    await expect(handle.result).resolves.toMatchObject({
      status: 'rejected',
      reason: { name: 'TaskCancelledError' },
    });
    expect(skipped).not.toHaveBeenCalled();
  });

  it('close can cancel waiting tasks and abort running tasks, waiting for cleanup', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    const cleanup = deferred<void>();
    const first = queue.submit(async (signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      await cleanup.promise;
      throw signal.reason;
    });
    const skipped = jest.fn(() => 2);
    const second = queue.submit(skipped);
    const third = queue.submit(skipped);
    await Promise.resolve();
    const closing = queue.close({ cancelPending: true, abortRunning: true });
    expect(queue.close({ cancelPending: true, abortRunning: true })).toBe(closing);
    expect(queue.pending).toBe(0);
    expect(queue.running).toBe(1);
    await Promise.all([second.result, third.result]);
    expect(queue.isIdle).toBe(false);
    cleanup.resolve();
    await closing;
    expect(queue.isIdle).toBe(true);
    expect(skipped).not.toHaveBeenCalled();
    await expect(first.result).resolves.toMatchObject({
      status: 'rejected',
      reason: { name: 'TaskCancelledError' },
    });
  });

  it('allows graceful close to escalate to cancellation', async () => {
    const queue = new TaskQueue({ concurrency: 1 });
    const gate = deferred<void>();
    queue.submit(() => gate.promise);
    const skipped = jest.fn(() => 1);
    const handle = queue.submit(skipped);
    const closing = queue.close();
    expect(queue.close({ cancelPending: true })).toBe(closing);
    await expect(handle.result).resolves.toMatchObject({ status: 'rejected' });
    gate.resolve();
    await closing;
    expect(skipped).not.toHaveBeenCalled();
  });

  it('notifies all capacity waiters without reserving their admission', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 0 });
    const gate = deferred<void>();
    queue.submit(() => gate.promise);
    const waiters = [queue.onCapacity(), queue.onCapacity()];
    gate.resolve();
    await Promise.all(waiters);
    const next = deferred<void>();
    queue.submit(() => next.promise);
    expect(() => queue.submit(() => 1)).toThrow(QueueFullError);
    next.resolve();
    await queue.close();
  });

  it('releases capacity waiters when queued work is removed', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 1 });
    const gate = deferred<void>();
    queue.submit(() => gate.promise);
    const handle = queue.submit(() => 1);
    const capacity = queue.onCapacity();
    handle.cancel();
    await capacity;
    expect(queue.pending).toBe(0);
    gate.resolve();
    await queue.close();
  });

  it('rejects capacity waiters on close and external abort, removing listeners', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 0 });
    await queue.onCapacity();
    const gate = deferred<void>();
    queue.submit(() => gate.promise);
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    const aborted = expect(queue.onCapacity({ signal: controller.signal })).rejects.toThrow(
      TaskCancelledError,
    );
    controller.abort();
    await aborted;
    expect(remove).toHaveBeenCalledTimes(1);
    await expect(queue.onCapacity({ signal: controller.signal })).rejects.toThrow(
      TaskCancelledError,
    );
    const closed = expect(queue.onCapacity()).rejects.toThrow(QueueClosedError);
    const closing = queue.close();
    await closed;
    await expect(queue.onCapacity()).rejects.toThrow(QueueClosedError);
    gate.resolve();
    await closing;
  });

  it('removes task abort listeners on successful and failed settlement', async () => {
    const queue = new TaskQueue();
    for (const fail of [false, true]) {
      const controller = new AbortController();
      const remove = jest.spyOn(controller.signal, 'removeEventListener');
      const handle = queue.submit(
        () => {
          if (fail) throw 'failure';
          return 1;
        },
        { signal: controller.signal },
      );
      await handle.result;
      expect(remove).toHaveBeenCalledTimes(1);
      expect(handle.cancel()).toBe(false);
    }
    await queue.close();
  });

  it('reserves reentrant submissions behind the current task', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxPending: 1 });
    const order: number[] = [];
    const first = queue.submit(() => {
      order.push(1);
      queue.submit(() => {
        order.push(2);
      });
      expect(() => queue.submit(() => 3)).toThrow(QueueFullError);
    });
    await first.result;
    await queue.close();
    expect(order).toEqual([1, 2]);
  });
});

# 2.x TaskQueue design and migration

Status: implemented for review on the 2.x branch. Complete the updated 1.1.x release and cut `releases/1.1` before any 2.x merge. Dependency, module-format and legacy iterator corrections have separate owners. This change preserves the existing iterable classes and does not claim to fix their separate correctness findings.

## Workloads behind the design

Read-only inspection of PwrGit, PwrAgnt and PwrSnap showed three different needs:

1. **Finite producers:** PwrGit's `mapLimit` and PwrSnap's thumbnail seeder await each `enqueue()` and finally close with `onIdle()`. They need bounded asynchronous overlap without starting a process or image operation for every input at once.
2. **Long-lived events:** PwrGit's visible-row fills and remote-tip checks submit without awaiting admission. They maintain maps, cancellation flags, completion promises, debounce timers and separate user/background lanes. Concurrency is limited, but unawaited legacy enqueue calls retain every input immediately.
3. **Iterable results:** PwrAgnt's peer searches and agent probes consume completion-order results from `IterableMapper`. The input set is already iterable; unread-result backpressure is useful and should remain available.

PwrSnap's enrichment queue additionally demonstrates that a slot must cover preparation through request cleanup, not just acquiring permission to start a fetch. Its acquire/release tickets remain application-specific. A lazy task can directly return the entire operation's promise and hold the slot for that lifetime.

The [README public examples](README.md#public-application-examples) link verified, pinned source. These are usage evidence; none of the applications was edited or migrated during this work.

## One scheduler, two completion interfaces

```typescript
type Task<T> = (signal: AbortSignal) => T | PromiseLike<T>;
type TaskOutcome<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

interface TaskHandle<T> {
  readonly result: Promise<TaskOutcome<T>>;
  cancel(reason?: unknown): boolean;
}
```

| Operation | Admission | Completion |
| --- | --- | --- |
| `submit(task, { signal }?)` | Synchronous acceptance or throw | Cancellable handle with a nonrejecting outcome |
| `add(task, { signal }?)` | Same synchronous admission decision, converted to promise rejection on failure | Conventional value/rejection promise |
| `onCapacity({ signal }?)` | No task admitted | Hint that an admission attempt may succeed |

`submit` is suitable for event callbacks and makes ignored background failures safe from unhandled promise rejection. Errors remain explicit outcomes; the queue does not accumulate an unbounded error list. `add` is suitable for IPC and request/response handlers that already await their result. Its promise must be handled like any other rejecting promise. Admission exceptions take precedence in this order: invalid task, closed queue, pre-aborted signal, full queue.

User task code starts in a microtask after submission. Running slots are reserved synchronously before the handle is returned, so a burst in the same JS turn cannot bypass the limit. This also prevents synchronous tasks from reentering the queue before their caller receives the handle. A promise returned by a task is assimilated, including custom thenables and throwing `then` accessors. The scheduler handles synchronous throws and asynchronous rejections through one settlement path.

An `undefined` value or rejection reason is valid. Outcomes use an explicit status tag rather than treating `undefined` as a sentinel. Ordinary task failures affect only that task and never stop the scheduler or reject drain/close.

## Admission is a resource policy

Options are independent: `concurrency` defaults to 4 and `maxPending` to 8. Both are finite safe integers; concurrency is positive and maxPending is nonnegative. The invariant is:

```text
running <= concurrency
pending <= maxPending
queue-owned unfinished tasks <= concurrency + maxPending
```

`running` includes reserved slots and operations still cleaning up after abort. `pending` excludes running tasks. `maxPending: 0` provides direct admission with no waiting backlog. Results are delivered immediately on settlement and are not retained by the queue; there is no unread-result buffer to drain.

Full admission throws `QueueFullError` from `submit` or rejects `add`. Closed admission similarly uses `QueueClosedError`. A non-awaiting emitter must decide whether to drop, coalesce, replace, report busy or retry. The scheduler does not silently buffer more tasks or choose a loss policy for the application.

`onCapacity` holds only waiter callbacks, not task payloads. It does not reserve a slot; when multiple producers wake they retry `QueueFullError`. This keeps the interface small and avoids hidden queues of unbounded payloads. Each producer should await one wait at a time. Waiters themselves, task closures, caller-retained handles/results and application debounce maps can still consume memory. The invariant bounds task count, not bytes or every allocation in an application. A finite external event stream cannot be made lossless with bounded memory unless its producer can slow down or work is stored elsewhere.

No fairness guarantee is made between capacity waiters and a new synchronous submission. Once admitted, surviving waiting tasks start in FIFO order. Serial producers can stream without retaining all completion promises; see [task-queue-producer.ts](examples/task-queue-producer.ts).

## Cancellation preserves the concurrency invariant

Waiting tasks are removed immediately when their handle is cancelled or their external signal aborts. Their result resolves to a rejected outcome containing `TaskCancelledError`, whose `reason` preserves the caller's reason. Cancelled entries leave no queue-owned tombstones and make capacity available immediately.

Running cancellation aborts the internal signal supplied to the task. The slot remains reserved until the task's real promise settles. The result reflects that real settlement: an operation that ignores abort can still fulfill. Before the first invocation microtask, abort skips the function and rejects its outcome. Abort listeners are detached on settlement; repeated cancellation after abort or settlement returns false.

Releasing a slot as soon as a signal aborts would permit a replacement to run while the old process, network request or cleanup is still active. This is why there is no forced timeout that pretends the underlying work has finished. Applications may enforce deadlines with cooperative signals or terminate their own subprocesses; their returned task promise must still cover cleanup.

Cancellation errors use this library's exported `TaskCancelledError`, not a platform-specific DOMException. A running operation may instead reject with its own cancellation error; its original reason is preserved. Callers that want to omit expected cancellation from logging should recognize both their operation's errors and `TaskCancelledError`.

## Idle, drain and close have separate meanings

| Method | Contract |
| --- | --- |
| `onIdle()` | Wait for the next idle state and keep admission open. New tasks arriving before idle extend the wait. |
| `drain()` | Snapshot accepted unfinished tasks at the call and await only those tasks. Later submissions do not extend it. |
| `close()` | Stop admission immediately and await all accepted work. |
| `close({ cancelPending, abortRunning })` | Optionally remove waiting tasks and/or signal running tasks, then await actual settlement. |

`close` is idempotent and repeated calls share the same promise. A later call can escalate cancellation. Capacity waits reject when closing starts. Close and drain resolve after failures as well as successes; callers inspect per-task results. The queue is not reopenable after close.

A live stream can keep `onIdle()` pending indefinitely; `drain()` still provides a bounded snapshot wait. A noncooperative running task can keep both drain and close pending indefinitely. Do not await same-queue work from a task if completion requires releasing that task's slot: serial `add`, `onCapacity`, `drain`, `onIdle` and `close` can all create such dependencies. Stop event production before graceful close, and close before releasing resources used by accepted tasks.

## Migration from 1.x

Existing iterable exports and behavior remain in this PR. Use TaskQueue for new event/task code; retain `IterableMapper` for streamed result pipelines. Existing `IterableQueueMapperSimpleOptions` is now also exported from the package root for consumers typing legacy adapters.

| 1.x pattern | TaskQueue equivalent | Compatibility consideration |
| --- | --- | --- |
| `new IterableQueueMapperSimple(mapper, { concurrency })` | `new TaskQueue({ concurrency, maxPending })`, then lazy task submissions | Max pending is a separate, explicit limit; `Infinity` is unsupported on the new queue. |
| `await queue.enqueue(item)` waits for a source pull | `submit(() => mapper(item))` after capacity wait | Admission and completion are separate; `await add()` waits for completion and serializes a loop. |
| `void queue.enqueue(item)` on a UI event | `submit` with explicit full/closed handling | Overload cannot grow an invisible backlog. |
| Hand-built `resolve`/`reject` tickets | `handle.result` or `add()` | Event results are outcome objects; `add` rejects with the original reason. |
| Cancelled flags left in an input queue | `handle.cancel()` or external signal | Queued cancellation removes the task immediately; running cancellation is cooperative. |
| `onIdle()` permanently closes Simple | `close()` at final shutdown | TaskQueue `onIdle()` is reusable. Do not mechanically rename lifecycle calls. |
| Read `errors` after shutdown | Inspect each outcome, or handle each `add` rejection | No retained error history and no implicit final aggregate. |
| Use mapper `index` | Capture the index in the submitted closure | TaskQueue supplies a signal rather than an iterator index. |
| `maxUnread` | Keep it for iterable outputs; choose `maxPending` for tasks | Output buffering and pending-input bounds are not equivalent. |

Example migration for a finite producer:

```typescript
// 1.x: enqueue completion means source admission; onIdle permanently closes.
const old = new IterableQueueMapperSimple(write, { concurrency: 2 });
for (const item of items) await old.enqueue(item);
await old.onIdle();
// Check old.errors here.

// 2.x: wait for capacity, admit a lazy operation, inspect every completion.
const queue = new TaskQueue({ concurrency: 2, maxPending: 4 });
try {
  for (const item of items) {
    const handle = await submitWhenReady(queue, () => write(item));
    void handle.result.then(reportOutcome);
  }
} finally {
  await queue.close();
}
```

`submitWhenReady` is the complete retry helper in the [runnable producer example](examples/task-queue-producer.ts). `reportOutcome` must itself handle any error it can throw. Production code should select an explicit logging/error policy rather than assume closing means every write succeeded.

For PwrSnap's enrichment lanes, wrap the entire preparation/request/cleanup operation in a task; preserve connection-key ownership and queue-age checks in the application. A settings change should not create a second active queue with a new budget before the old lane drains. For PwrGit, keep viewport debounce and freshness maps, use cancellation handles instead of pending tombstones, and keep separate background/user lanes where those budgets are intentional. One queue per key can preserve per-repository ordering, but a global process budget requires an additional application policy; nested queues require care to avoid deadlock.

## Implementation choices and boundaries

The legacy mapper stack is useful for iterable prefetch and output flow control. Reusing it for this task interface is unsafe without a larger redesign: it eagerly stores pending inputs, lacks removable entries and reusable idle state, conflates unread-result capacity with scheduling, and has independently reproduced terminal/sentinel defects. The new scheduler uses a small insertion-ordered Map for waiting entries and a Set for running entries. Both provide immediate removal without changing existing classes. `add` is implemented on `submit`, not a second scheduler.

No rate limiting, priorities, mutable concurrency, keyed locks, persistence, debounce, coalescing, retries or automatic timeouts are added. The inspected applications attach these policies to specific domains. Keeping them outside the scheduler avoids claiming generic cancellation can terminate arbitrary operations or generic draining can replace durable storage.

TaskQueue does not use `aggregate-error`: each failure has its own result. Native `AggregateError` is the recommended 2.x representation when an application explicitly wants an aggregate or when the legacy continue-on-error iterator is corrected. Replacing the 3.x runtime/peer dependency and choosing ES2021 library declarations belong to the module/release workstream; no dependency or build configuration is changed here. The recommended 2.x baseline is Node.js 22+; release owners must reconcile the final engines policy, declarations and ESM/CommonJS exports.

## Prior experiments

[PR #16, Add aliases](https://github.com/shutterstock/p-map-iterable/pull/16), introduces `Prefetcher`, `BackgroundFlusher` and `SimpleBackgroundFlusher`. Descriptive naming remains useful for iterable APIs; TaskQueue supplies a clearer name for event operations. This PR does not add the proposed aliases. If retained separately, direct class re-exports can preserve both generic constructor and instance types without duplicate `InstanceType` aliases. Naming changes should accompany accurate lifecycle documentation.

[PR #17, Allow multiple in-order queued items](https://github.com/shutterstock/p-map-iterable/pull/17), identifies a useful need: serial execution with an independent waiting backlog. Its `maxQueueDepth` is forwarded to the output mapper's `maxUnread`, which cannot establish a hard pending-input bound and cannot create extra input admission while a serial mapper is occupied. TaskQueue incorporates the intended behavior as `concurrency: 1, maxPending: N`, with immediate finite admission, FIFO execution, cancellation and outcomes. The old queue-depth example and timing assertions should not be copied as evidence that its option implements waiting-input capacity.

[PR #15](https://github.com/shutterstock/p-map-iterable/pull/15) changes an undefined-enqueue assertion for coverage reporting; it is a legacy test concern, not part of TaskQueue. These PRs were reviewed read-only and remain open for the parent to evaluate independently.

## Validation

TaskQueue tests use controlled promises instead of elapsed-time thresholds for admission, FIFO starts, out-of-order completion, failure continuation, cancellation, listener cleanup, capacity contention and lifecycle behavior. A separate strict Node subprocess checks that ignored failed submissions cannot generate unhandled rejections. Event-burst and cancellation stress cases each exercise 1,000 submissions. Runnable examples assert their documented counts and resource limits. Complete validation and prioritized legacy findings are recorded in [REVIEW-2.md](REVIEW-2.md).

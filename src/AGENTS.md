# Library and tests

Read the [root guide](../AGENTS.md) first. Source files and their `*.test.ts`
files share this directory. Each public class has one source file.

## Public APIs

[index.ts](index.ts) exports all public classes and types. The three aliases
share the original constructors. Keep constructor identity, generic types, and
subclass behavior intact. Check [index.test.ts](index.test.ts) for alias coverage.

| Class and alias | Source | Responsibility | Boundary |
| --- | --- | --- | --- |
| `IterableMapper` / `ConcurrentMapper` | [iterable-mapper.ts](iterable-mapper.ts) | Map a sync or async iterable. Stream mapped results. | Takes an iterable, not `enqueue()` calls. |
| `IterableQueueMapper` / `MappingQueue` | [iterable-queue-mapper.ts](iterable-queue-mapper.ts) | Accept queued inputs. Use one fixed mapper. Stream results. | The caller must consume results. |
| `IterableQueueMapperSimple` / `WorkerQueue` | [iterable-queue-mapper-simple.ts](iterable-queue-mapper-simple.ts) | Run one fixed worker. Discard results. Collect item errors. | Has no result iterator or reusable idle wait. |
| `IterableQueue` | [iterable-queue.ts](iterable-queue.ts) | Add async iteration to `BlockingQueue`. | Does not map items. |
| `BlockingQueue` | [blocking-queue.ts](blocking-queue.ts) | Coordinate async writers and readers in FIFO order. | Does not run callbacks. |
| `Queue` | [queue.ts](queue.ts) | Store items in FIFO order with constant-time removal. | Has no waits, capacity limit, or shutdown method. |
| `TaskQueue` | [task-queue.ts](task-queue.ts) | Admit bounded lazy tasks with per-task outcomes and cooperative cancellation. | Reusable idle waits; `close()` ends admission. |

Put shared mapping logic in `IterableMapper`. `IterableQueueMapper` combines it
with an input `IterableQueue`. `IterableQueueMapperSimple` wraps that mapping
queue and consumes its results. Keep these layers distinct. Use an existing
layer before adding a second implementation of the same contract.

Callbacks overlap async work in one JavaScript process. They do not start worker
threads. The iterable APIs leave event admission and per-item handles to callers.
The 2.x `TaskQueue` provides bounded admission, cancellation, and per-task handles;
deduplication remains a caller concern. See [DESIGN-2.md](../DESIGN-2.md).

## Defaults and backpressure

| Class | Defaults |
| --- | --- |
| `IterableMapper`, `IterableQueueMapper` | `concurrency: 4`, `maxUnread: 8`, `stopOnMapperError: true`. |
| `IterableQueueMapperSimple` | `concurrency: 4`. Internal `maxUnread` equals `concurrency`. |
| `BlockingQueue`, `IterableQueue` | `maxUnread: 8`. |
| `TaskQueue` | `concurrency: 4`, `maxPending: 8`. |

- Mapper limits accept positive safe integers or `Infinity`.
  `maxUnread` must be at least `concurrency`.
- Low-level queues also accept `maxUnread: 0`.
  `IterableQueueMapper` uses this setting for its input queue.
- Mapper runners and unread results share the backpressure budget.
  Do not treat `maxUnread` as an independent input backlog limit.
- `BlockingQueue.enqueue()` stores the item before it waits for a read.
  Await each enqueue to slow the producer. Unawaited calls can grow the backlog.
- Queue storage is FIFO. Mapped results can arrive out of input order when
  `concurrency` exceeds one. Use `concurrency: 1` for input order.
- `undefined` marks the end of low-level reads. `Queue` rejects it as an input.
  `IterableMapper` also rejects an `undefined` mapped result.

## Completion and errors

- `enqueue()` resolves on acceptance. It does not wait for that item's callback
  to finish. Produce and consume `MappingQueue` results concurrently.
- `done()` closes queue input. It does not wait for processing to finish.
  Call it after the last awaited enqueue. Drain remaining items or results.
- `WorkerQueue.onIdle()` closes input permanently and waits for accepted work.
  Later enqueues reject. `isIdle` becomes true after this shutdown completes.
- `WorkerQueue` catches callback errors and keeps processing. Check its mutable
  `errors` array of `{ item, error }` entries after `onIdle()`.
- With `stopOnMapperError: true`, mapper failure stops new work and reaches the
  result iterator. It does not cancel callbacks that already started.
- With `stopOnMapperError: false`, mapping continues. The result iterator throws
  native `AggregateError` at the end, with original rejection values in `.errors`
  and no coercion. Source iterator errors stop work in either mode.

## Tests

[jest.config.js](../jest.config.js) runs `src/**/*.test.ts` in Node.js with
`ts-jest`. It collects V8 coverage in `coverage/` as LCOV, HTML, and text.
There is no configured coverage threshold.

Run one suite from the repository root:

```sh
pnpm run test --runTestsByPath src/iterable-mapper.test.ts --runInBand
```

Add behavior tests beside the class. Use `index.test.ts` for package exports and
aliases. Run `pnpm run build` to check TypeScript types; Jest transforms files in
isolation.

For scheduling changes, check empty sources, concurrent readers and writers,
slow consumers, serial order, both mapper error modes, and shutdown. Use more
inputs than the buffer limit to test backpressure. Assert blocked and released
promises, not only final item counts.

For timing tests, follow the existing `withVirtualTime` helper. It advances
timers with `jest.runAllTimersAsync()` and restores real timers in `finally`.
Await the test promise so failures reach Jest. Avoid new wall-clock sleeps when
promise coordination or fake timers can test the same behavior.

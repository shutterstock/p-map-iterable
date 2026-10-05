# Usage examples

Read the [root guide](../AGENTS.md). Check the
[class contracts](../src/AGENTS.md#public-apis) before changing an example.

| File | Shows | Command |
| --- | --- | --- |
| [iterable-mapper.ts](iterable-mapper.ts) | Prefetch from an async source. Consume results with backpressure. | `pnpm run example:iterable-mapper` |
| [iterable-queue-mapper.ts](iterable-queue-mapper.ts) | Queue inputs while consuming results. Collect mapper failures at the end. | `pnpm run example:iterable-queue-mapper` |
| [iterable-queue-mapper-simple.ts](iterable-queue-mapper-simple.ts) | Run a fixed worker. Discard results and inspect errors after shutdown. | `pnpm run example:iterable-queue-mapper-simple` |
| [semantic-aliases.ts](semantic-aliases.ts) | Use `ConcurrentMapper`, `MappingQueue`, and `WorkerQueue`. | `pnpm run example:semantic-aliases` |

Run commands from the repository root. The scripts use `ts-node` and
`tsconfig-paths`. Imports from `@shutterstock/p-map-iterable` resolve to local
`src/` through [tsconfig.json](../tsconfig.json). The build also compiles examples.

Keep examples small and focused on one input and result contract. Keep them
aligned with [README.md](../README.md) and source API comments. Use the same
public package imports that users write.

Await each enqueue. For `MappingQueue`, start the result consumer while the
producer runs. Call `done()` after the last awaited enqueue. For `WorkerQueue`,
call `onIdle()` only after production ends, then inspect `errors`.

The examples simulate I/O with timers. Some use random delays and intentional
errors. They are usage demos, not benchmarks or substitutes for tests. Run the
changed example and `pnpm run build` when editing its TypeScript code.

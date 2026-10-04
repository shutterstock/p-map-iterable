# Project review for 2.x

Review date: 2026-10-04. Source baseline: `38ad09f`; maintenance/toolchain baseline for final validation: `64bf68c` (`chore/refresh-1.1-dependencies`). Scope: existing source/tests/docs/examples, read-only real application usages, and open experiments #15/#16/#17. No application source was edited. Release, dependency, build configuration and GitHub workflow changes are owned separately.

The updated 1.1.x release and `releases/1.1` branch must exist before any 2.x merge. This review distinguishes reproduced source problems from design limitations and recommendations; passing existing tests does not establish the missing contracts.

## Correctness priorities

| Priority | Finding and evidence | Consequence / disposition |
| --- | --- | --- |
| P0 | Mapper failure with `stopOnMapperError: true` does not decrement `_resolvingCount` and does not establish a coherent terminal state. After receiving the first mapper error, a second `next()` remained pending in a 30 ms bounded reproduction. | Terminal consumers and producers can hang; detached code may still manipulate queues after failure. Parent's separate 2.x iterator correctness PR must define and test terminal behavior, multiple waiting readers, source errors and already-running tasks. TaskQueue has its own total settlement path. |
| P1 | Successful `undefined` and `throw undefined` both reproduce `TypeError: no element was returned` in `IterableMapper`. Its result/error wrapper tests optional fields instead of a status discriminator. | Valid values/rejection reasons are lost. Parent's iterator PR should preserve primitives and undefined; TaskOutcome already does. Lower-level Queue's explicit ban on undefined is a different, intentional sentinel contract. |
| P1 | `for await` early break does not call an underlying generator's cleanup. A generator `finally` flag remained false after breaking; the source required a manual `return()` for cleanup. No `return()` exists on the wrapper iterator. | Files, cursors or generator-owned resources may remain open, and prefetch can continue. Parent should define source cleanup exactly once, cancellation and terminal completion of waiters. |
| P1 | `BlockingQueue({ maxUnread: 1 })` stores three items synchronously after three unawaited enqueue calls; observed `length === 3`. Input insertion precedes writer waiting. | Finite options are cooperative backpressure, not a hard event-input bound. Preserve documented legacy behavior where compatible; direct event work to bounded TaskQueue. |
| P1 | `IterableQueueMapperSimple.onIdle()` calls `done()` permanently. Enqueue after completed idle reproduces `` `enqueue` called after `done` called ``. | Cannot wait for a live service's idle state and reuse it. Keep legacy lifecycle documented; TaskQueue separates reusable idle, snapshot drain and final close. |
| P1 | Simple catches every mapper error into a mutable, unbounded array. PwrGit's `mapLimit` never reads that array; its completion can therefore report success after worker failure. PwrSnap constructs separate readiness promises to recover per-item errors. | Applications need explicit error delivery rather than only a final error list. TaskQueue provides value/rejection or nonrejecting per-task outcomes and retains no error history. Applications were not patched. |
| P2 | Legacy runner creation and result-capacity comparisons need tests at exact full/empty transitions, parallel `next()` calls, source `done` interleaved with mappers, async source rejection and late task settlement after terminal failure. | The audit found fragile accounting and detached runner paths; not every transition was independently reproduced here. Parent's iterator/shutdown audit owns these cases. Do not treat existing success-path coverage as a state-machine proof. |
| P2 | Legacy interfaces allow `Infinity`. Unbounded runner creation/input retention can defeat resource control; `maxUnread` includes active/read-ahead concerns that differ from pending inputs. | TaskQueue rejects Infinity and provides independent finite limits. Do not silently change legacy option semantics in an additive API PR. |
| P2 | A producer that finishes all enqueue calls before iterating `IterableQueueMapper` results can deadlock under output backpressure. Its source documentation incorrectly recommends `onIdle()`, a method it does not have. | README now requires concurrent production/consumption and describes the actual lifecycle. Existing TSDoc can be corrected with the iterator work without claiming a new method exists. |
| P2 | TypeDoc copies locally linked example sources into `docs/media`, and the tsconfig includes generated `docs` in later type checks. A second docs build reproduced import/type errors with relative `../src` example imports. | New examples use the existing package path alias and runtime path registration; repeated docs/build checks pass. Release/build owners should exclude generated docs from compilation. TypeDoc still needs Mermaid rendering integration for its HTML output. |

The legacy reproductions were run against compiled baseline source before rebasing. They are design evidence, not regression tests added to assert known broken behavior. The parent confirmed and is fixing the mapper accounting/undefined/cleanup failures separately. TaskQueue adds regression tests for the corresponding task contracts without changing legacy mapper source.

## Real usage assessment

| Application and inspected paths | Observed contract | 2.x implication |
| --- | --- | --- |
| PwrGit `main/util/map-limit.ts`, `renderer/src/lib/asyncFill.ts` | Finite awaited batch admission versus long-lived debounced, non-awaiting UI requests; cancellation uses queued tombstones. | Preserve finite producer overlap; offer hard bounded event admission and removable cancellation. Error propagation in the batch helper deserves an application follow-up. |
| PwrGit `main/git/remote-tip-checker.ts` | Hand-built completion handles, queued cancellation, direct/background lanes and freshness checks. | Per-task completion handles remove plumbing; preserve domain-specific dedupe, priority lanes and freshness. `stop()` itself does not drain legacy workers. |
| PwrGit `main/git/worktree-operation-queue.ts` | Promise tails serialize each repository/worktree scope independently. | Global TaskQueue is not a replacement for keyed locking. Keep per-key ordering and aggregate budgets explicit. |
| PwrSnap `main/ai/direct-api/enrichment-queue.ts` | Per-endpoint acquire/release tickets; abort rejects UI readiness, queued tombstones are skipped later; slot lasts through cleanup; lane retires after pending work finishes. | Full-operation tasks must cover cleanup and keep slots after abort. Preserve queue age, lane ownership and configuration-change rules externally. |
| PwrSnap `main/dev/seeder/runner.ts`, `renderer/src/features/sizzle/useSequencePlan.ts` | Awaited thumbnail producer and finite UI enrichment batches. | Use capacity waits for overlap; ensure cancellation gates expensive work before start as well as suppressing stale updates afterward. |
| PwrAgnt federation summary cache/target service, agent settings probes, Git directory/working-state services and client thread hydration | Iterable fan-out with completion-order results, bounded parallelism and application-level caught errors/cancellation. | Retain iterable interfaces. Several consumers deliberately drain every result before releasing coalescing ownership; early iterator exit needs a defined cleanup contract. |
| PwrAgnt `main/app-server/thread-turn-queue.ts` | Durable/domain turn admission, held/manual releases and lifecycle projections. | Generic in-memory concurrency control cannot replace persistent or operator-controlled turn queuing. No durable storage guarantee is added. |

Public usage links are pinned and verified in the [README](README.md#public-application-examples); inspection remained read-only. Application wrappers are evidence for the scheduler contract, not authorization to alter their business semantics.

## Open PR assessment

All three inspected PRs are by `huntharo`, target `main`, and were left unmodified.

| PR | Useful idea | Review result |
| --- | --- | --- |
| [#16: Add aliases](https://github.com/shutterstock/p-map-iterable/pull/16) | Names describing prefetch versus background flushing; export Simple's option type. | Aliases do not fix lifecycle/error/admission behavior. Keep the naming discussion for iterable classes; TaskQueue gives event work a direct name. This PR exports the existing Simple options type without importing all experimental aliases or modifying scripts. The proposed BackgroundFlusher example should consume results concurrently with enqueueing rather than enqueue all input before starting its consumer. |
| [#17: Allow multiple in-order queued items](https://github.com/shutterstock/p-map-iterable/pull/17) | Independent backlog depth with serial execution. | `maxQueueDepth` is wired to output `maxUnread`, not pending-input admission. An equivalent `{ concurrency: 1, maxUnread: 5 }` mapper with an automatic result consumer still left the second enqueue pending after 30 ms while the first operation was held. TaskQueue implements the useful intent with `concurrency: 1, maxPending: N`; test admitted/running/waiting counts rather than only elapsed time. |
| [#15: Fix queue throw test](https://github.com/shutterstock/p-map-iterable/pull/15) | Confirm the undefined-input assertion contributes coverage. | Separate legacy test concern. Do not copy the removed Jest matcher aliases into new tests; use current `toThrow`/`toHaveBeenCalled` matchers. |

## API and documentation review

The new scheduler uses one settlement path for values, sync throws, promise/thenable rejection and cancellation. Tasks reserve slots synchronously before starting asynchronously. FIFO Map entries can be removed on cancellation rather than leaving retained tombstones. No result/error history grows behind an event stream. The tests exercise failure continuation and a strict Node subprocess, so ignored `submit` outcomes cannot cause unhandled task rejection.

The README now explains hard admission limits, overload policies, whole-operation slots, completion-order delivery, cooperative cancellation, snapshot drain, reusable idle and final shutdown through three Mermaid diagrams. It distinguishes published 1.x docs from the development 2.x API, corrects missing `onIdle` guidance and removes unmeasured performance claims and historical operation screenshots. [DESIGN-2.md](DESIGN-2.md) records choices, migration and unresolved boundaries.

Meaningful compatibility limitations: `add` can reject and must be observed; `submit` throws admission errors synchronously but resolves task outcomes. Ignoring an outcome is safe from unhandled rejection but discards its failure information. Running cancellation is cooperative. Close confirms settlement, not successful work. Capacity waits have no fairness/reservation guarantee and can be extended by contenders. The task-count bound excludes caller-owned memory, other queues and detached operations. Keyed/global budgets, retries and durability remain application policy.

## Package/release review and validation

Toolchain/dependency refresh, ESM/CommonJS exports, Node engines and GitHub workflows are outside this branch's edits. The parent maintenance baseline refreshes TypeScript, ESLint, Jest, TypeDoc and dependency locks. 2.x should prefer native AggregateError where aggregation is explicit and choose ES2021 library declarations; TaskQueue itself needs no aggregate-error dependency. Recommended runtime baseline: Node.js 22+; reconcile the release support matrix before publishing.

Baseline: 6 suites / 69 tests. Added TaskQueue cases cover options, lazy admission, exact simultaneous bounds, zero pending, FIFO starts/completion order, arbitrary values/errors/thenables, reentrancy, ignored failures, cancellation without tombstones, abort listener cleanup, capacity contention and graceful/escalated shutdown. A strict Node subprocess exercises ignored failed submissions. Two standalone examples assert their outcomes and queue bounds.

Validated against the maintenance baseline with Node.js 24.21.0, TypeScript 6.0.3 and Jest 30:

| Check | Result |
| --- | --- |
| Full Jest suite | 7 suites / 102 tests passed; 33 new TaskQueue tests |
| TaskQueue coverage | 100% statements/lines/functions, 97.87% branches |
| Repository lint and TypeScript build | Passed |
| Both new examples | Passed with their documented assertions |
| Node.js 22.22.1 compatibility smoke | All 33 TaskQueue tests, strict subprocess and both examples passed |
| Mermaid parser | All three README diagrams parsed successfully with Mermaid 11.12.2 |
| TypeDoc, including repeated generation followed by build | Passed; four warnings: existing unexported Errors type and three Mermaid highlighting warnings |
| Public example links | Four pinned source links resolved through GitHub's contents API; public pages verified |

Mermaid fences render on GitHub. TypeDoc's current HTML configuration treats them as code blocks; integrating a Mermaid renderer is left to the documentation/build owner because package/build configuration edits are out of scope. Its generation reports zero errors. No other source/build limitation was found for TaskQueue in this validation.

Before merging, the parent should review TaskQueue's outcome-versus-value API and explicit overload behavior, land the legacy iterator fixes, complete 1.1.x/release branch prerequisites, and reconcile the final module/runtime policy. No merge or release is performed by this workstream.

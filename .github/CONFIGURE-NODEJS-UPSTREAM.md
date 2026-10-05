# configure-nodejs upstream handoff

PR #26 now trials direct calls to
`pwrdrvr/configure-nodejs@8876dbf3c524c8a765543dae3ae5b55d7b5ecfb3`, the commit
for released [v1.6.0](https://github.com/pwrdrvr/configure-nodejs/releases/tag/v1.6.0).
The three producer/five consumer calls are direct and
`.github/actions/configure-nodejs/action.yml` is deleted. PR #26 stays draft
until current released-pin CI passes. The release tree is identical to the
tested e829954 candidate. This combined PR already includes #21/#25 changes and
does not require those branches to merge first. No upstream files are edited
by the caller, and no publication is performed.

Upstream [run 37236616750](https://github.com/pwrdrvr/configure-nodejs/actions/runs/37236616750)
passed all 31 jobs, including 108 unit/action-script tests per OS and pnpm
10.33.0/12.7.0 integration/negative paths. This establishes fixture evidence,
not p-map-iterable direct-call evidence. Caller [run 37238410920](https://github.com/shutterstock/p-map-iterable/actions/runs/37238410920)
passes at `7979f39f5e179735100f60d4834b4965fcb9fc12`. The exact matched producer
and both consumer keys are recorded in [the workflow notes](workflows/README.md).
It ran all 75 tests on Node 24 and Node 22 plus 26 release/docs tests;
the local caller fixture also verifies version materialization cannot cause an
implicit pnpm install. No real publication/deployment was performed.

The passing [CI run 37231686778](https://github.com/shutterstock/p-map-iterable/actions/runs/37231686778)
at `bb08ebe5c611162c8919ab9a602e2805c3d2df5e` validates that interim wrapper,
release guards, and runtime coverage. It does **not** validate the pending
direct-call design. The tested candidate is pinned for this trial; complete
combined caller CI and remaining review before marking direct adoption ready.

## Historical upstream gaps (v1.5.0)

Read-only inspection of `~/pwrdrvr/configure-nodejs` found its HEAD at
`f51ed2be76fbdf3e3374478ef5cd59a7687434ec` (v1.5.0), the currently pinned
[shared action](https://github.com/pwrdrvr/configure-nodejs/blob/f51ed2be76fbdf3e3374478ef5cd59a7687434ec/action.yml).

- `scripts/resolve-cache-paths.mjs` caches `.pnpm-store` for pnpm;
  `shouldInstallDependencies()` in `scripts/resolve-node-version.mjs` deliberately
  returns true on ordinary pnpm cache hits. `lookup-only` provides a warm
  producer probe, but there is no completed-tree strict consumer mode or hard
  cache-miss failure. Direct adoption today would install in consumers.
- The package-manager preparation step exports only `npm_config_store_dir`
  before `pnpm store path`. Native pnpm 12 ignores that spelling. On Node
  24.21.0/pnpm 12.7.0, setting it to a workspace probe path still returned the
  global `~/Library/pnpm/store/v11`; `PNPM_CONFIG_STORE_DIR` returned the requested
  workspace path plus `/v11`. This reproduces the hosted Linux failure in #25.
- The existing pnpm fixture pins 10.33.0. Keep that fixture and its default-store
  regression coverage while adding pnpm 12.7.0 coverage.

## Required opt-in behavior

The candidate implements an opt-in completed `node_modules` cache with separate
populate and strict restore modes while preserving default store behavior.
The following contract remains the caller's acceptance requirement. These inputs
exist in the trial candidate; they are not supported by v1.5.0.

| Mode | Exact hit | Exact miss |
| --- | --- | --- |
| Completed-tree populate | Probe only; no dependency download, install, lifecycle scripts, or save | Set up Node/Corepack, frozen-install, verify the original lockfile is byte-for-byte unchanged, then save the completed tree inline before success |
| Completed-tree restore | Set up Node/Corepack and restore the completed tree; no install, lifecycle scripts, or dependency save | Fail; no install, lifecycle scripts, fallback, or dependency save |

A strict consumer also fails on a Node major/ABI mismatch; it must never repair
the mismatch by installing. No prefix restore keys or partial-store fallback are
allowed. A failed install, changed lock, or incompatible tree must not be saved
as a completed entry. Corepack activation may prepare the pinned package-manager
executable; this permission does not include installing project dependencies.
Preserve separate package-manager executable caching if desired.

Use a shared deterministic key calculation for producer and compatible consumers.
The completed-tree namespace must be distinct from existing store entries and
must include:

- Completed-tree cache format/target namespace (distinct from store entries),
  Node major, and exact package-manager pin. The populate versus restore
  operational role must NOT affect the key: producer and consumer must compute
  exactly the same key.
- Runner OS, architecture, stable `ImageOS`, and normalized working directory.
- Entire-file hashes of the lock, manifest, workspace policy, and npm config;
  include any additional supported installation inputs supplied by the caller.
  Hash all lock bytes, not a parsed subset or only the first YAML document.
- Reviewed action revision and caller namespace/policy suffix. The existing
  `cache-key-suffix` can carry caller policy and revision hashes.

Exclude volatile `ImageVersion`: compatible jobs on different revisions of the
same hosted image must compute identical keys. Different OS/architecture/Node
major/package-manager/working directory/policy must invalidate the key. Exposing
the exact key as an output would make producer/consumer wiring reviewable.

Export `PNPM_CONFIG_STORE_DIR` before native pnpm store discovery and install;
retain `npm_config_store_dir` for existing versions if needed. Verify the actual
store lies within the selected workspace store. This setting is CI-only;
local development continues using its shared APFS store. pnpm 12 fixtures should
use portable import settings instead of forcing cloning on unsupported Linux
filesystems.

## Direct caller examples

These examples use the implemented API and immutable trial candidate. Both jobs
select the same source commit, action SHA, runners, and cache inputs. Completed
modes must not pass `lookup-only`.

The CI examples pin `github.sha`; actual publication retains the validated
`needs.select-release.outputs.commit` for every downstream checkout.

```yaml
env:
  npm_config_min_release_age: '7'

jobs:
  install-deps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.sha }}
      - uses: pwrdrvr/configure-nodejs@8876dbf3c524c8a765543dae3ae5b55d7b5ecfb3 # v1.6.0
        with:
          node-version: '^24.0.0'
          package-manager: pnpm
          working-directory: '.'
          dependency-cache: node-modules
          cache-mode: populate
          cache-key-suffix: p-map-iterable-8876dbf3c524c8a765543dae3ae5b55d7b5ecfb3-${{ hashFiles('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc') }}

  test:
    needs: install-deps
    runs-on: ubuntu-latest
    env:
      PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false'
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.sha }}
      - uses: pwrdrvr/configure-nodejs@8876dbf3c524c8a765543dae3ae5b55d7b5ecfb3 # v1.6.0
        with:
          node-version: '^24.0.0'
          package-manager: pnpm
          working-directory: '.'
          dependency-cache: node-modules
          cache-mode: restore
          cache-key-suffix: p-map-iterable-8876dbf3c524c8a765543dae3ae5b55d7b5ecfb3-${{ hashFiles('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc') }}
      - run: pnpm run test
```

The producer keeps normal verification. All five actual p-map-iterable consumers
must retain `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false'`: CI build/runtime-tests,
manual docs build, publication build, and release docs. pnpm 12 otherwise can
implicitly reinstall dependencies and rerun native scripts before `pnpm run`
after `npm version` changes the source manifest. This remains a caller setting
unless upstream explicitly guarantees it in strict mode.

No `registry-url` input was added. Publication uses caller-side
`actions/setup-node@v7` registry configuration after restoration with automatic
package-manager caching disabled. The npm token remains final-publish-step only.

## Files and functions to change

The implementation in upstream PR #13 owns the following work. Review it
separately; the caller does not modify the upstream checkout:

| File | Relevant work |
| --- | --- |
| `action.yml` | Opt-in inputs, probe/populate/strict-restore wiring, inline save after lock verification, pnpm 12 store environment export, optional key output |
| `scripts/resolve-cache-paths.mjs` | `buildCachePaths()`, `buildPrimaryCachePath()`, `buildCacheKeyPrefix()`, `buildResult()`: distinct completed/store namespaces, directory and policy key inputs |
| `scripts/resolve-node-version.mjs` | `shouldInstallDependencies()` and `shouldDiscardRestoredDependencies()`: strict consumers reject misses/mismatches without installation or repair; preserve default behavior |
| `scripts/resolve-manager.mjs` | `buildResult()`: retain full-file lock hash/exact manager pin; expose original lock checksum for comparison as needed |
| `scripts/detect-cache-paths.mjs` | `hasCacheableDependencyPath()`: recognize completed pnpm trees only after successful population |
| `test/action-wiring.test.mjs`, cache-path/node-version/manager tests | Mode isolation, exact key/miss behavior, no-install guard, default-store regression |
| `fixtures/pnpm-basic/`, new pnpm 12 fixture, `.github/workflows/ci.yml` | Retain 10.33.0 coverage and add 12.7.0 cold/warm/strict round-trip coverage on Linux/macOS and other supported platforms |
| `README.md` | Document opt-in contract, symlink/native cache compatibility, strict failures, and producer/consumer examples |

The caller trial applies these p-map-iterable changes:

- Delete `.github/actions/configure-nodejs/action.yml` (done).
- Replace its three producer and five consumer calls directly in
  `.github/workflows/ci.yml`, `docs.yml`, and `publish.yml`. Keep explicit modes
  and identical key inputs/source commits (done). Upstream owns original-lock and
  unchanged-input verification; producers expose the key and consumers compare
  it before repository scripts run.
- Update `.github/workflows/README.md`, `.github/RELEASING.md`, this handoff, and
  PR #26's body with the reviewed pin and actual direct-call validation results.

Keep package manifests, lock/config, source, and library scripts in the parent's
scope. No upstream edits, release tags, publication, or PR merges are authorized
by this documentation handoff.

## Acceptance evidence before direct adoption

1. Fresh/frozen cold population saves a usable completed tree inline only after
   success and unchanged lock verification. Warm population probes without
   installing/downloading dependencies or rerunning lifecycle scripts.
2. Exact restore succeeds after deleting materialized dependencies and restores
   pnpm links, binaries, and allowed native tooling. A hard miss and an ABI
   mismatch fail with zero project installs/lifecycle scripts/cache saves;
   instrument fixtures to establish the negative paths rather than relying on
   a successful script alone.
3. Every key input invalidates the cache when changed; changing only
   `ImageVersion` does not. Store and completed entries cannot collide. Restore
   has no fallback keys or partial-cache install behavior.
4. Native pnpm 12.7.0 discovers the intended store on Linux and macOS. Existing
   pnpm 10.33.0/default-store tests still pass. Restore round trips validate
   supported pnpm links/native dependencies on supported platforms.
5. In an installed consumer fixture, materialize a release with `npm version`,
   then run a pnpm script with verification disabled. Assert no implicit install
   or dependency lifecycle rerun and no lock change.
6. The parent lock remains one standard v9 YAML document with the same 438
   original package/version pairs; `packageImportMethod: auto`, `pmOnFail: ignore`,
   allowed native builds, exact pnpm 12.7.0 pin, pnpm age 10080 minutes, and npm
   age seven days remain intact.
7. Run combined direct-call CI with Node 24 installation/build/docs/publication
   tooling selected with `^24.0.0` and the captured `^22.0.0` runtime with restored
   Node 24 PATH. Prefer compatible cached versions; do not pin minor/patch
   compatibility or enable setup-node's check-latest.
   The required `build` guard must fail runtime failures/skips. Preserve
   optional `test:package` and real npm consumer/publication interoperability.
8. Preserve validated release SHA checkouts, fresh channel selection on every
   publication retry, metadata-before-install/auth ordering, downstream docs
   after successful publication, exact latest/tag provenance checks, and shared
   `queue: max` serialization. Run the 26 release/docs tests and workflow/schema
   checks; do not perform a real publication to validate the handoff.

The pinned release commit is `8876dbf3c524c8a765543dae3ae5b55d7b5ecfb3`. Prior direct-call
run 37238410920 and actual cache-key evidence validate the caller CI paths;
upstream run 37236616750 covers the cross-platform strict negative fixtures.
The old wrapper's run remains historical evidence only. Publication/docs source
selection, ordering, token scope, and guards are validated without publishing.
Current release-pin CI will validate its fresh caller namespace before readiness.
PR #26 can stand alone because it contains the migration and workflow changes.
No separate prerequisite branch merge is required; upstream support is released.

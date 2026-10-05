# Dependency setup

CI, manual documentation, and publication call
`pwrdrvr/configure-nodejs@8876dbf3c524c8a765543dae3ae5b55d7b5ecfb3` directly,
the immutable commit for released [v1.6.0](https://github.com/pwrdrvr/configure-nodejs/releases/tag/v1.6.0).
The local configure-nodejs action has been deleted. This released tree matches
the tested e829954 candidate exactly. PR #26 contains the manifest migration and
maintenance workflow changes previously developed in #25/#21; it can be reviewed
and merged as one combined change without merging those branches first. The new
release pin and suffix are undergoing current-head CI before readiness.

Each workflow runs one `install-deps` producer with `dependency-cache:
node-modules` and `cache-mode: populate`. A warm producer only probes the exact
completed cache. On a miss, the shared action activates pnpm 12.7.0 under Node
24, frozen-installs, verifies unchanged original lock bytes and installation
inputs, saves the completed tree inline, and confirms the exact save before
succeeding. It exports both pnpm store environment spellings and verifies the
workspace-local store. Local development continues using its shared APFS store;
`packageImportMethod: auto` remains portable across macOS and Linux.

All five consumers use `cache-mode: restore` under Node 24. They restore only the
exact completed tree after the producer succeeds and fail on misses or
incompatible Node-major/ABI metadata. They never install, repair, or save project
dependencies. Corepack executable preparation and its separate cache are
permitted. Completed modes do not use `lookup-only` or fallback keys; existing
upstream default store behavior remains available for other callers.

Every producer exports the upstream `cache-key` as a job output. Each consumer
requires its own output to equal that producer key and logs the matched value.
The key separates completed and store namespaces and includes Node major, exact
manager pin, OS/architecture, stable `ImageOS`, normalized directory, full
installation-file hashes, action implementation revision, and caller suffix.
It excludes volatile `ImageVersion` and populate/restore role. All eight calls
use the same suffix containing the released SHA and entire-file
`hashFiles('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc')`.
Upstream also includes workspace manifests/config and supported install inputs;
additional files can use its newline-separated `cache-inputs` input.

CI checkouts explicitly select `github.sha`. Publication validates the event tag
before dependency work and pins producer/build/docs to the exported validated
commit. Source versions are materialized only after restoring dependencies.
Manual docs producer/build select the same dispatch SHA.

Every strict consumer keeps `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false'` at job
scope: CI build/runtime-tests, manual docs build, publication build, and release
docs. pnpm 12 can otherwise reinstall dependencies and rerun allowed native
scripts before a run after `npm version` changes the source manifest. Producers
retain normal verification. The manifest pins pnpm 12.7.0; workspace age 10080
minutes, portable auto import, `pmOnFail: ignore`, and allowed native builds
remain unchanged. All three workflows retain `npm_config_min_release_age: '7'`
for real npm consumers/helper installs. The parent lock remains one standard v9
document with the same 438 original package/version pairs.

Build, docs, compiler and packaging use `^24.0.0`; publication raises its
tooling minimum to `^24.10.0` as described below. The runtime lane
restores/builds on Node 24, saves node/npm/pnpm paths, selects `^22.0.0`,
captures that binary, and restores the Node 24 tooling/PATH. Jest runs through
the captured Node 22 binary; optional consumers receive its absolute path in
`PACKAGE_TEST_NODE`. The stable required `build` job always runs and explicitly
rejects unsuccessful producer/runtime/access results. Current native tooling
uses Node-API; ABI-specific dependencies would need compatible runtime fixtures.

Both caret ranges accept any stable version within their major. Setup-node's
`check-latest` stays false, so it first selects a compatible locally cached
version rather than requiring a particular minor/patch or checking for a newer
download. The shared action retains that setup-node default; caller-side setup
steps set it explicitly. See [setup-node's cache selection behavior](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md#check-latest-version).
The runtime guard checks major 22; this lane tests supported Node 22 rather than
exact minor-version compatibility. The completed dependency cache remains
configured/restored under Node 24 before switching the test binary.

The shared action has no `registry-url` input. Publication uses caller-side
`actions/setup-node@v7` after strict restoration, with `^24.10.0`,
`check-latest: false`, and `package-manager-cache: false`. Node 24.10.0 bundles
npm 11.6.1, satisfying npm trusted publishing's minimum CLI 11.5.1. This setup
omits `registry-url`, so it does not create an auth-token `.npmrc` or export a
fallback token. The public registry is explicit in `npm publish`, which clears
`NODE_AUTH_TOKEN` and uses OIDC. Only the publishing `build` job grants
`id-token: write`; metadata, dependency installation and docs do not receive that
permission. The cache inputs and Node-major cache keys remain unchanged.
Optional `pnpm run --if-present test:package` remains in CI/publication.

Release metadata is revalidated and registry channels reread immediately before
each publication attempt, including failed-job retries. Docs use the actual
publication channel and follow successful npm publication within the same
workflow-wide lock. Before Pages deployment, they require exact registry latest
equality and remote tag/commit provenance. Manual main docs share the lock and
verify current main/latest ancestry. Maintenance/prerelease channels never
deploy stable docs. Both workflows use `queue: max` and
`cancel-in-progress: false` to preserve up to 100 pending runs.

## Trial evidence and holds

Upstream [run 37236616750](https://github.com/pwrdrvr/configure-nodejs/actions/runs/37236616750)
passed 31 jobs, including pnpm 10.33.0/12.7.0 cross-platform fixtures and strict
negative paths. These validate upstream fixtures, not p-map-iterable workflows.
The prior caller [run 37231686778](https://github.com/shutterstock/p-map-iterable/actions/runs/37231686778)
at `bb08ebe5c611162c8919ab9a602e2805c3d2df5e` validates the deleted interim
wrapper only. Direct-call [run 37238410920](https://github.com/shutterstock/p-map-iterable/actions/runs/37238410920)
passes at `7979f39f5e179735100f60d4834b4965fcb9fc12`: the cold producer installed
on Node 24.21.0/pnpm 12.7.0 and saved the exact completed cache before both
consumers restored it. Each consumer key guard matched the producer output:

```text
completed-node-modules-v1-node24-pnpm-12.7.0-0a6022a6dc096933f92f3c00933396dfc4bbc475f7bbe08a1d8c774766353b54
```

Node 24 and the captured Node 22 each passed all 75 tests/seven suites.
Build, lint, docs, the 26 release/docs guard tests, and required result aggregation
passed. A fresh local frozen/offline caller fixture passed upstream completed
metadata validation; after `npm version`, pnpm ran only its requested Node 24
probe with verification disabled, leaving lock bytes and completed metadata
unchanged. Publication/manual deployment workflows are statically validated;
no npm or Pages publication is performed. Current released-pin CI remains to be
recorded; the old candidate key above is historical because the release SHA
namespaces a fresh cache. See the [upstream handoff](../CONFIGURE-NODEJS-UPSTREAM.md)
for the acceptance contract and historical gap analysis.

Run `node --test .github/scripts/release-metadata.test.cjs
.github/scripts/docs-deployment.test.cjs` and validate all three workflows
against the current [GitHub workflow schema](https://github.com/actions/languageservices/blob/main/workflow-parser/src/workflow-v1.0.json)
and [workflow JSON schema](https://json.schemastore.org/github-workflow.json).
Actionlint 1.7.12 predates `concurrency.queue`: run
`actionlint -ignore 'unexpected key "queue" for "concurrency" section'`, with
that field checked by the current schemas. Remove the narrow ignore when
actionlint supports it.

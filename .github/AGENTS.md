# CI and releases

Read the [root guide](../AGENTS.md). Workflow files live in `workflows/`.
Shared composite actions live in `actions/`.

## Workflows

| File | Trigger | Work |
| --- | --- | --- |
| [ci.yml](workflows/ci.yml) | Push/PR to `main` or `releases/**`. | Populate dependencies, test Node 22, and require successful setup/runtime results in the always-running `build` gate; build/docs/lint/test and eligible coverage. |
| [docs.yml](workflows/docs.yml) | Manual dispatch on `main`. | Build docs after strict restoration; verify current main/latest ancestry before Pages deployment. |
| [publish.yml](workflows/publish.yml) | Published release. | Validate explicit tag/commit/train, populate dependencies, build/test/publish, then deploy eligible latest docs after npm succeeds. |

Publication validates the explicit `release/vX.Y.Z` event tag and full-history
ancestry before dependency work/auth. The selected immutable SHA pins every
downstream checkout. After restoration it materializes that explicit version
with `npm version --no-git-tag-version --ignore-scripts`; it does not use
`from-git`. Source version may be `0.0.0` or the tagged version. Registry channels
are revalidated immediately before every publish attempt, including retries.
Only the final public npm publish step receives `NODE_AUTH_TOKEN`.

Publication and manual docs share `npm-publication`, `queue: max`, and
`cancel-in-progress: false`. Release docs require successful npm publication,
the actual `latest` channel, exact registry latest equality, and validated remote
tag/commit provenance. Maintenance/prerelease channels do not deploy stable
Pages. See [RELEASING.md](RELEASING.md) for train/channel behavior and recovery.

## Shared actions

Workflows call [pwrdrvr/configure-nodejs v1.6.0](https://github.com/pwrdrvr/configure-nodejs/releases/tag/v1.6.0)
directly at `8876dbf3c524c8a765543dae3ae5b55d7b5ecfb3`; no local setup action
remains. Each workflow has one completed-tree populate job and strict consumers.
Cold producers frozen-install, verify unchanged lock/input bytes, and save and
confirm the exact completed cache inline. Warm producers only probe. Consumers
restore exact keys and never install, repair, or save dependencies; every
consumer compares its output key with the producer's.

Use identical key inputs, runner OS/architecture/stable ImageOS, directory,
Node major, exact pnpm pin, action revision, and policy suffix. The key excludes
ImageVersion and populate/restore role. Completed modes do not use lookup-only.
All five consumers keep `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false'`; producers
retain normal verification. Preserve pnpm age 10080 and npm age seven days.

Configure/restore/build/docs/publish with `^24.0.0`; capture the selected
`^22.0.0` binary for Jest/optional package consumers, then restore Node 24 PATH
and tools. Prefer compatible cached versions with check-latest false; validate
major 22, not a specific minor. Publication registry setup is caller-side
setup-node with automatic package-manager caching disabled. See
[the workflow notes](workflows/README.md) for key evidence and checks.

[coverage-report/action.yml](actions/coverage-report/action.yml) parses LCOV,
updates a PR comment, and uploads coverage files. Its
[parser](actions/coverage-report/scripts/parse-coverage.js) emits Markdown.
The CI access check skips this action for fork PRs and Dependabot PRs.
Keep that access check when changing coverage reporting.

Use package scripts for build and test steps. Keep workflow changes focused.
For changes here, check YAML syntax, event conditions, action inputs, cache keys,
artifact paths, and secret access. For parser changes, check Markdown output with
a local LCOV file. Local builds check package behavior; they do not exercise
GitHub event conditions or hosted publishing.

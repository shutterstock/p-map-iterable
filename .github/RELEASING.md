# Releases and maintenance

This follows the release-train process in
[PwrAgent's release runbook](https://github.com/pwrdrvr/PwrAgent/blob/main/docs/desktop-release-runbook.md#release-trains-and-maintenance-branches),
adapted for this npm package's existing `release/v<version>` tags and
`NPMJSORG_PUBLISH_TOKEN` secret.

## Release trains

`main` owns the current major/minor train through candidates, its first stable
release, and subsequent patch releases. Cut `releases/<major>.<minor>` only when
the owner decides to move `main` to a new major/minor train. Use `releases/1.1`,
not `releases/1.1.3`. CI covers pushes and PRs to `main` and `releases/**`.
The required status context remains `build`.

For the 2.x transition, merge the workflow and dependency changes, then publish
and verify the refreshed 1.1.x release from `main`. **Only after that release**
should the owner cut `releases/1.1` from the then-current `main` commit and start
2.x development on `main`. Do not cut the branch from the older
`release/v1.1.2` tag. This workflow change does not create the maintenance branch.

Backport relevant fixes through PRs to their maintenance branch. Release
workflow/action/script fixes are valid backport candidates so older trains can
still publish. The 1.1 train retains CommonJS and `aggregate-error` 3.1.0;
`aggregate-error` 5 is ESM-only and belongs to the planned 2.x migration.

The workflows support future trains without changing their branch filters or
release parser: `release/v2.0.0` can ship from `main`, and after a later train
transition, 2.0 patches can ship from `releases/2.0`. Add corresponding
Dependabot entries when that branch is cut.

## Publishing

1. Merge and validate the intended release commit on `main` or its maintenance
   branch. Builds, dependency installation, documentation, and publishing use
   Node 24 with npm 10.9.4, matching the dependency refresh's validated resolver.
   An additional CI lane installs and builds on Node 24, then runs tests
   on Node 22.13. Both CI lanes and publication run `test:package` when that script
   exists, including the planned 2.x package consumer fixtures.
2. Create a new tag named `release/vX.Y.Z`, or `release/vX.Y.Z-beta.1` for a
   candidate, at that commit. Lightweight and annotated tags are supported.
   Use canonical numeric components without leading zeroes; build metadata
   (`+build`) is not supported. Bare `vX.Y.Z` tags are not this repository's
   release format.
3. Publish a GitHub Release for that existing tag. Select the matching train
   branch as its target. Set the GitHub Pre-release checkbox for a suffixed tag
   and clear it for a stable tag. The `published` event starts package and docs
   workflows; pushing a tag alone does not publish to npm.
4. Inspect the metadata step, the `Package and Publish` run, and the package's
   version and dist-tags on npm. A GitHub Release existing does not establish
   successful npm publication. Never move an already published release tag.

The release job checks out the explicit event tag with full history. Before
installing dependencies or receiving the npm token, it verifies that HEAD is
that tag and that the tagged commit belongs to the matching `releases/X.Y`
branch when it exists, otherwise `main`. Once a train branch exists, tagging a
new main-only change as a patch of that old train fails. GitHub can retain
`target_commitish: main` for existing tags, so ancestry is authoritative; an
explicitly mismatched train or feature branch is rejected.

The checked-in package version can remain `0.0.0`, as it does today, or exactly
match the release tag. Another version fails validation. Publication replaces
that version with the explicit tag version in the runner's manifests, without
commits, tags, or lifecycle scripts. It does not use `npm version from-git`,
which can select an unintended tag. The npm token is supplied through
`NODE_AUTH_TOKEN` only to the final publish step, using the existing secret.

The registry's current `latest` determines the publication channel:

| Release                 | Registry `latest` | npm dist-tag  |
| ----------------------- | ----------------- | ------------- |
| `release/v1.1.3`        | `1.1.2`           | `latest`      |
| `release/v2.0.0`        | `1.1.3`           | `latest`      |
| `release/v1.1.4`        | `2.0.0`           | `release-1.1` |
| `release/v2.0.1`        | `2.1.0`           | `release-2.0` |
| `release/v2.0.0-beta.1` | `1.1.3`           | `next-2.0`    |

A lower stable version stays available by exact version and a train-specific
`release-X.Y` tag; it cannot replace `latest`. Candidates use `next-X.Y` and
cannot replace `latest`. Publish candidates and maintenance patches in order:
these train-specific tags identify the most recently published version on their
channel. Missing/invalid `latest` or registry failures stop the job. Publication
runs are serialized; GitHub concurrency retains one pending run, so inspect and
rerun any replaced pending run if several releases are submitted together.

Docs use the same tag and channel checks, so older stable releases and candidates
do not replace the latest package's Pages documentation. A manual docs dispatch
is allowed on `main` and deliberately publishes the current main documentation.
Package and docs workflows run independently; check both results. This change
does not backfill automation into previously tagged commits, and rerunning a
successful npm publication fails because npm versions are immutable. Live npm
publication was not exercised while validating this workflow change.

## Dependabot and repository settings

The checked-in config schedules npm updates on Monday and GitHub Actions updates
on Tuesday, with separate entries for `main` and `releases/1.1`. Main npm updates
group production and development minor/patch changes; the CJS `aggregate-error`
major upgrade remains blocked until the 2.x migration removes that main-only
ignore. Maintenance npm entries block all major upgrades. GitHub Actions entries
track major action updates because the workflows use floating major tags.

The `releases/1.1` entries become usable only after that branch exists. Dependabot
may report the missing target before the owner cuts it. Repeat both ecosystem
entries with a new `target-branch` when another train becomes maintained.
[GitHub's target-branch setting](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#target-branch)
affects version updates; automated security fixes target the default branch.
Review alerts and backport security fixes to each affected maintenance train.
A target-branch entry does not independently enable maintenance security fixes.

Required settings are managed by the repository owner:

- Keep `NPMJSORG_PUBLISH_TOKEN` available to release workflows, with current npm
  publish permission for `@shutterstock/p-map-iterable`. Secret existence alone
  does not verify validity or package publish access.
- Allow the referenced GitHub Actions. The workflows request read access by
  default, issue/PR write access for the coverage comment, and contents write
  access only for deploying Pages. Configure Pages to serve the existing
  `gh-pages` branch; no Pages hosting migration is included.
- Keep the `build` required check and the existing one approving review on
  `main`; apply the owner's corresponding rules to maintained `releases/*`
  branches. Only the owner cuts trains, merges release PRs, or publishes releases.
- Enable the dependency graph, Dependabot alerts, and automated security fixes.
  The owner confirmed security fixes report `enabled: true, paused: false` during
  this setup. If GitHub later reports `paused: true` even after enabling fixes,
  inspect the pause banner in Settings → Advanced Security → Dependabot or an
  open Dependabot PR and explicitly resume updates. Verify the API state again:
  `gh api repos/shutterstock/p-map-iterable/automated-security-fixes`. Do not infer
  a resumed state merely from a successful enable request. See
  [GitHub's paused-update guidance](https://docs.github.com/en/code-security/dependabot/troubleshooting-dependabot/troubleshooting-dependabot-errors#dependabot-update-pull-requests-no-longer-generated).

## GitHub Actions runtime

The workflows use maintained major refs for checkout v7, setup-node v7, cache v6,
upload-artifact v7, find-comment v4, create-or-update-comment v5, and gh-pages v4.
Their current releases all run on Node 24 inside the Actions runner; this is
independent of the Node 22.13 package runtime test lane. The verified
`ubuntu-latest` CI run used Actions runner 2.337.0, satisfying the documented
[Node 24 minimum of 2.327.1](https://github.com/actions/setup-node/tree/v7#breaking-changes-in-v5)
and checkout's 2.329.0 requirement for authenticated Git commands in Docker
container actions. These workflows use hosted Ubuntu runners and no container
actions for authenticated Git operations.

Setup-node's automatic npm caching is explicitly disabled. The existing
node_modules cache, its Node/npm/OS/architecture/lockfile key, and lookup-only
behavior remain authoritative even if a future manifest declares `packageManager`.

## Local validation

Run `node --test .github/scripts/release-metadata.test.cjs` and `actionlint`.
The metadata tests use disposable Git fixtures inside the assigned workspace to
cover tags, ancestry, version mismatches, train cuts, prerelease flags and npm
channel selection. Neither command publishes a release or changes remote refs.

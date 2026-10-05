---
name: release
description: Prepare, validate, tag, publish, and monitor @shutterstock/p-map-iterable npm releases. Use when the user asks to prepare or publish a release, select a stable or prerelease version, write release notes, check release readiness, or investigate npm publication and release documentation status.
---

# Release

Release `@shutterstock/p-map-iterable` through the `Package and Publish` workflow.
Preparing a release ends with a reviewable version, commit, channel, and notes.
When publication is requested, continue through GitHub Release creation, npm
verification, and the eligible documentation deployment.

## Read First

Read the current repository files before selecting release metadata:

1. [Root guide](../../../AGENTS.md) and [CI guide](../../../.github/AGENTS.md).
2. [Release runbook](../../../.github/RELEASING.md).
3. [Publication workflow](../../../.github/workflows/publish.yml).
4. [Release metadata guard](../../../.github/scripts/release-metadata.cjs).
5. [Documentation deployment guard](../../../.github/scripts/docs-deployment.cjs).
6. [Package manifest](../../../package.json).

Use these files as the authority for current behavior. Check the intended release
commit's workflow and guards as well; changes on `main` do not repair older tags.

## Scope And Release Trains

- Honor the user's requested scope. Readiness checks and preparation do not
  authorize pushing a tag or publishing a GitHub Release. An explicit release
  publication request authorizes those steps for the selected version and commit;
  do not ask again for an already authorized action.
- Keep `main` on its active major/minor train through candidates, the first stable
  release, and follow-up patches. Cut `releases/<major>.<minor>` only when the owner
  explicitly decides to start the next major/minor train on `main`. Use
  `releases/1.1`, without a patch component.
- Cut that branch from the then-current selected `main` commit, which may include
  post-release fixes. A beta-to-stable promotion does not require a maintenance
  branch. After the cut, release that train's candidates and patches from its
  maintenance branch.
- For the documented 1.1-to-2.x transition, first publish and verify the refreshed
  1.1.x release from `main`, then cut `releases/1.1` from the current `main` commit.
  Keep the 1.1 train's CommonJS and `aggregate-error` 3 compatibility intact.
- A major release or breaking behavior needs explicit operator authorization.
  Follow the root compatibility policy when choosing the version.
- Preserve unrelated work. Use a clean release checkout or worktree rather than
  resetting, stashing, or committing another task's changes.
- Never move or overwrite an existing release tag, force-push a release branch,
  or bypass the repository's review and required-check rules.

## Preflight And Notes

Fetch current branches and tags with full history before planning:

```bash
git fetch origin --prune --tags
git rev-parse --is-shallow-repository
gh release list --repo shutterstock/p-map-iterable --limit 10
npm view @shutterstock/p-map-iterable dist-tags --json --registry=https://registry.npmjs.org/
```

If the checkout is shallow, fetch the missing history. Ensure matching maintenance
branches are available as `origin/releases/X.Y`; their existence changes the
ancestry check. Registry or GitHub access failures are blockers, not evidence that
a version, branch, or tag is absent.

Choose the requested version, release branch, and full landed commit SHA. Verify
that the commit belongs to `origin/<release-branch>` and that required `build`
checks passed for it. Land any necessary changes through a PR targeting that
branch and use the actual merged commit, rather than assuming the PR's source SHA
is the release commit. Honor the required approving review and owner merge policy.

Before creating a tag, check local tags, remote tags, GitHub Releases, and the npm
version for collisions. Inspect existing state instead of treating a duplicate as
a reason to delete or recreate a release. Use canonical SemVer without leading
zeroes or `+build` metadata:

- Stable: `release/vX.Y.Z`.
- Candidate: `release/vX.Y.Z-beta.1` or another valid prerelease suffix.

Keep the checked-in `package.json` version at `0.0.0` under the existing convention.
The guard also accepts an exact match to the selected tag version, but rejects any
other version. CI materializes the explicit version after restoring dependencies
with `npm version --no-git-tag-version --ignore-scripts`. Do not introduce a source
version bump or use `npm version from-git` as part of ordinary release preparation.

Review merged PRs and direct commits since the previous relevant release on the
same train. Write final notes in a temporary file outside tracked package output;
the repository currently has no required changelog file. Start each bullet with
the library surface, then describe the change and its effect on callers:

```markdown
- Mapping queues - Added a public alias that makes background mapping examples easier to follow.
- Error handling - Fixed cleanup after a failed callback so consumers can finish draining results.
- Minor - Updated development dependencies and release tooling.
```

These illustrate wording, not claims about the pending release. Include relevant
PR links, compatibility or migration information, and the comparison URL. Review
GitHub-generated notes if useful, then rewrite them into accurate user-facing notes
before publication.

## Select The npm Channel

Use `selectNpmTag` in the metadata guard and the public registry's current
`dist-tags`. The checked-in source version does not determine the channel.

| Selected version | Compared with registry `latest` | npm channel |
| --- | --- | --- |
| Stable `X.Y.Z` | Higher | `latest` |
| Stable `X.Y.Z` | Lower | `release-X.Y` |
| Prerelease `X.Y.Z-suffix` | Any valid stable latest | `next-X.Y` |

Missing, invalid, or prerelease `latest` blocks publication. An equal version
selects `latest` in the guard but normally indicates an already published immutable
version; investigate before proceeding. Publish maintenance patches and candidates
in order because their train channels track the most recently published version.
Never manually retag npm to bypass channel selection. CI rereads the registry
immediately before each publication attempt, so record the actual final channel.

## Validate And Create The Local Tag

Use Node.js 24 and the manifest's pinned pnpm version. Preserve the frozen lockfile
and the workspace's seven-day dependency age policy. Run the release gates on the
selected commit, including relevant tests first if source changed:

```bash
pnpm install --frozen-lockfile
node --test .github/scripts/release-metadata.test.cjs .github/scripts/docs-deployment.test.cjs
pnpm run build
pnpm run build:docs
pnpm run lint
pnpm run test
pnpm run --if-present test:package
```

Require the CI Node 22 runtime lane as part of `build`; local Node 24 checks do not
replace it. Keep generated `dist/`, `docs/`, and coverage out of commits. Check
readiness of the existing `NPMJSORG_PUBLISH_TOKEN` by inspecting secret names only;
existence does not prove validity or package publish permission. Never print secret
values or supply the publication token to a preflight command.

Set these variables to the reviewed values in the clean release checkout:

```bash
export RELEASE_VERSION='<version>'
export RELEASE_BRANCH='<main-or-releases/X.Y>'
export RELEASE_COMMIT='<full-landed-commit-sha>'
export RELEASE_TAG="release/v$RELEASE_VERSION"
export RELEASE_NOTES='<absolute-path-to-reviewed-notes>'
```

After publication has been requested, create a new local tag on that exact commit.
Honor configured signing; do not bypass a signing failure. Both lightweight and
annotated tags are supported. For an annotated tag:

```bash
git switch --detach "$RELEASE_COMMIT"
git merge-base --is-ancestor "$RELEASE_COMMIT" "origin/$RELEASE_BRANCH"
git tag -a "$RELEASE_TAG" "$RELEASE_COMMIT" -m "$RELEASE_TAG"
```

Before pushing, run the actual metadata validator on the tagged checkout. It
requires HEAD at the tag, the correct package name/version, full history, and
matching train ancestry. The GitHub prerelease flag must match the SemVer suffix:

```bash
node <<'NODE'
const { readFileSync } = require('node:fs');
const { parseTag, validateRelease } = require('./.github/scripts/release-metadata.cjs');
const release = validateRelease({
  tag: process.env.RELEASE_TAG,
  prerelease: Boolean(parseTag(process.env.RELEASE_TAG).prerelease),
  target: process.env.RELEASE_BRANCH,
  manifest: JSON.parse(readFileSync('package.json', 'utf8')),
});
console.log(`Validated ${release.version} on ${release.branch} at ${release.commit}`);
NODE
```

If the guard fails, resolve its cause before any remote publication. Do not create
a maintenance branch merely to make validation pass.

## Publish

Push only the selected tag and verify its remote commit matches the reviewed SHA:

```bash
git push origin "refs/tags/$RELEASE_TAG"
git ls-remote --tags origin "refs/tags/$RELEASE_TAG" "refs/tags/$RELEASE_TAG^{}"
```

For annotated tags, compare the peeled `^{}` SHA; for lightweight tags, compare the
tag ref SHA. A tag push alone does not publish this package. Creating a published
GitHub Release triggers `publish.yml` through `release: published`; there is no
manual publication dispatch in the current workflow.

For a stable version, publish with the reviewed notes and no prerelease flag:

```bash
gh release create "$RELEASE_TAG" --repo shutterstock/p-map-iterable \
  --verify-tag --target "$RELEASE_BRANCH" --title "v$RELEASE_VERSION" \
  --notes-file "$RELEASE_NOTES"
```

For a suffixed version, add `--prerelease --latest=false`. For an older stable
maintenance release, add `--latest=false` to preserve GitHub's newest stable
Latest release. GitHub Latest and npm's `latest` dist-tag are separate settings.
Do not mark a stable version as GitHub Pre-release: the metadata guard rejects
that mismatch. `--verify-tag` prevents accidental tag creation on a different SHA.

## Monitor And Verify

Find the `Package and Publish` run and record its ID and URL:

```bash
gh run list --repo shutterstock/p-map-iterable --workflow publish.yml \
  --event release --limit 10 \
  --json databaseId,headSha,headBranch,status,conclusion,url
export RELEASE_RUN_ID='<selected-run-id>'
gh run view "$RELEASE_RUN_ID" --repo shutterstock/p-map-iterable --json status,conclusion,jobs,url
```

Correlate the run with the selected tag, validated commit, and publication time.
Poll at intervals that allow progress updates; a queued run or approval gate is
an intermediate state. Continue until publication and eligible docs have finished.
On failure, inspect `gh run view "$RELEASE_RUN_ID" --log-failed` and identify the
failed job.

After publication, read back the release body and flags, the exact registry
version, and the channels:

```bash
gh release view "$RELEASE_TAG" --repo shutterstock/p-map-iterable \
  --json tagName,name,body,isDraft,isPrerelease,url
npm view "@shutterstock/p-map-iterable@$RELEASE_VERSION" version dist.tarball dist.integrity \
  --json --registry=https://registry.npmjs.org/
npm view @shutterstock/p-map-iterable dist-tags --json --registry=https://registry.npmjs.org/
```

Require a nonempty body matching the reviewed notes, `isDraft=false`, the correct
prerelease flag, an accessible exact npm version, and the expected actual channel.
A GitHub Release or successful metadata job alone does not prove npm publication.

Docs deploy only after npm publication on `latest`, and only while public npm
`latest` still exactly equals this version and tag provenance remains valid. A
maintenance or prerelease docs skip is expected. A superseded latest release may
also skip deployment; verify that reason rather than calling it a failure.

## Recovery And Handoff

Check registry state before retrying a failed publication: npm may have accepted
the version even if the job reported failure. Never rerun a successful npm publish;
versions are immutable. If the version is absent and a correctable failure is
resolved, retry failed jobs once with `gh run rerun "$RELEASE_RUN_ID" --failed`, then
verify the new result. Stop on a repeated failure with the precise blocker and next
action.
Do not delete releases, rewrite tags, or unpublish packages as recovery shortcuts.

If npm succeeded and only docs failed, rerun only the failed docs job. An authorized
manual `docs.yml` dispatch from `main` is another option when the current registry
latest tag belongs to main's history; follow the documentation guard and runbook.
Do not rerun the entire publication workflow to repair documentation.

Report the version, tag, full commit, source branch, release URL, run URL, actual
npm channel, registry verification, and docs outcome. For preparation-only work,
hand off the reviewed notes and exact proposed publication command. Keep any
failure, pending review, or external gate explicit with its next action; claim
completion only for outcomes verified remotely.

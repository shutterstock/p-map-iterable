# CI and releases

Read the [root guide](../AGENTS.md). Workflow files live in `workflows/`.
Shared composite actions live in `actions/`.

## Workflows

| File | Trigger | Work |
| --- | --- | --- |
| [ci.yml](workflows/ci.yml) | Push to `main`; PR against `main`. | Build code and API docs. Run lint and tests. Report coverage for eligible PRs. |
| [docs.yml](workflows/docs.yml) | Published release; manual dispatch. | Build API docs. Deploy `docs/` to GitHub Pages. |
| [publish.yml](workflows/publish.yml) | Published release. | Read the version from the Git tag. Build, lint, test, and publish to npm. |

The publish workflow uses `npm version from-git` without creating a Git tag.
It publishes with public access and `--ignore-scripts`. The checked-in package
version is `0.0.0`; the release workflow sets the version for publication.
Check package metadata and release triggers together when changing this path.

## Shared actions

[configure-nodejs/action.yml](actions/configure-nodejs/action.yml) selects Node.js
24 by default. It restores `node_modules` from cache or runs `npm ci`. The cache
key includes Node.js version, OS, architecture, package manifests, and lockfiles.
Keep these inputs aligned with the install method. The `install-deps` jobs use
`lookup-only` to check for a cache entry. The build jobs restore dependencies.

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

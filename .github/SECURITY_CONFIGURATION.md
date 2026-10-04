# GitHub security configuration

This repository is public. Dependabot, dependency review, CodeQL, secret
scanning, push protection, and private vulnerability reporting are available
without a paid security license. The workflows use standard `ubuntu-latest`
runners, which are free for public repositories.

## Repository settings

GitHub settings are separate from the files in this repository. Maintain these
settings under **Settings > Security**:

| Setting | Value |
| --- | --- |
| Dependency graph | Enabled |
| Dependabot alerts | Enabled |
| Dependabot security updates | Enabled |
| Private vulnerability reporting | Enabled |
| Secret scanning | Enabled |
| Secret scanning push protection | Enabled |
| Code scanning | Advanced setup using `workflows/codeql.yml` |

After the workflow changes merge, set **Settings > Actions > General > Workflow
permissions** to **Read repository contents and packages permissions**. Keep
**Allow GitHub Actions to create and approve pull requests** disabled. Each
workflow declares its permissions: coverage comments need `pull-requests:
write`, documentation deployment needs `contents: write`, and CodeQL needs
`security-events: write`.

The existing branch protection requires `build`. After the new workflows have
run successfully, also require `dependency-review`,
`Analyze (javascript-typescript)`, and `Analyze (actions)` on `main` to make
their failures block merging.

## Update and review policy

Dependabot checks npm packages on Mondays and Actions on Tuesdays. Normal
updates have a seven-day cooldown; npm majors have fourteen days and individual
PRs. Minor and patch updates are grouped by production/development dependencies
or Actions. Security fixes bypass the cooldown and use a separate npm group.
There is no automatic merge policy.

External actions are pinned to complete commit hashes. Dependabot must continue
to propose minor and patch updates because those hashes do not move when an
upstream release tag changes.
The Actions update configuration explicitly includes both local composite-action
directories in addition to the root workflow scan. Add any new composite-action
directory to the same list so its pinned dependencies also receive updates.

Dependency review fails on newly introduced high or critical vulnerabilities
in runtime, development, or unknown dependency scopes. It does not replace
Dependabot alerts for vulnerabilities discovered in existing dependencies.

The same check enforces a license allowlist on added or updated direct and
transitive dependencies, including development tools. It uses GitHub's
dependency graph, populated from package manifests and lockfiles; no separate
package/version approval inventory is needed. Disallowed, invalid, and missing
licenses fail the check. SPDX expressions such as `MIT OR CC0-1.0` are supported:
an `OR` needs one allowed option, while an `AND` needs all licenses allowed.

The allowlist is declared in `workflows/dependency-review.yml`. It follows the
Pwr apps' list and includes `CC-BY-4.0` for the existing `caniuse-lite` browser
data. Changes to this license policy require review. This checks declared
metadata rather than analyzing license text in every installed file.

CodeQL scans TypeScript/JavaScript and Actions on PRs, pushes to `main`, and
weekly schedules. Both checks run on ordinary `pull_request` events so fork and
Dependabot PRs can be checked without exposing release secrets.

## GitHub documentation

- [Security feature availability](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security)
- [Dependabot configuration](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
- [Dependency review action availability and configuration](https://github.com/actions/dependency-review-action)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/about-privately-reporting-a-security-vulnerability)

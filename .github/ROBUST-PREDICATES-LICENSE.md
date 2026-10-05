# Reviewed license exception: robust-predicates 3.0.3

The sole exception is `pkg:npm/robust-predicates@3.0.3`. Dependency review reports
`LicenseRef-scancode-public-domain AND Unlicense` for this Mermaid development
dependency. The custom classifier is outside the general allowlist; it is not
added to that list.

## Published artifact and inherited notices

The [npm registry metadata](https://registry.npmjs.org/robust-predicates/3.0.3)
declares `Unlicense`. The exact
[published tarball](https://registry.npmjs.org/robust-predicates/-/robust-predicates-3.0.3.tgz)
was extracted and reviewed after verifying both registry integrity hashes:

```text
sha512-NS3levdsRIUOmiJ8FZWCP7LG3QpJyrs/TE0Zpf1yvZu8cAJJ6QMW92H1c7kWpdIHo8RvmLxN/o2JXTKHp74lUA==
sha1: 1099061b3349e2c5abec6c2ab0acd440d24d4062
```

The tarball's `package.json` declares `Unlicense`, its `LICENSE` is byte-identical
to the tagged Unlicense dedication, and its README identifies the code as a port of Jonathan
Richard Shewchuk's public-domain implementation. The [tagged LICENSE](https://github.com/mourner/robust-predicates/blob/v3.0.3/LICENSE)
and [README](https://github.com/mourner/robust-predicates/blob/v3.0.3/README.md)
provide corresponding publisher sources.

The inherited implementation is independently covered by Shewchuk's
[primary software page](https://www.cs.cmu.edu/~quake/robust.html), which identifies
the predicates code as public domain. The header of the linked
[`predicates.c`](https://www.cs.cmu.edu/afs/cs/project/quake/public/code/predicates.c)
also records his public-domain dedication. This evidence supports the existing
allowlist's acceptance of `Unlicense`; it does not approve other custom license
classifiers or the separately copyrighted Triangle program.

## Enforcement

The pinned dependency-review action's
[`purlsMatch`](https://github.com/actions/dependency-review-action/blob/a1d282b36b6f3519aa1f3fc636f609c47dddb294/src/purl.ts)
ignores versions, and its
[license filter](https://github.com/actions/dependency-review-action/blob/a1d282b36b6f3519aa1f3fc636f609c47dddb294/src/licenses.ts)
uses that matcher. The bundled `dist/index.js` at the same commit was also
checked. An exact-version PURL alone would therefore exempt every version of
this package and omit its missing-license metadata from the normal report.

An additional workflow guard closes that gap. Every added or updated matching
package must have the canonical PURL `pkg:npm/robust-predicates@3.0.3`, version
`3.0.3`, and either `Unlicense` or the observed
`LicenseRef-scancode-public-domain AND Unlicense` declaration. Missing metadata,
other declarations, alternative spellings, and other versions fail. Removed
dependencies do not need an exception. Other packages retain the default
allowlist and missing-metadata guard.

Future robust-predicates updates require another review or removal of this
exception; even an otherwise allowlisted declaration cannot use this bypass
at another version. Vulnerability checking still covers all dependency scopes
at high/critical severity. Its action reference and settings are unchanged.

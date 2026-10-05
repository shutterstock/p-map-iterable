# Repository guide

`@shutterstock/p-map-iterable` maps inputs with concurrent callbacks and streams
results. It also provides queues for background work. Backpressure slows a
producer when the consumer falls behind.

## Start here

Read this file first. Then read the local guide for the area you will change.
The root rules apply in all directories.

| Area | Guide | Contents |
| --- | --- | --- |
| Library and tests | [src/AGENTS.md](src/AGENTS.md) | Public classes, limits, lifecycle, and test methods. |
| Usage examples | [examples/AGENTS.md](examples/AGENTS.md) | Example selection, commands, and safe usage patterns. |
| CI and releases | [.github/AGENTS.md](.github/AGENTS.md) | Workflow triggers, shared actions, and release steps. |

Use [README.md](README.md) for user-facing examples. Use
[src/index.ts](src/index.ts) to check public exports. Keep these guides aligned
with the code when contracts or commands change.

## Backwards compatibility

- Always preserve backwards compatibility. Keep disruption to existing users
  and use cases to a minimum. Make breaking or major changes only with explicit
  operator authorization.
- Treat behavior and defaults as compatibility contracts alongside exported APIs
  and types. Preserve admission and backpressure, ordering and concurrency, error
  behavior, and lifecycle semantics.
- Prefer additive, opt-in features and preserve existing defaults.
- Before pursuing a breaking change, explain its compatibility impact and
  recommend reserving it for a major version update. An ambiguous feature request
  does not authorize breaking existing behavior.
- Routine compatible changes do not require additional approval under this
  policy.

## Local work

Use Node.js 24 for development and CI tooling. [.nvmrc](.nvmrc) selects Node.js 24.
CI also tests the library on a cached compatible Node.js 22 version; exact minor
versions are not required. Installation, compilation, docs, and publication use
the Node.js 24 toolchain.

Use pnpm 12.7.0, pinned by `packageManager` in [package.json](package.json), with
the checked-in [pnpm-lock.yaml](pnpm-lock.yaml). Enable pnpm through Corepack with
`corepack enable pnpm` and `corepack prepare pnpm@12.7.0 --activate`.
[pnpm-workspace.yaml](pnpm-workspace.yaml) keeps a seven-day minimum release age
and prefers APFS copy-on-write imports, with hard-link/copy fallback elsewhere.
Preserve its installation policy and the single-document v9 lockfile.

| Command | Purpose |
| --- | --- |
| `pnpm install --frozen-lockfile` | Install the locked dependencies. |
| `pnpm run build` | Compile TypeScript and prepare package output in `dist/`. |
| `pnpm run build:docs` | Generate API docs from `src/index.ts` in `docs/`. |
| `pnpm run lint` | Check source style and promise handling. |
| `pnpm run test` | Run the Jest suite and collect coverage. |
| `pnpm run test:package` | Install one real npm pack tarball in independent CJS/ESM consumers; check types, runtime, contents, and identity. |

For code changes, run the relevant tests first. Then run the build, docs build,
lint, and full test suite before handoff. For documentation-only changes, check
the facts, links, and diff. No new tests are needed solely for documentation.

The compiler uses strict TypeScript, Node16 modules, and an ES2018 target.
The 2.x package uses canonical CommonJS `dist/index.js` with `dist/index.d.ts`,
and native ESM facade `dist/index.mjs` with `dist/index.d.mts`.
Conditional exports select the matching runtime and declarations. The library
supports Node.js >=22; `PACKAGE_TEST_NODE` selects a consumer runtime while
packing and compilation stay on the Node.js 24 toolchain.
Read [package.json](package.json), [tsconfig.json](tsconfig.json), and
[eslint.config.cjs](eslint.config.cjs) before changing build or package behavior.
Use two spaces, single quotes, semicolons, and trailing commas in TypeScript.
[.prettierrc](.prettierrc) sets a print width of 100.

Edit source files. Do not commit generated `dist/`, `docs/`, `coverage/`,
`node_modules/`, or `*.tsbuildinfo` files. Keep each change focused on the task.

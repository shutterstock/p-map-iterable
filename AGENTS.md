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

Use Node.js 24 to match CI. [.nvmrc](.nvmrc) still selects Node.js 18.
Use npm with the checked-in [package-lock.json](package-lock.json).

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the locked dependencies. |
| `npm run build` | Compile TypeScript and prepare package output in `dist/`. |
| `npm run build:docs` | Generate API docs from `src/index.ts` in `docs/`. |
| `npm run lint` | Check source style and promise handling. |
| `npm test` | Run the Jest suite and collect coverage. |

For code changes, run the relevant tests first. Then run the build, docs build,
lint, and full test suite before handoff. For documentation-only changes, check
the facts, links, and diff. No new tests are needed solely for documentation.

The compiler uses strict TypeScript, Node16 modules, and an ES2018 target.
The package entry points are `dist/src/index.js` and `dist/src/index.d.ts`.
Read [package.json](package.json), [tsconfig.json](tsconfig.json), and
[eslint.config.cjs](eslint.config.cjs) before changing build or package behavior.
Use two spaces, single quotes, semicolons, and trailing commas in TypeScript.
[.prettierrc](.prettierrc) sets a print width of 100.

Edit source files. Do not commit generated `dist/`, `docs/`, `coverage/`,
`node_modules/`, or `*.tsbuildinfo` files. Keep each change focused on the task.

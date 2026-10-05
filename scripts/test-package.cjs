const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { join, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const compiler = process.env.PACKAGE_TEST_TSC || require.resolve('typescript/bin/tsc');
const runtimeNode = process.env.PACKAGE_TEST_NODE || process.execPath;
const temporary = mkdtempSync(join(root, '.package-tests-'));
const packageName = '@shutterstock/p-map-iterable';
const classTypes = {
  BlockingQueue: '<number>',
  IterableMapper: '<number, number>',
  ConcurrentMapper: '<number, number>',
  IterableQueue: '<number>',
  IterableQueueMapper: '<number, number>',
  MappingQueue: '<number, number>',
  IterableQueueMapperSimple: '<number>',
  WorkerQueue: '<number>',
  Queue: '<number>',
  TaskQueue: '',
  QueueFullError: '',
  QueueClosedError: '',
  TaskCancelledError: '',
};
const symbols = Object.keys(classTypes).sort();

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    process.stderr.write(error.stdout || '');
    process.stderr.write(error.stderr || '');
    throw error;
  }
}

try {
  console.log(
    `Toolchain Node ${process.version}; runtime Node ${run(runtimeNode, ['--version'], root).trim()}; ${run(process.execPath, [compiler, '--version'], root).trim()}`,
  );
  // prepack must rebuild from a clean directory, even after an older build.
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist', 'stale.js'), 'throw new Error("stale build");');
  const [pack] = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', temporary], root));
  const tarball = join(temporary, pack.filename);
  const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
  assert.equal(integrity, pack.integrity);

  const modules = [
    'index',
    'blocking-queue',
    'iterable-mapper',
    'iterable-queue',
    'iterable-queue-mapper',
    'iterable-queue-mapper-simple',
    'queue',
    'task-queue',
  ];
  const expected = [
    'LICENSE.md',
    'README.md',
    'package.json',
    'dist/index.mjs',
    'dist/index.d.mts',
    ...modules.flatMap((name) => [`dist/${name}.js`, `dist/${name}.d.ts`]),
  ].sort();
  assert.deepEqual(pack.files.map(({ path }) => path).sort(), expected);
  console.log(`PASS pack: ${pack.files.length} files, clean build, ${integrity}`);

  const help = run(process.execPath, [compiler, '--help', '--all'], root);
  const nodeModes = ['node16', 'node18', 'node20', 'nodenext'].filter((mode) =>
    new RegExp(`\\b${mode}\\b`, 'i').test(help),
  );
  assert(nodeModes.includes('nodenext'));
  const installed = [];
  for (const kind of ['cjs', 'esm']) {
    const app = join(temporary, kind);
    cpSync(join(root, 'tests', 'package', kind), app, { recursive: true });
    run(
      npm,
      [
        'install',
        '--include=dev',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--save-exact',
        tarball,
      ],
      app,
    );
    const packageRoot = join(app, 'node_modules', packageName);
    assert(!lstatSync(packageRoot).isSymbolicLink(), 'Consumer must install a tarball, not a link');
    const lock = JSON.parse(readFileSync(join(app, 'package-lock.json'), 'utf8'));
    const entry = lock.packages[`node_modules/${packageName}`];
    assert.equal(entry.integrity, integrity);
    assert(entry.resolved.endsWith(pack.filename));
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    const nodeTypes = JSON.parse(
      readFileSync(join(app, 'node_modules/@types/node/package.json'), 'utf8'),
    );
    assert.match(nodeTypes.version, /^22\./);
    assert.equal(manifest.type, 'commonjs');
    assert.equal(manifest.engines.node, '>=22');
    assert.deepEqual(manifest.dependencies || {}, {}, 'Runtime dependencies must remain empty');
    assert.deepEqual(
      manifest.peerDependencies || {},
      {},
      'Runtime peer dependencies must remain empty',
    );
    assert.deepEqual(Object.keys(manifest.exports['.'].import), ['types', 'default']);
    assert.deepEqual(Object.keys(manifest.exports['.'].require), ['types', 'default']);
    for (const entrypoint of [
      manifest.main,
      manifest.types,
      manifest.exports['.'].default,
      ...Object.values(manifest.exports['.'].import),
      ...Object.values(manifest.exports['.'].require),
    ])
      assert(lstatSync(join(packageRoot, entrypoint)).isFile());
    const nativeEntry = readFileSync(join(packageRoot, 'dist/index.mjs'), 'utf8');
    assert.match(nativeEntry, /\bimport\b/);
    assert.match(nativeEntry, /\bexport\b/);
    assert.doesNotMatch(nativeEntry, /\brequire\(/);
    installed.push({ resolved: entry.resolved, integrity: entry.integrity });

    const modes = nodeModes.map((module) => [
      module,
      module === 'nodenext' ? 'nodenext' : 'node16',
    ]);
    if (kind === 'esm') modes.push(['esnext', 'bundler']);
    const source = `consumer.${kind === 'cjs' ? 'cts' : 'mts'}`;
    const profiles = [
      { name: 'default-libs', types: [] },
      { name: 'node22-only', lib: ['es2021'], types: ['node'] },
    ];
    for (const [module, moduleResolution] of modes) {
      for (const profile of profiles) {
        const output = `${module}-${moduleResolution}-${profile.name}`;
        writeFileSync(
          join(app, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              module,
              moduleResolution,
              target: 'es2021',
              strict: true,
              skipLibCheck: false,
              lib: profile.lib,
              types: profile.types,
              outDir: output,
            },
            files: [source],
          }),
        );
        const trace = run(
          process.execPath,
          [compiler, '-p', 'tsconfig.json', '--traceResolution', '--listFiles'],
          app,
        );
        const resolution = trace
          .split('\n')
          .find((line) =>
            line.includes(`Module name '${packageName}' was successfully resolved to`),
          );
        assert(resolution, 'Compiler must report the consumer package resolution');
        assert(
          resolution.includes(`/dist/index.${kind === 'cjs' ? 'd.ts' : 'd.mts'}'`),
          resolution,
        );
        if (profile.name === 'node22-only') {
          assert(trace.includes(`${app}/node_modules/@types/node/index.d.ts`));
          assert.doesNotMatch(trace, /\/lib\.dom[^/]*\.d\.ts\s*$/m);
        }
        const runtime = join(output, `consumer.${kind === 'cjs' ? 'cjs' : 'mjs'}`);
        const emitted = readFileSync(join(app, runtime), 'utf8');
        if (kind === 'cjs') assert.match(emitted, /\brequire\(/);
        else {
          assert.match(emitted, /\bimport\b/);
          assert.doesNotMatch(emitted, /\brequire\(/);
        }
        assert.equal(run(runtimeNode, [runtime], app).trim(), 'consumer completed');
        console.log(
          `PASS ${kind}: ${module}/${moduleResolution} ${profile.name}, declarations + runtime (public APIs + native errors)`,
        );
      }
    }
  }
  assert.deepEqual(installed[0], installed[1], 'Both apps must install the SAME tarball');

  // A separate mixed-loader probe verifies identities without weakening either
  // consumer's module-only source. It uses the ESM app's installed tarball.
  run(
    runtimeNode,
    [
      '--input-type=module',
      '--eval',
      `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { sep } from 'node:path';
    import * as esm from '${packageName}';
    const require = createRequire(import.meta.url);
    const cjs = require('${packageName}');
    const names = ${JSON.stringify(symbols)};
    assert.deepEqual(Object.keys(cjs).sort(), names);
    assert.deepEqual(Object.keys(esm).filter(name => name !== 'default').sort(), names);
    assert.equal(esm.default, cjs);
    for (const name of names) assert.equal(esm[name], cjs[name]);
    assert(new esm.Queue() instanceof cjs.Queue);
    assert(new cjs.Queue() instanceof esm.Queue);
    assert(new esm.TaskQueue() instanceof cjs.TaskQueue);
    assert(new cjs.TaskQueue() instanceof esm.TaskQueue);
    for (const name of ['QueueFullError', 'QueueClosedError', 'TaskCancelledError']) {
      assert(new esm[name]() instanceof cjs[name]);
      assert(new cjs[name]() instanceof esm[name]);
    }
    assert(require.resolve('${packageName}').endsWith(['dist', 'index.js'].join(sep)));
    assert(import.meta.resolve('${packageName}').endsWith('/dist/index.mjs'));
    assert.throws(() => require('${packageName}/dist/index.js'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  `,
    ],
    join(temporary, 'esm'),
  );
  console.log(
    `PASS parity: same tarball, ${symbols.length} shared constructor exports, default export, conditional entrypoints, private paths`,
  );

  const identityApp = join(temporary, 'esm');
  writeFileSync(
    join(identityApp, 'identity.mts'),
    [
      `import cjs = require('${packageName}');`,
      `import { ${symbols.join(', ')} } from '${packageName}';`,
      ...symbols.flatMap((name) => {
        const parameters = classTypes[name];
        return [
          `declare const cjs${name}: cjs.${name}${parameters};`,
          `declare const esm${name}: ${name}${parameters};`,
          `const acceptsCjs${name}: cjs.${name}${parameters} = esm${name};`,
          `const acceptsEsm${name}: ${name}${parameters} = cjs${name};`,
        ];
      }),
    ].join('\n'),
  );
  writeFileSync(
    join(identityApp, 'tsconfig.identity.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'es2021',
        strict: true,
        skipLibCheck: false,
        lib: ['es2021'],
        types: ['node'],
        noEmit: true,
      },
      files: ['identity.mts'],
    }),
  );
  run(process.execPath, [compiler, '-p', 'tsconfig.identity.json'], identityApp);
  console.log(
    `PASS type identity: all ${symbols.length} CJS/ESM class types assignable in both directions`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

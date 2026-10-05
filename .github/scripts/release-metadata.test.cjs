const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { resolve, join } = require('node:path');
const { test } = require('node:test');
const { parseTag, selectNpmTag, validateRelease } = require('./release-metadata.cjs');

const manifest = { name: '@shutterstock/p-map-iterable', version: '0.0.0' };

test('accepts existing tags and future stable and prerelease trains', () => {
  for (const version of ['1.1.2', '1.1.3', '2.0.0', '2.1.4', '2.0.0-beta.1', '2.0.0-0']) {
    assert.equal(parseTag(`release/v${version}`).version, version);
  }
});

test('rejects malformed and ambiguous release tags', () => {
  assert.throws(() => parseTag('release/v2.0.0' + String.fromCharCode(10)), /Invalid version/);
  for (const tag of [
    'v1.1.3',
    '1.1.3',
    'release/v1.1',
    'release/v01.1.3',
    'release/v1.01.3',
    'release/v1.1.03',
    'release/v2.0.0-beta.01',
    'release/v2.0.0-',
    'release/v2.0.0+build.1',
    'release/v2.0.0\n',
    'release/v$(echo bad)',
  ]) {
    assert.throws(() => parseTag(tag), /Release tag|Invalid version/);
  }
});

test('stable channels compare numeric versions and preserve a newer latest', () => {
  for (const [version, latest, expected] of [
    ['1.1.3', '1.1.2', 'latest'],
    ['1.1.3', '1.1.3', 'latest'],
    ['1.1.4', '2.0.0', 'release-1.1'],
    ['1.1.4', '1.2.0', 'release-1.1'],
    ['1.1.3', '1.1.4', 'release-1.1'],
    ['2.0.0', '1.1.4', 'latest'],
    ['2.1.4', '2.2.0', 'release-2.1'],
    ['1.1.10', '1.1.9', 'latest'],
    ['10.0.0', '2.0.0', 'latest'],
  ]) {
    assert.equal(selectNpmTag(parseTag(`release/v${version}`), { latest }), expected);
  }
});

test('prereleases use a train-specific channel without changing latest', () => {
  assert.equal(selectNpmTag(parseTag('release/v2.0.0-beta.1'), { latest: '1.1.3' }), 'next-2.0');
  assert.equal(selectNpmTag(parseTag('release/v1.1.5-rc.1'), { latest: '2.0.0' }), 'next-1.1');
});

test('missing or invalid registry latest fails closed', () => {
  for (const latest of [undefined, null, '', 'garbage', '2.0.0-beta.1']) {
    assert.throws(() => selectNpmTag(parseTag('release/v1.1.3'), { latest }));
  }
});

function fixture(t) {
  // Keep test repositories in the assigned runtime workspace, never another worktree.
  const cwd = mkdtempSync(join(resolve(__dirname, '../..'), '.release-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Release tests');
  git('config', 'user.email', 'release-tests@example.invalid');
  // Fixtures should not inherit signing or hook requirements from global Git config.
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  let sequence = 0;
  const commit = () => {
    writeFileSync(join(cwd, 'fixture.txt'), String(++sequence));
    git('add', 'fixture.txt');
    git('commit', '-m', `Fixture ${sequence}`);
    return git('rev-parse', 'HEAD');
  };
  const initial = commit();
  git('update-ref', 'refs/remotes/origin/main', initial);
  git('tag', 'release/v1.1.3');
  const validate = (overrides = {}) =>
    validateRelease({
      tag: 'release/v1.1.3',
      prerelease: false,
      target: 'main',
      manifest,
      cwd,
      ...overrides,
    });
  return { cwd, git, initial, commit, validate };
}

test('current train publishes on main before a maintenance branch exists', (t) => {
  const repo = fixture(t);
  assert.equal(repo.validate().branch, 'main');
  assert.equal(repo.validate({ manifest: { ...manifest, version: '1.1.3' } }).version, '1.1.3');
  assert.equal(repo.validate({ target: repo.initial }).branch, 'main');
  assert.throws(() => repo.validate({ target: 'releases/1.1' }), /has not been cut/);
});

test('maintenance tags use their train after main advances, including retained main metadata', (t) => {
  const repo = fixture(t);
  repo.git('update-ref', 'refs/remotes/origin/releases/1.1', repo.initial);
  repo.git('switch', '-c', 'maintenance');
  const maintenanceCommit = repo.commit();
  repo.git('tag', 'release/v1.1.4');
  repo.git('update-ref', 'refs/remotes/origin/releases/1.1', maintenanceCommit);
  repo.git('switch', 'main');
  repo.git('update-ref', 'refs/remotes/origin/main', repo.commit());
  repo.git('checkout', '--detach', 'release/v1.1.4');
  assert.equal(
    repo.validate({ tag: 'release/v1.1.4', target: 'releases/1.1' }).branch,
    'releases/1.1',
  );
  assert.equal(repo.validate({ tag: 'release/v1.1.4' }).branch, 'releases/1.1');
});

test('future 2.x trains work on main and on matching maintenance branches', (t) => {
  const repo = fixture(t);
  repo.git('tag', 'release/v2.1.4');
  assert.equal(repo.validate({ tag: 'release/v2.1.4' }).branch, 'main');
  repo.git('update-ref', 'refs/remotes/origin/releases/2.1', repo.initial);
  assert.equal(
    repo.validate({ tag: 'release/v2.1.4', target: 'releases/2.1' }).branch,
    'releases/2.1',
  );
});

test('prerelease flags must match stable and candidate tag versions', (t) => {
  const repo = fixture(t);
  repo.git('tag', 'release/v2.0.0-beta.1');
  assert.equal(
    repo.validate({ tag: 'release/v2.0.0-beta.1', prerelease: true }).prerelease,
    'beta.1',
  );
  assert.throws(() => repo.validate({ prerelease: true }), /prerelease flag/);
  assert.throws(() => repo.validate({ tag: 'release/v2.0.0-beta.1' }), /prerelease flag/);
});

test('rejects mismatched package versions, target trains, feature branches and HEAD', (t) => {
  const repo = fixture(t);
  assert.throws(
    () => repo.validate({ manifest: { ...manifest, version: '2.0.0' } }),
    /does not match/,
  );
  assert.throws(
    () => repo.validate({ manifest: { ...manifest, name: 'another-package' } }),
    /Expected package/,
  );
  assert.throws(() => repo.validate({ target: 'releases/2.0' }), /Release target/);
  assert.throws(() => repo.validate({ target: 'feature/release' }), /Release target/);
  repo.commit();
  assert.throws(() => repo.validate(), /HEAD must be/);
});

test('rejects main-only changes tagged as maintenance after the train is cut', (t) => {
  const repo = fixture(t);
  repo.git('update-ref', 'refs/remotes/origin/releases/1.1', repo.initial);
  repo.git('update-ref', 'refs/remotes/origin/main', repo.commit());
  repo.git('tag', 'release/v1.1.4');
  assert.throws(() => repo.validate({ tag: 'release/v1.1.4' }), /merge-base.*failed/);
});

test('accepts annotated tags and rejects feature-only commits without a train', (t) => {
  const repo = fixture(t);
  repo.git('tag', '-a', 'release/v2.0.0', '-m', '2.0.0');
  assert.equal(repo.validate({ tag: 'release/v2.0.0' }).version, '2.0.0');
  repo.git('switch', '-c', 'feature');
  repo.commit();
  repo.git('tag', 'release/v2.0.1');
  assert.throws(() => repo.validate({ tag: 'release/v2.0.1' }), /merge-base.*failed/);
});

test('revalidation rejects a moved tag while the checkout stays pinned to the approved commit', (t) => {
  const repo = fixture(t);
  const approved = repo.validate({ tag: 'release/v1.1.3' }).commit;
  repo.git('checkout', '-b', 'unapproved-feature');
  repo.git('commit', '--allow-empty', '-m', 'Unapproved feature');
  repo.git('tag', '-f', 'release/v1.1.3');
  repo.git('checkout', '--detach', approved);
  assert.equal(repo.git('rev-parse', 'HEAD'), approved);
  assert.throws(() => repo.validate({ tag: 'release/v1.1.3' }), /HEAD must be/);
});

test('release event CLI pins its commit, refreshes retry channels and fails without latest', (t) => {
  const repo = fixture(t);
  const bin = join(repo.cwd, 'bin');
  mkdirSync(bin);
  const npm = join(bin, 'npm');
  writeFileSync(
    npm,
    `#!/usr/bin/env node
const assert = require('node:assert/strict');
assert.deepEqual(process.argv.slice(2), [
  'view', '@shutterstock/p-map-iterable', 'dist-tags', '--json', '--registry=https://registry.npmjs.org/'
]);
process.stdout.write(process.env.RELEASE_TEST_DIST_TAGS);
`,
  );
  chmodSync(npm, 0o755);
  writeFileSync(join(repo.cwd, 'package.json'), JSON.stringify(manifest));
  const event = join(repo.cwd, 'event.json');
  const output = join(repo.cwd, 'output.txt');
  writeFileSync(
    event,
    JSON.stringify({
      release: {
        tag_name: 'release/v1.1.3',
        target_commitish: 'main',
        prerelease: false,
        draft: false,
      },
    }),
  );
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_EVENT_PATH: event,
    GITHUB_OUTPUT: output,
    RELEASE_TEST_DIST_TAGS: JSON.stringify({ latest: '1.1.2' }),
  };
  const cli = () =>
    spawnSync(process.execPath, [join(__dirname, 'release-metadata.cjs')], {
      cwd: repo.cwd,
      env,
      encoding: 'utf8',
    });
  const success = cli();
  assert.equal(success.status, 0, success.stderr);
  const commit = repo.git('rev-parse', 'HEAD');
  assert.equal(readFileSync(output, 'utf8'), `version=1.1.3\nbranch=main\ncommit=${commit}\nnpm-tag=latest\n`);
  rmSync(output);
  // The retry must ignore the earlier successful selection after latest advances.
  writeFileSync(join(repo.cwd, 'package.json'), JSON.stringify({ ...manifest, version: '1.1.3' }));
  env.RELEASE_TEST_DIST_TAGS = JSON.stringify({ latest: '2.0.0' });
  const retry = cli();
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(readFileSync(output, 'utf8'), `version=1.1.3\nbranch=main\ncommit=${commit}\nnpm-tag=release-1.1\n`);
  rmSync(output);
  env.RELEASE_TEST_DIST_TAGS = '{}';
  const failure = cli();
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Invalid version/);
  assert.equal(existsSync(output), false);
});

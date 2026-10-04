const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { verifyDocsDeployment } = require('./docs-deployment.cjs');

function command(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const root = mkdtempSync(join(process.cwd(), '.docs-deployment-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const cwd = join(root, 'job');
  mkdirSync(source);
  command(source, 'init', '-b', 'main');
  command(source, 'config', 'user.name', 'Workflow Test');
  command(source, 'config', 'user.email', 'workflow@example.test');
  command(source, 'config', 'commit.gpgsign', 'false');
  command(source, 'config', 'tag.gpgsign', 'false');
  command(source, 'config', 'core.hooksPath', '/dev/null');
  writeFileSync(join(source, 'package.json'), JSON.stringify({
    name: '@shutterstock/p-map-iterable', version: '0.0.0',
  }));
  command(source, 'add', '.');
  command(source, 'commit', '-m', 'Maintenance source');
  command(source, 'tag', 'release/v1.1.9');
  command(source, 'branch', 'releases/1.1');
  command(source, 'commit', '--allow-empty', '-m', 'Current train');
  command(source, 'tag', '-a', 'release/v2.0.0', '-m', 'Stable');
  command(source, 'tag', 'release/v2.1.0-beta.1');
  command(root, '-c', 'core.hooksPath=/dev/null', 'clone', '--quiet', source, cwd);
  command(cwd, 'config', 'commit.gpgsign', 'false');
  command(cwd, 'config', 'tag.gpgsign', 'false');
  command(cwd, 'config', 'core.hooksPath', '/dev/null');
  return { source, cwd };
}

test('fixtures ignore inherited signing and external hooks', (t) => {
  const root = mkdtempSync(join(process.cwd(), '.docs-global-config-test-'));
  const hooks = join(root, 'hooks');
  mkdirSync(hooks);
  for (const name of ['pre-commit', 'post-checkout']) {
    const hook = join(hooks, name);
    writeFileSync(hook, '#!/bin/sh\nexit 87\n');
    chmodSync(hook, 0o755);
  }
  const config = join(root, 'gitconfig');
  writeFileSync(config, `[commit]\n gpgsign = true\n[tag]\n gpgsign = true\n[gpg]\n program = nonexistent-signing-program\n[core]\n hooksPath = ${hooks}\n`);
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = config;
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
    rmSync(root, { recursive: true, force: true });
  });
  const f = fixture(t);
  assert.equal(release(f, 'release/v2.0.0', '2.0.0'), true);
});

function release(f, tag, latest, prerelease = false) {
  command(f.cwd, 'checkout', '--quiet', tag);
  return verifyDocsDeployment({
    cwd: f.cwd, latest, eventName: 'release',
    event: { release: { tag_name: tag, prerelease, target_commitish: 'main' } },
  });
}

test('current successfully published release deploys with annotated tag provenance', (t) => {
  const f = fixture(t);
  assert.equal(release(f, 'release/v2.0.0', '2.0.0'), true);
});

test('docs before publication or after a failed publication do not deploy', (t) => {
  const f = fixture(t);
  assert.equal(release(f, 'release/v2.0.0', '1.1.9'), false);
});

test('older maintenance docs after a newer stable publication do not deploy', (t) => {
  const f = fixture(t);
  assert.equal(release(f, 'release/v1.1.9', '2.0.0'), false);
});

test('a superseding latest in the same train prevents queued old documentation', (t) => {
  const f = fixture(t);
  assert.equal(release(f, 'release/v2.0.0', '2.0.1'), false);
});

test('prerelease documentation cannot replace stable documentation', (t) => {
  const f = fixture(t);
  assert.equal(release(f, 'release/v2.1.0-beta.1', '2.0.0', true), false);
});

test('missing or prerelease registry latest fails closed', (t) => {
  const f = fixture(t);
  assert.throws(() => release(f, 'release/v2.0.0', undefined), /Invalid version/);
  assert.throws(() => release(f, 'release/v2.0.0', '2.1.0-beta.1'), /must be a stable/);
});

test('a release tag moved remotely after checkout fails provenance', (t) => {
  const f = fixture(t);
  command(f.source, 'commit', '--allow-empty', '-m', 'Moved remote tag');
  command(f.source, 'tag', '-f', 'release/v2.0.0');
  assert.throws(() => release(f, 'release/v2.0.0', '2.0.0'), /changed after checkout/);
});

test('a mismatched release event HEAD cannot deploy', (t) => {
  const f = fixture(t);
  command(f.cwd, 'checkout', '--quiet', 'release/v1.1.9');
  assert.throws(() => verifyDocsDeployment({
    cwd: f.cwd, latest: '2.0.0', eventName: 'release',
    event: { release: { tag_name: 'release/v2.0.0', prerelease: false, target_commitish: 'main' } },
  }), /HEAD must be/);
});

test('manual main can intentionally deploy unreleased main docs with latest provenance', (t) => {
  const f = fixture(t);
  assert.equal(verifyDocsDeployment({
    cwd: f.cwd, latest: '1.1.9', eventName: 'workflow_dispatch', ref: 'refs/heads/main', event: {},
  }), true);
});

test('a queued manual run whose main commit was superseded is skipped', (t) => {
  const f = fixture(t);
  command(f.source, 'commit', '--allow-empty', '-m', 'Advance main');
  assert.equal(verifyDocsDeployment({
    cwd: f.cwd, latest: '2.0.0', eventName: 'workflow_dispatch', ref: 'refs/heads/main', event: {},
  }), false);
});

test('manual dispatch from maintenance or feature branches is rejected', (t) => {
  const f = fixture(t);
  assert.throws(() => verifyDocsDeployment({
    cwd: f.cwd, latest: '2.0.0', eventName: 'workflow_dispatch', ref: 'refs/heads/releases/1.1', event: {},
  }), /must run from main/);
});

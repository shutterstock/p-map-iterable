const { spawnSync } = require('node:child_process');
const { appendFileSync, readFileSync } = require('node:fs');
const { parseVersion, validateRelease } = require('./release-metadata.cjs');

const packageName = '@shutterstock/p-map-iterable';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message || result.stderr}`);
  }
  return result.stdout.trim();
}

function verifyDocsDeployment({ eventName, ref, event, latest, cwd = process.cwd() }) {
  const version = parseVersion(latest);
  if (version.prerelease) throw new Error('npm latest must be a stable version');
  const git = (...args) => run('git', args, cwd);
  const remoteCommit = (name) => {
    const refs = new Map(
      git('ls-remote', '--exit-code', 'origin', name, `${name}^{}`)
        .split('\n').map((line) => line.split(/\s+/).reverse()),
    );
    const commit = refs.get(`${name}^{}`) || refs.get(name);
    if (!commit) throw new Error(`Missing remote ref ${name}`);
    return commit;
  };
  const tag = `release/v${version.version}`;
  const verifyTag = (tagName) => {
    const commit = git('rev-parse', '--verify', `refs/tags/${tagName}^{commit}`);
    if (remoteCommit(`refs/tags/${tagName}`) !== commit) {
      throw new Error(`Remote release tag ${tagName} changed after checkout`);
    }
    return commit;
  };

  if (eventName === 'release') {
    if (!event.release || event.release.draft) throw new Error('Expected a published release');
    const release = validateRelease({
      tag: event.release.tag_name,
      prerelease: event.release.prerelease,
      target: event.release.target_commitish,
      manifest: JSON.parse(readFileSync(`${cwd}/package.json`, 'utf8')),
      cwd,
    });
    verifyTag(event.release.tag_name);
    // Equality is required: a not-yet-published version must not deploy either.
    return !release.prerelease && release.version === version.version;
  }

  if (eventName !== 'workflow_dispatch' || ref !== 'refs/heads/main') {
    throw new Error('Manual documentation must run from main');
  }
  if (git('rev-parse', '--is-shallow-repository') !== 'false') {
    throw new Error('Documentation provenance requires checkout fetch-depth: 0');
  }
  if (git('rev-parse', 'HEAD') !== remoteCommit('refs/heads/main')) return false;
  const tagCommit = verifyTag(tag);
  git('merge-base', '--is-ancestor', tagCommit, 'HEAD');
  const manifest = JSON.parse(git('show', `refs/tags/${tag}:package.json`));
  if (manifest.name !== packageName || !['0.0.0', version.version].includes(manifest.version)) {
    throw new Error('npm latest release tag has inconsistent package metadata');
  }
  return true;
}

function main() {
  // Public registry metadata does not require authentication.
  const distTags = JSON.parse(run('npm', [
    'view', packageName, 'dist-tags', '--json', '--registry=https://registry.npmjs.org/',
  ], process.cwd()));
  const publish = verifyDocsDeployment({
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF,
    event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    latest: distTags.latest,
  });
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
  console.log(publish ? 'Documentation provenance is current' : 'Skipping superseded or unpublished documentation');
}

module.exports = { verifyDocsDeployment };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Documentation provenance check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

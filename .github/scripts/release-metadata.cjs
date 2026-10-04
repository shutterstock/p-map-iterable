const { spawnSync } = require('node:child_process');
const { appendFileSync, readFileSync } = require('node:fs');

const integer = '(0|[1-9][0-9]*)';
const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
const versionPattern = new RegExp(
  `^${integer}\\.${integer}\\.${integer}(?:-(${identifier}(?:\\.${identifier})*))?$`,
);
const packageName = '@shutterstock/p-map-iterable';

function parseVersion(version) {
  const match = typeof version === 'string' && versionPattern.exec(version);
  if (!match || match[0] !== version) {
    throw new Error(
      `Invalid version ${JSON.stringify(version)}; expected X.Y.Z or X.Y.Z-prerelease`,
    );
  }
  return {
    version,
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease: match[4] || '',
    train: `${match[1]}.${match[2]}`,
  };
}

function parseTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('release/v')) {
    throw new Error('Release tag must use release/vX.Y.Z (optionally with a prerelease suffix)');
  }
  return parseVersion(tag.slice('release/v'.length));
}

function selectNpmTag(release, distTags) {
  const latest = parseVersion(distTags.latest);
  if (latest.prerelease) {
    throw new Error('npm latest must point to a stable version');
  }
  if (release.prerelease) {
    return `next-${release.train}`;
  }
  for (const component of ['major', 'minor', 'patch']) {
    if (release[component] > latest[component]) return 'latest';
    if (release[component] < latest[component]) return `release-${release.train}`;
  }
  return 'latest';
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed: ${result.error?.message || result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function validateRelease({ tag, prerelease, target, manifest, cwd = process.cwd() }) {
  const release = parseTag(tag);
  if (Boolean(release.prerelease) !== prerelease) {
    throw new Error('GitHub prerelease flag must match the release tag suffix');
  }
  if (manifest.name !== packageName) {
    throw new Error(`Expected package ${packageName}`);
  }
  // The existing repository stores 0.0.0 and materializes its version only in CI.
  if (manifest.version !== '0.0.0' && manifest.version !== release.version) {
    throw new Error(
      `Package version ${manifest.version} does not match release ${release.version}`,
    );
  }

  const maintenanceBranch = `releases/${release.train}`;
  if (target !== 'main' && target !== maintenanceBranch && !/^[0-9a-f]{7,40}$/i.test(target)) {
    throw new Error(`Release target must be main, ${maintenanceBranch}, or a commit SHA`);
  }
  const git = (...args) => run('git', args, cwd);
  if (git('rev-parse', '--is-shallow-repository') !== 'false') {
    throw new Error('Release validation requires checkout fetch-depth: 0');
  }
  const tagCommit = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`);
  if (git('rev-parse', 'HEAD') !== tagCommit) {
    throw new Error(`HEAD must be the explicit release tag ${tag}`);
  }

  const maintenanceRef = `refs/remotes/origin/${maintenanceBranch}`;
  const branchLookup = spawnSync('git', ['show-ref', '--verify', '--quiet', maintenanceRef], {
    cwd,
    encoding: 'utf8',
  });
  if (branchLookup.error || ![0, 1].includes(branchLookup.status)) {
    throw new Error(`Could not inspect ${maintenanceRef}`);
  }
  const branch = branchLookup.status === 0 ? maintenanceBranch : 'main';
  if (target === maintenanceBranch && branch !== maintenanceBranch) {
    throw new Error(`Release target ${maintenanceBranch} has not been cut yet`);
  }
  // Existing GitHub tags can retain target_commitish=main after a train is cut.
  // Validate ancestry against the matching train rather than relying on that field.
  git('merge-base', '--is-ancestor', tagCommit, `refs/remotes/origin/${branch}`);
  return { ...release, branch, commit: tagCommit };
}

function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (!event.release || event.release.draft) {
    throw new Error('Expected a published GitHub Release event');
  }
  const release = validateRelease({
    tag: event.release.tag_name,
    prerelease: event.release.prerelease,
    target: event.release.target_commitish,
    manifest: JSON.parse(readFileSync('package.json', 'utf8')),
  });
  // An unavailable registry or missing latest must fail before publication.
  const distTags = JSON.parse(
    run('npm', [
      'view',
      packageName,
      'dist-tags',
      '--json',
      '--registry=https://registry.npmjs.org/',
    ]),
  );
  const npmTag = selectNpmTag(release, distTags);
  const output = `version=${release.version}\nbranch=${release.branch}\ncommit=${release.commit}\nnpm-tag=${npmTag}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  console.log(output.trim());
}

module.exports = { parseVersion, parseTag, selectNpmTag, validateRelease };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Release metadata check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

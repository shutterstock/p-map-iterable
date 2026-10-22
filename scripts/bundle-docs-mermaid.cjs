const assert = require('node:assert/strict');
const { readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild-wasm');

const root = path.resolve(__dirname, '..');
const mermaidRoot = path.dirname(require.resolve('mermaid/package.json'));
const assets = path.join(root, 'docs/assets/mermaid');

function bundledPackage(inputs, name) {
  const marker = `/node_modules/${name}/`;
  const input = inputs.find((file) => `/${file}`.includes(marker));
  assert(input, `The docs bundle must include the installed ${name} package.`);
  const absolute = path.resolve(root, input).split(path.sep).join('/');
  const packageRoot = absolute.slice(0, absolute.lastIndexOf(marker) + marker.length);
  return JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
}

async function main() {
  // Published Mermaid browser bundles vendor their own dependency versions.
  // Build from its core entry so the served sanitizer/math code follows our lock.
  // Remove the copied vendor chunks as well, so vulnerable orphan assets stay out.
  rmSync(assets, { recursive: true, force: true });
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [{ in: path.join(mermaidRoot, 'dist/mermaid.core.mjs'), out: 'mermaid.esm.min' }],
    outdir: assets,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    metafile: true,
    outExtension: { '.js': '.mjs' },
    chunkNames: 'chunks/[name]-[hash]',
    loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
  });
  const inputs = Object.keys(result.metafile.inputs);
  const sanitizer = bundledPackage(inputs, 'dompurify');
  const math = bundledPackage(inputs, 'katex');
  // Mermaid's core currently embeds its styles. Fail if that contract changes
  // rather than silently publish a bundle whose CSS has not been linked.
  assert(
    !Object.keys(result.metafile.outputs).some((file) => file.endsWith('.css')),
    'New Mermaid CSS output needs to be linked in the generated documentation.',
  );
  console.log(`Mermaid docs bundle: DOMPurify ${sanitizer.version}, KaTeX ${math.version}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => esbuild.stop());

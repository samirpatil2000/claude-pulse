import { copyFile, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

await mkdir('src/vendor', { recursive: true });
await copyFile(
  'node_modules/gpt-tokenizer/dist/o200k_base.js',
  'src/vendor/o200k_base.js'
);
await rm('dist', { recursive: true, force: true });

const args = [
  'build',
  '--source-dir', '.',
  '--artifacts-dir', 'dist',
  '--overwrite-dest',
  '--ignore-files',
  'node_modules/**',
  'package.json',
  'package-lock.json',
  'scripts/**',
  'tests/**',
  'README_AMO_SOURCE.md'
];

// Launch the JavaScript entry point through the current Node executable.
// Spawning web-ext.cmd directly can fail with EINVAL on Node 24 for Windows.
const webExtCli = fileURLToPath(
  new URL('../node_modules/web-ext/bin/web-ext.js', import.meta.url)
);
const child = spawn(process.execPath, [webExtCli, ...args], { stdio: 'inherit' });
child.once('error', (error) => {
  console.error('Could not start web-ext:', error);
  process.exit(1);
});
child.once('exit', (code) => process.exit(code ?? 1));

import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sharedFiles = [
  'background.js',
  'extract.js',
  'sites/youtube.js',
  'popup/popup.js',
  'popup/popup.html',
  'popup/popup.css',
];

for (const browser of ['Chrome', 'Firefox']) {
  for (const relativePath of sharedFiles) {
    const source = await readFile(resolve(root, 'extension-shared', relativePath));
    const generated = await readFile(resolve(root, browser, relativePath));
    if (!source.equals(generated)) {
      throw new Error(`${browser}/${relativePath} ist nicht mit extension-shared synchronisiert.`);
    }
  }
}

for (const manifest of ['Chrome/manifest.json', 'Firefox/manifest.json']) {
  JSON.parse(await readFile(resolve(root, manifest), 'utf8'));
}

const javascriptFiles = [
  'scripts/sync-browser-files.mjs',
  'extension-shared/background.js',
  'extension-shared/extract.js',
  'extension-shared/sites/youtube.js',
  'extension-shared/popup/popup.js',
];
for (const file of javascriptFiles) {
  await execFileAsync(process.execPath, ['--check', resolve(root, file)]);
}

console.log('Manifeste, JavaScript-Syntax und synchronisierte Browser-Dateien sind gültig.');
